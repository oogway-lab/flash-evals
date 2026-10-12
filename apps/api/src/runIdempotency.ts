import { createHash } from "node:crypto";
import {
    canonicalJsonString,
    type ICreateRunRequest,
    type ICreateRunFromSelectionRequest,
    type ICreateRunResponse,
} from "@mosaic/api-contract";
import { withTransaction, type IDb } from "./db.js";
import { ApiConflictError, ApiFieldValidationError } from "./errors.js";

type RunRequest = ICreateRunRequest | ICreateRunFromSelectionRequest;

/** Check the original caller intent before resolving mutable dataset/prompt state. */
export async function createRunWithIdempotency(
    db: IDb,
    input: RunRequest,
    kind: "models" | "selection",
    create: (tx: IDb) => Promise<ICreateRunResponse>,
): Promise<ICreateRunResponse> {
    const key = normalizeKey(input.idempotencyKey);
    return withTransaction(db, async (tx) => {
        if (!key) return create(tx);
        const fingerprint = createHash("sha256")
            .update(
                canonicalJsonString({ ...input, idempotencyKey: key, kind }),
            )
            .digest("hex");
        await tx.query(
            `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
            [
                JSON.stringify([
                    "eval-run",
                    input.teamId,
                    input.projectId,
                    input.createdBy,
                    key,
                ]),
            ],
        );
        const existing = (
            await tx.query<{
                runId: string;
                fingerprint: string;
                enqueueStatus: "pending_enqueue" | "queued";
            }>(
                `select r.id as "runId", r.idempotency_fingerprint as fingerprint,
                o.status as "enqueueStatus"
             from runs r left join run_enqueue_outbox o on o.run_id = r.id
             where r.team_id=$1 and r.project_id=$2 and r.created_by=$3
               and r.idempotency_key=$4`,
                [input.teamId, input.projectId, input.createdBy, key],
            )
        ).rows[0];
        if (existing) {
            if (existing.fingerprint !== fingerprint)
                throw new ApiConflictError(
                    "This eval run idempotency key was already used for a different request.",
                );
            return {
                runId: existing.runId,
                enqueueStatus:
                    existing.enqueueStatus === "queued"
                        ? "queued"
                        : "pending_enqueue",
            };
        }
        const result = await create(tx);
        await tx.query(
            `update runs set idempotency_key=$2, idempotency_fingerprint=$3 where id=$1`,
            [result.runId, key, fingerprint],
        );
        return result;
    });
}

function normalizeKey(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim() || value.trim().length > 200)
        throw new ApiFieldValidationError(
            "Eval run idempotency key must contain 1 to 200 characters.",
            "idempotencyKey",
            "Provide a stable retry key or omit idempotencyKey.",
        );
    return value.trim();
}
