import { describe, expect, it, vi } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import type { ITransactionalDb } from "../db.js";
import { ApiConflictError, ApiFieldValidationError } from "../errors.js";
import { withMcpIdempotency } from "./idempotency.js";

interface IRecord {
    fingerprint: string;
    response: unknown;
}

function createTransactionalDb(): ITransactionalDb {
    const records = new Map<string, IRecord>();
    let tail = Promise.resolve();
    const db: ITransactionalDb = {
        query: async () => {
            throw new Error("Expected a transaction-scoped query.");
        },
        async transaction(run) {
            let unlock!: () => void;
            const turn = new Promise<void>((resolve) => (unlock = resolve));
            const previous = tail;
            tail = previous.then(() => turn);
            await previous;
            const tx = {
                async query<T extends QueryResultRow = QueryResultRow>(
                    text: string,
                    values: unknown[] = [],
                ): Promise<QueryResult<T>> {
                    if (text.includes("from mcp_idempotency_records")) {
                        const [teamId, operation, keyHash] = values as string[];
                        const record = records.get(
                            JSON.stringify([teamId, operation, keyHash]),
                        );
                        return {
                            rows: record
                                ? ([
                                      {
                                          fingerprint: record.fingerprint,
                                          response_json: record.response,
                                      },
                                  ] as unknown as T[])
                                : [],
                            rowCount: record ? 1 : 0,
                        } as QueryResult<T>;
                    }
                    if (text.includes("insert into mcp_idempotency_records")) {
                        const [
                            teamId,
                            operation,
                            keyHash,
                            fingerprint,
                            response,
                        ] = values as [string, string, string, string, unknown];
                        records.set(
                            JSON.stringify([teamId, operation, keyHash]),
                            { fingerprint, response },
                        );
                        return {
                            rows: [],
                            rowCount: 1,
                        } as unknown as QueryResult<T>;
                    }
                    if (text.includes("pg_advisory_xact_lock")) {
                        return {
                            rows: [],
                            rowCount: 1,
                        } as unknown as QueryResult<T>;
                    }
                    throw new Error(`Unexpected SQL: ${text}`);
                },
            };
            try {
                return await run(tx);
            } finally {
                unlock();
            }
        },
    };
    return db;
}

describe("MCP idempotency", () => {
    const scope = {
        teamId: "11111111-1111-4111-8111-111111111111",
        operation: "duplicate_dataset",
        idempotencyKey: "copy-request-1",
        request: {
            projectId: "22222222-2222-4222-8222-222222222222",
            datasetId: "33333333-3333-4333-8333-333333333333",
        },
    };

    it("replays the original created IDs after a simulated lost response", async () => {
        const db = createTransactionalDb();
        const create = vi.fn(async () => ({
            sourceDatasetId: scope.request.datasetId,
            createdDatasetId: "44444444-4444-4444-8444-444444444444",
        }));

        const firstResponse = await withMcpIdempotency(db, scope, create);
        void firstResponse; // The client loses this response before retrying.
        const retryResponse = await withMcpIdempotency(db, scope, create);

        expect(retryResponse).toEqual({
            sourceDatasetId: scope.request.datasetId,
            createdDatasetId: "44444444-4444-4444-8444-444444444444",
        });
        expect(create).toHaveBeenCalledTimes(1);
    });

    it("serializes concurrent copies with the same key", async () => {
        const db = createTransactionalDb();
        let nextId = 0;
        const create = vi.fn(async () => ({ createdId: ++nextId }));
        const responses = await Promise.all(
            Array.from({ length: 8 }, () =>
                withMcpIdempotency(db, scope, create),
            ),
        );

        expect(create).toHaveBeenCalledTimes(1);
        expect(
            new Set(responses.map((response) => response.createdId)),
        ).toEqual(new Set([1]));
    });

    it("rejects reuse of a key for a different request", async () => {
        const db = createTransactionalDb();
        const create = vi.fn(async () => ({ createdId: "one" }));
        await withMcpIdempotency(db, scope, create);

        await expect(
            withMcpIdempotency(
                db,
                {
                    ...scope,
                    request: { ...scope.request, datasetId: "different" },
                },
                create,
            ),
        ).rejects.toBeInstanceOf(ApiConflictError);
        expect(create).toHaveBeenCalledTimes(1);
    });

    it("keeps the key optional for legacy callers and validates supplied keys", async () => {
        const create = vi.fn(async () => ({ createdId: "legacy" }));
        const db = createTransactionalDb();

        await expect(
            withMcpIdempotency(
                db,
                { ...scope, idempotencyKey: undefined },
                create,
            ),
        ).resolves.toEqual({ createdId: "legacy" });
        await expect(
            withMcpIdempotency(db, { ...scope, idempotencyKey: "   " }, create),
        ).rejects.toBeInstanceOf(ApiFieldValidationError);
        expect(create).toHaveBeenCalledTimes(1);
    });
});
