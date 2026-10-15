import { randomUUID } from "node:crypto";
import pg from "pg";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";
import { retryWorkflowRunPayload } from "./workflowRunRetry.js";

// Session-local tables exercise the real retry SQL without touching application data.
const databaseUrl = process.env.MOSAIC_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
    "workflow retry spend checkpoint (PostgreSQL)",
    () => {
        const client = new pg.Client({ connectionString: databaseUrl });
        const input = {
            teamId: randomUUID(),
            projectId: randomUUID(),
            workflowId: randomUUID(),
            workflowRunId: randomUUID(),
        };
        const cellId = randomUUID();
        beforeAll(async () => {
            await client.connect();
        });
        afterAll(async () => {
            await client.end();
        });
        beforeEach(async () => {
            await client.query("begin");
            await client.query(`
            create temporary table workflow_runs (id uuid primary key, team_id uuid, project_id uuid, workflow_id uuid, status text, enqueue_status text);
            create temporary table workflow_run_cells (id uuid primary key, workflow_run_id uuid, status text, output_json jsonb, latency_ms float8, cost_usd float8, error text, claimed_at timestamptz);
            create temporary table workflow_cell_scores (workflow_run_cell_id uuid);
            create temporary table workflow_run_items (workflow_run_id uuid, preparation_status text, evaluation_status text, claimed_at timestamptz, lease_owner uuid, error text, updated_at timestamptz);
            create temporary table workflow_run_enqueue_outbox (project_id uuid, workflow_run_id uuid unique, status text default 'pending_enqueue', publish_attempts int default 0, available_at timestamptz, queued_at timestamptz, last_error text, updated_at timestamptz);
        `);
            await client.query(
                "insert into workflow_runs values ($1,$2,$3,$4,'partial','queued')",
                [
                    input.workflowRunId,
                    input.teamId,
                    input.projectId,
                    input.workflowId,
                ],
            );
        });
        afterEach(async () => {
            await client.query("rollback");
        });
        it.each([
            { costUsd: 0.02, costSource: "computed" },
            { costSource: "unavailable" },
        ])(
            "keeps prior spend %j while clearing stale outputs and scores",
            async (spend) => {
                await client.query(
                    "insert into workflow_run_cells values ($1,$2,'failed',$3,500,$4,'later chunk failed',now())",
                    [
                        cellId,
                        input.workflowRunId,
                        JSON.stringify({
                            text: "stale output",
                            json: { stale: true },
                            providerMetadata: {
                                transcriptionSpend: spend,
                                unrelated: "discard",
                            },
                        }),
                        "costUsd" in spend ? spend.costUsd : null,
                    ],
                );
                await client.query(
                    "insert into workflow_cell_scores values ($1)",
                    [cellId],
                );
                expect(
                    await retryWorkflowRunPayload(
                        { query: (text, values) => client.query(text, values) },
                        input,
                    ),
                ).toEqual({ retriedCellCount: 1 });
                const row = (
                    await client.query(
                        "select * from workflow_run_cells where id=$1",
                        [cellId],
                    )
                ).rows[0];
                expect(row).toMatchObject({
                    status: "pending",
                    cost_usd: "costUsd" in spend ? spend.costUsd : null,
                    latency_ms: null,
                    error: null,
                    claimed_at: null,
                });
                expect(row.output_json).toEqual({
                    text: "",
                    providerMetadata: { transcriptionSpend: spend },
                });
                expect(
                    (await client.query("select * from workflow_cell_scores"))
                        .rows,
                ).toEqual([]);
            },
        );
    },
);
