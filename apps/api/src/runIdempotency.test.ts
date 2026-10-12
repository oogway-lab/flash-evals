import { describe, expect, it, vi } from "vitest";
import type { ICreateRunRequest } from "@mosaic/api-contract";
import type { IDb, ITransactionalDb } from "./db.js";
import { createRunWithIdempotency } from "./runIdempotency.js";

const input: ICreateRunRequest = {
    teamId: "team",
    projectId: "project",
    createdBy: "actor",
    datasetId: "dataset",
    maxTokens: 100,
    models: [{ modelId: "model", isReference: true }],
    fieldConfigs: [],
    idempotencyKey: "retry-key",
};

function fixture() {
    const rows = new Map<
        string,
        { runId: string; fingerprint: string; enqueueStatus: string }
    >();
    let scope = "";
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("pg_advisory_xact_lock")) scope = String(values[0]);
        if (sql.includes("from runs r"))
            return { rows: rows.has(scope) ? [rows.get(scope)] : [] };
        if (sql.includes("update runs set idempotency_key"))
            rows.set(scope, {
                runId: String(values[0]),
                fingerprint: String(values[2]),
                enqueueStatus: "pending_enqueue",
            });
        return { rows: [] };
    });
    let tail = Promise.resolve();
    const db: ITransactionalDb = {
        query: query as unknown as IDb["query"],
        transaction: (run) => {
            const result = tail.then(() =>
                run({ query: query as unknown as IDb["query"] }),
            );
            tail = result.then(
                () => undefined,
                () => undefined,
            );
            return result;
        },
    };
    const create = vi.fn(async () => ({
        runId: `run-${rows.size + 1}`,
        enqueueStatus: "pending_enqueue" as const,
    }));
    return { db, query, create };
}

describe("ordinary run idempotency", () => {
    it("returns the same run for concurrent identical intents under a scoped transaction lock", async () => {
        const { db, query, create } = fixture();
        const results = await Promise.all(
            Array.from({ length: 3 }, () =>
                createRunWithIdempotency(db, input, "models", create),
            ),
        );
        expect(results.map((result) => result.runId)).toEqual([
            "run-1",
            "run-1",
            "run-1",
        ]);
        expect(create).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("pg_advisory_xact_lock"),
            [
                JSON.stringify([
                    "eval-run",
                    "team",
                    "project",
                    "actor",
                    "retry-key",
                ]),
            ],
        );
    });

    it("rejects changed intent without calling creation again", async () => {
        const { db, create } = fixture();
        await createRunWithIdempotency(db, input, "models", create);
        await expect(
            createRunWithIdempotency(
                db,
                { ...input, maxTokens: 200 },
                "models",
                create,
            ),
        ).rejects.toThrow("different request");
        await expect(
            createRunWithIdempotency(db, input, "selection", create),
        ).rejects.toThrow("different request");
        expect(create).toHaveBeenCalledTimes(1);
    });

    it("resolves a prior run before mutable dataset validation and canonicalizes object keys", async () => {
        const { db, create } = fixture();
        await createRunWithIdempotency(db, input, "models", create);
        const noLongerValid = vi.fn(async () => {
            throw new Error("Dataset is archived");
        });
        const reordered = Object.fromEntries(
            Object.entries(input).reverse(),
        ) as unknown as ICreateRunRequest;
        await expect(
            createRunWithIdempotency(
                db,
                { ...reordered, idempotencyKey: " retry-key " },
                "models",
                noLongerValid,
            ),
        ).resolves.toMatchObject({ runId: "run-1" });
        expect(noLongerValid).not.toHaveBeenCalled();
    });

    it("isolates teams, projects and actors", async () => {
        const { db, create } = fixture();
        for (const request of [
            input,
            { ...input, teamId: "other" },
            { ...input, projectId: "other" },
            { ...input, createdBy: "other" },
        ])
            await createRunWithIdempotency(db, request, "models", create);
        expect(create).toHaveBeenCalledTimes(4);
    });

    it("preserves unkeyed callers and validates retry keys", async () => {
        const { db, query, create } = fixture();
        await createRunWithIdempotency(
            db,
            { ...input, idempotencyKey: undefined },
            "models",
            create,
        );
        await createRunWithIdempotency(
            db,
            { ...input, idempotencyKey: undefined },
            "models",
            create,
        );
        expect(create).toHaveBeenCalledTimes(2);
        expect(query).not.toHaveBeenCalled();
        for (const key of ["", " ", "x".repeat(201), null])
            await expect(
                createRunWithIdempotency(
                    db,
                    { ...input, idempotencyKey: key as string },
                    "models",
                    create,
                ),
            ).rejects.toThrow("1 to 200");
    });
});
