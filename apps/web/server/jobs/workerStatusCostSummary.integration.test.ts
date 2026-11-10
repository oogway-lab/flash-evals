import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadWorkerCostSummary } from "./workerStatusCostSummary";

const databaseUrl = process.env.FLASH_EVALS_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("worker status cost summary", () => {
    let pool: Pool;

    beforeAll(async () => {
        if (!databaseUrl) return;
        const databaseName = new URL(databaseUrl).pathname.slice(1);
        if (!databaseName.includes("test")) {
            throw new Error(
                "FLASH_EVALS_TEST_DATABASE_URL must point to a disposable database with 'test' in its name.",
            );
        }
        pool = new Pool({ connectionString: databaseUrl, max: 1 });
        await pool.query(`
            create temp table run_models (
                id uuid primary key,
                model_id text not null
            );
            create temp table run_cells (
                id uuid primary key,
                run_model_id uuid not null,
                status text not null,
                created_at timestamptz not null,
                provider_metadata jsonb,
                cost_source text,
                cost_usd double precision,
                judge_cost_usd double precision,
                prompt_tokens integer,
                completion_tokens integer
            );
            create temp table workflow_run_cells (
                id uuid primary key,
                status text not null,
                created_at timestamptz not null,
                output_json jsonb,
                cost_usd double precision,
                judge_cost_usd double precision
            );
            create temp table workflow_run_answers (
                id uuid primary key,
                created_at timestamptz not null,
                judge_cost_usd double precision
            );
            create temp table spend_ledger (
                source_table text not null,
                source_id uuid not null,
                kind text not null,
                amount_usd double precision not null,
                paid_at timestamptz not null
            );
        `);
    });

    afterAll(async () => {
        await pool?.end();
    });

    async function paid(
        sourceTable: string,
        sourceId: string,
        kind: "call" | "judge",
        amountUsd: number,
        when = "now()",
    ) {
        await pool.query(
            `insert into spend_ledger (source_table, source_id, kind, amount_usd, paid_at)
             values ($1, $2, $3, $4, ${when})`,
            [sourceTable, sourceId, kind, amountUsd],
        );
    }

    it("counts spend paid in the last day, by when it was paid", async () => {
        const runModelId = randomUUID();
        await pool.query(
            "insert into run_models (id, model_id) values ($1, $2)",
            [runModelId, "mock-model"],
        );
        // A paid answer, two cached copies of it (no call paid; judging
        // them still pays the judge), and a cell created days ago and
        // retried today.
        const cells = [
            ["succeeded", "now()", 0.25, 0.05],
            ["cached", "now()", undefined, 0.03],
            ["cached", "now()", undefined, undefined],
            ["succeeded", "now() - interval '3 days'", 0.5, undefined],
        ] as const;
        for (const [status, createdAt, callUsd, judgeUsd] of cells) {
            const id = randomUUID();
            await pool.query(
                `insert into run_cells (
                    id, run_model_id, status, created_at, provider_metadata,
                    cost_source, cost_usd, prompt_tokens, completion_tokens
                ) values ($1, $2, $3, ${createdAt}, $4::jsonb, 'provider_reported', 0.25, 100, 50)`,
                [
                    id,
                    runModelId,
                    status,
                    JSON.stringify({ provider: "mock-provider" }),
                ],
            );
            if (callUsd !== undefined)
                await paid("run_cells", id, "call", callUsd);
            if (judgeUsd !== undefined)
                await paid("run_cells", id, "judge", judgeUsd);
        }
        // Paid three days ago: outside the window.
        const oldCell = randomUUID();
        await pool.query(
            `insert into run_cells (id, run_model_id, status, created_at, provider_metadata, cost_source, cost_usd)
             values ($1, $2, 'succeeded', now(), $3::jsonb, 'provider_reported', 9)`,
            [
                oldCell,
                runModelId,
                JSON.stringify({ provider: "mock-provider" }),
            ],
        );
        await paid(
            "run_cells",
            oldCell,
            "call",
            9,
            "now() - interval '3 days'",
        );

        for (const [index, status] of ["succeeded", "cached"].entries()) {
            const id = randomUUID();
            await pool.query(
                `insert into workflow_run_cells (id, status, created_at, output_json, cost_usd)
                 values ($1, $2, now(), $3::jsonb, 0.4)`,
                [
                    id,
                    status,
                    JSON.stringify({
                        executionProvenance: {
                            actual: {
                                status: "resolved",
                                identity: {
                                    upstreamProvider: "mock-workflow-provider",
                                },
                            },
                            currentCost: { source: "provider_reported" },
                        },
                        usage: { promptTokens: 80, completionTokens: 40 },
                    }),
                ],
            );
            if (index === 0) {
                await paid("workflow_run_cells", id, "call", 0.4);
                await paid("workflow_run_cells", id, "judge", 0.02);
            }
        }

        // A final answer compared with an eval run's reference.
        const answerId = randomUUID();
        await pool.query(
            `insert into workflow_run_answers (id, created_at, judge_cost_usd)
             values ($1, now(), 0.01)`,
            [answerId],
        );
        await paid("workflow_run_answers", answerId, "judge", 0.01);
        // Shared transcription of a pipeline's item.
        await paid("workflow_run_items", randomUUID(), "call", 0.07);

        const summary = await loadWorkerCostSummary(pool);
        const model = summary.find(
            (row) => row.providerOrModel === "mock-provider",
        );
        expect(model).toMatchObject({
            providerOrModel: "mock-provider",
            costSource: "provider_reported",
            cells: 2,
            inputTokens: 200,
            outputTokens: 100,
        });
        expect(model?.estimatedCostUsd).toBeCloseTo(0.75);
        // Judging a cached answer still pays the judge, so it counts.
        const judge = summary.find(
            (row) => !row.workflow && row.providerOrModel === "judge",
        );
        expect(judge).toMatchObject({ workflow: false, cells: 2 });
        expect(judge?.estimatedCostUsd).toBeCloseTo(0.08);
        const workflowJudge = summary.find(
            (row) => row.workflow && row.providerOrModel === "judge",
        );
        expect(workflowJudge).toMatchObject({ cells: 2 });
        expect(workflowJudge?.estimatedCostUsd).toBeCloseTo(0.03);
        expect(
            summary.find(
                (row) =>
                    row.workflow && row.providerOrModel === "transcription",
            )?.estimatedCostUsd,
        ).toBeCloseTo(0.07);
        expect(
            summary.find(
                (row) =>
                    row.workflow &&
                    row.providerOrModel === "mock-workflow-provider",
            ),
        ).toMatchObject({
            costSource: "provider_reported",
            cells: 1,
            estimatedCostUsd: 0.4,
            inputTokens: 80,
            outputTokens: 40,
        });
    });

    it("keeps spend of deleted runs, labelled as such", async () => {
        // The daily cap counts these ledger rows; their cells are gone.
        await paid("run_cells", randomUUID(), "call", 0.6);
        await paid("workflow_run_cells", randomUUID(), "call", 0.3);

        const summary = await loadWorkerCostSummary(pool);
        expect(
            summary.find(
                (row) =>
                    !row.workflow && row.providerOrModel === "deleted runs",
            ),
        ).toMatchObject({ costSource: "deleted runs", cells: 1 });
        expect(
            summary.find(
                (row) => row.workflow && row.providerOrModel === "deleted runs",
            )?.estimatedCostUsd,
        ).toBeCloseTo(0.3);
    });
});
