import { createHash } from "node:crypto";
import { canonicalJsonString } from "@mosaic/api-contract";
import { isTransactionalDb, type IDb } from "../db.js";
import {
    ApiConflictError,
    ApiFieldValidationError,
    ApiServiceUnavailableError,
} from "../errors.js";

export async function withMcpIdempotency<T>(
    db: IDb,
    input: {
        teamId: string;
        operation: string;
        idempotencyKey?: string;
        request: unknown;
    },
    create: (tx: IDb) => Promise<T>,
): Promise<T> {
    const key = normalizeMcpIdempotencyKey(input.idempotencyKey);
    if (!key) return create(db);
    if (!isTransactionalDb(db)) {
        throw new ApiServiceUnavailableError(
            "Idempotent copy requires a transactional database connection.",
        );
    }
    const keyHash = createHash("sha256").update(key).digest("hex");
    const fingerprint = createHash("sha256")
        .update(canonicalJsonString(input.request))
        .digest("hex");
    const lockKey = JSON.stringify([
        "mcp-operation",
        input.teamId,
        input.operation,
        keyHash,
    ]);

    return db.transaction(async (tx) => {
        await tx.query(
            `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
            [lockKey],
        );
        const existing = (
            await tx.query<{
                fingerprint: string;
                response_json: T;
            }>(
                `select fingerprint,response_json
                 from mcp_idempotency_records
                 where team_id=$1 and operation=$2 and key_hash=$3
                 limit 1`,
                [input.teamId, input.operation, keyHash],
            )
        ).rows[0];
        if (existing) {
            if (existing.fingerprint !== fingerprint) {
                throw new ApiConflictError(
                    "This idempotency key was already used for a different request.",
                );
            }
            return existing.response_json;
        }

        const response = await create(tx);
        await tx.query(
            `insert into mcp_idempotency_records
                (team_id,operation,key_hash,fingerprint,response_json)
             values ($1,$2,$3,$4,$5)`,
            [input.teamId, input.operation, keyHash, fingerprint, response],
        );
        return response;
    });
}

function normalizeMcpIdempotencyKey(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (
        typeof value !== "string" ||
        value.trim().length === 0 ||
        value.trim().length > 200
    ) {
        throw new ApiFieldValidationError(
            "Idempotency key must contain 1 to 200 characters.",
            "idempotencyKey",
            "Choose a stable key before the first request and reuse it for the same action.",
        );
    }
    return value.trim();
}
