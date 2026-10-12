import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadWorkerCostSummary } from "./workerStatusCostSummary";

const databaseUrl = process.env.MOSAIC_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("worker status cost summary", () => {
    let pool: Pool;

    beforeAll(async () => {
        if (!databaseUrl) return;
        const databaseName = new URL(databaseUrl).pathname.slice(1);
        if (!databaseName.includes("test")) {
            throw new Error(
                "MOSAIC_TEST_DATABASE_URL must point to a disposable database with 'test' in its name.",
            );
        }
        pool = new Pool({ connectionString: databaseUrl, max: 1 });
        await pool.query(`
            create temp table run_models (
                id uuid primary key,
                model_id text not null
            );
            create temp table run_cells (
                run_model_id uuid not null,
                status text not null,
                created_at timestamptz not null,
                provider_metadata jsonb,
                cost_source text,
                cost_usd double precision,
                prompt_tokens integer,
                completion_tokens integer
            );
            create temp table workflow_run_cells (
                status text not null,
                created_at timestamptz not null,
                output_json jsonb,
                cost_usd double precision
            );
        `);
    });

    afterAll(async () => {
        await pool?.end();
    });

    it("counts one paid result and excludes multiple cached copies", async () => {
        const runModelId = randomUUID();
        await pool.query(
            "insert into run_models (id, model_id) values ($1, $2)",
            [runModelId, "mock-model"],
        );
        for (const status of ["succeeded", "cached", "cached"]) {
            await pool.query(
                `insert into run_cells (
                    run_model_id, status, created_at, provider_metadata,
                    cost_source, cost_usd, prompt_tokens, completion_tokens
                ) values ($1, $2, now(), $3::jsonb, 'provider_reported', 0.25, 100, 50)`,
                [
                    runModelId,
                    status,
                    JSON.stringify({ provider: "mock-provider" }),
                ],
            );
            await pool.query(
                `insert into workflow_run_cells (status, created_at, output_json, cost_usd)
                 values ($1, now(), $2::jsonb, 0.4)`,
                [
                    status,
                    JSON.stringify({
                        executionProvenance: {
                            actual: {
                                upstreamProvider: "mock-workflow-provider",
                            },
                            currentCost: { source: "provider_reported" },
                        },
                        usage: { promptTokens: 80, completionTokens: 40 },
                    }),
                ],
            );
        }

        const summary = await loadWorkerCostSummary(pool);
        expect(summary.find((row) => !row.workflow)).toMatchObject({
            providerOrModel: "mock-provider",
            costSource: "provider_reported",
            cells: 1,
            estimatedCostUsd: 0.25,
            inputTokens: 100,
            outputTokens: 50,
        });
        expect(summary.find((row) => row.workflow)).toMatchObject({
            providerOrModel: "mock-workflow-provider",
            costSource: "provider_reported",
            cells: 1,
            estimatedCostUsd: 0.4,
            inputTokens: 80,
            outputTokens: 40,
        });
    });
});
