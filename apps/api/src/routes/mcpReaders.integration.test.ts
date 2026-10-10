import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IDb, ITransactionalDb } from "../db.js";
import {
    datasetSummaryPayload,
    listDatasetItemsPagePayload,
    listDatasetSummariesPagePayload,
} from "./datasets.js";
import {
    listRunCellsPagePayload,
    listRunSummariesPagePayload,
    runSummaryPayload,
} from "./runs.js";
import {
    listWorkflowRunCellsPagePayload,
    listWorkflowRunSummariesPagePayload,
    listWorkflowSummariesPagePayload,
    workflowRunSummaryPayload,
} from "./workflows.js";

// Opt in with a disposable migrated database. The large fixture is synthetic.
const databaseUrl = process.env.MOSAIC_TEST_DATABASE_URL;
type PageCursor = { createdAt: string; id: string };

async function collectPageIds(
    fetchPage: (cursor?: PageCursor) => Promise<{
        ids: string[];
        complete: boolean;
        nextCursor?: PageCursor;
    }>,
) {
    const ids: string[] = [];
    const cursors: PageCursor[] = [];
    let cursor: PageCursor | undefined;
    for (let pageNumber = 0; pageNumber < 1_000; pageNumber += 1) {
        const page = await fetchPage(cursor);
        ids.push(...page.ids);
        if (page.complete) return { ids, cursors };
        if (!page.nextCursor) {
            throw new Error("Incomplete page did not return a next cursor.");
        }
        cursors.push(page.nextCursor);
        cursor = page.nextCursor;
    }
    throw new Error("Pagination did not complete within 1,000 pages.");
}

describe.skipIf(!databaseUrl)("bounded MCP readers (PostgreSQL)", () => {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    const teamId = randomUUID();
    const projectId = randomUUID();
    const userId = randomUUID();
    const datasetId = randomUUID();
    const runId = randomUUID();
    const workflowId = randomUUID();
    const workflowRunId = randomUUID();
    const runModelIds = [randomUUID(), randomUUID()];
    const createdAt = "2000-01-01T00:00:00.000Z";
    const itemCount = 125;
    const totalItemCount = itemCount + 4;
    const listFixtureCount = 125;
    const db: ITransactionalDb = {
        query: (text, values) => pool.query(text, values),
        async transaction<T>(run: (tx: IDb) => Promise<T>): Promise<T> {
            const client = await pool.connect();
            try {
                await client.query("begin");
                const result = await run({
                    query: (text, values) => client.query(text, values),
                });
                await client.query("commit");
                return result;
            } catch (error) {
                await client.query("rollback");
                throw error;
            } finally {
                client.release();
            }
        },
    };

    beforeAll(async () => {
        await pool.query("insert into teams(id,name) values($1,$2)", [
            teamId,
            `MCP bounded readers ${teamId}`,
        ]);
        await pool.query(
            "insert into users(id,team_id,email) values($1,$2,$3)",
            [userId, teamId, `${userId}@example.invalid`],
        );
        await pool.query(
            "insert into projects(id,team_id,name) values($1,$2,$3)",
            [projectId, teamId, `MCP bounded readers ${projectId}`],
        );
        await pool.query(
            `insert into datasets(id,team_id,project_id,name,purpose,modality,created_by)
             values($1,$2,$3,'Bounded reader fixture','evaluation','text',$4)`,
            [datasetId, teamId, projectId, userId],
        );
        await pool.query(
            `insert into datasets(id,team_id,project_id,name,purpose,modality,created_by,created_at)
             select gen_random_uuid(),$1,$2,'MCP list dataset '||n,'evaluation','text',$3,
                case n%3
                    when 0 then '2000-01-01T00:00:00.000001Z'::timestamptz
                    when 1 then '2000-01-01T00:00:00.000002Z'::timestamptz
                    else '2000-01-01T00:00:00.000003Z'::timestamptz
                end
             from generate_series(1,$4) n`,
            [teamId, projectId, userId, listFixtureCount - 1],
        );
        await pool.query(
            `insert into dataset_items(id,dataset_id,type,input_text,created_at)
             select gen_random_uuid(),$1,'text','mcp-page-'||n,$2::timestamptz
             from generate_series(1,$3) n`,
            [datasetId, createdAt, itemCount],
        );
        await pool.query(
            `insert into dataset_items(dataset_id,type,input_text,created_at)
             values
                ($1,'text','mcp-micros-001','2000-01-01T00:00:00.123001Z'::timestamptz),
                ($1,'text','mcp-micros-456','2000-01-01T00:00:00.123456Z'::timestamptz),
                ($1,'text','mcp-micros-654','2000-01-01T00:00:00.654321Z'::timestamptz),
                ($1,'text','mcp-default-now',default)`,
            [datasetId],
        );
        await pool.query(
            `insert into runs(id,team_id,project_id,dataset_id,status,config_snapshot,created_by)
             values($1,$2,$3,$4,'completed','{}'::jsonb,$5)`,
            [runId, teamId, projectId, datasetId, userId],
        );
        await pool.query(
            `insert into runs(id,team_id,project_id,dataset_id,status,config_snapshot,created_by,created_at)
             select gen_random_uuid(),$1,$2,$3,'completed','{}'::jsonb,$4,
                case n%3
                    when 0 then '2000-01-01T00:00:00.000001Z'::timestamptz
                    when 1 then '2000-01-01T00:00:00.000002Z'::timestamptz
                    else '2000-01-01T00:00:00.000003Z'::timestamptz
                end
             from generate_series(1,$5) n`,
            [teamId, projectId, datasetId, userId, listFixtureCount - 1],
        );
        await pool.query(
            `insert into run_models(id,run_id,model_id)
             values($1,$3,'model-a'),($2,$3,'model-b')`,
            [runModelIds[0], runModelIds[1], runId],
        );
        await pool.query(
            `insert into run_cells(run_id,dataset_item_id,run_model_id,status,output_json,created_at)
             select $1,i.id,m.id,'succeeded','{"answer":"synthetic"}'::jsonb,i.created_at
             from dataset_items i cross join run_models m
             where i.dataset_id=$2 and m.run_id=$1`,
            [runId, datasetId],
        );
        await pool.query(
            `insert into run_cell_annotations(run_cell_id,verdict,comment,updated_by)
             select id,'needs_review','synthetic review note',$2
             from run_cells where run_id=$1 order by created_at asc,id asc limit 1`,
            [runId, userId],
        );
        await pool.query(
            `insert into cell_scores(run_cell_id,scorer_type,score)
             select id,'judge',0.75
             from run_cells where run_id=$1 order by created_at asc,id asc limit 1`,
            [runId],
        );
        await pool.query(
            `insert into prompt_workflows(id,team_id,project_id,name,kind,created_by)
             values($1,$2,$3,'Bounded reader workflow','prompt',$4)`,
            [workflowId, teamId, projectId, userId],
        );
        await pool.query(
            `insert into prompt_workflows(id,team_id,project_id,name,kind,created_by,created_at)
             select gen_random_uuid(),$1,$2,'MCP list workflow '||n,'prompt',$3,
                case n%3
                    when 0 then '2000-01-01T00:00:00.000001Z'::timestamptz
                    when 1 then '2000-01-01T00:00:00.000002Z'::timestamptz
                    else '2000-01-01T00:00:00.000003Z'::timestamptz
                end
             from generate_series(1,$4) n`,
            [teamId, projectId, userId, listFixtureCount - 1],
        );
        await pool.query(
            `insert into workflow_runs(
                id,team_id,project_id,workflow_id,dataset_id,status,
                workflow_snapshot,run_target,created_by
             ) values($1,$2,$3,$4,$5,'completed','{}'::jsonb,'dataset',$6)`,
            [workflowRunId, teamId, projectId, workflowId, datasetId, userId],
        );
        await pool.query(
            `insert into workflow_runs(
                id,team_id,project_id,workflow_id,dataset_id,status,
                workflow_snapshot,run_target,created_by,created_at
             ) select gen_random_uuid(),$1,$2,$3,$4,'completed','{}'::jsonb,
                'dataset',$5,
                case n%3
                    when 0 then '2000-01-01T00:00:00.000001Z'::timestamptz
                    when 1 then '2000-01-01T00:00:00.000002Z'::timestamptz
                    else '2000-01-01T00:00:00.000003Z'::timestamptz
                end
             from generate_series(1,$6) n`,
            [
                teamId,
                projectId,
                workflowId,
                datasetId,
                userId,
                listFixtureCount - 1,
            ],
        );
        await pool.query(
            `insert into workflow_run_cells(
                workflow_run_id,dataset_item_id,node_key,status,input_text,output_json,created_at
             ) select $1,id,'input','succeeded',input_text,
                '{"answer":"synthetic"}'::jsonb,created_at
             from dataset_items where dataset_id=$2`,
            [workflowRunId, datasetId],
        );
        await pool.query(
            `insert into workflow_run_cell_annotations(
                workflow_run_cell_id,verdict,comment,updated_by
             ) select id,'needs_review','synthetic workflow review note',$2
             from workflow_run_cells where workflow_run_id=$1
             order by created_at asc,id asc limit 1`,
            [workflowRunId, userId],
        );
        await pool.query(
            `insert into workflow_cell_scores(workflow_run_cell_id,scorer_type,score)
             select id,'judge',0.5
             from workflow_run_cells where workflow_run_id=$1
             order by created_at asc,id asc limit 1`,
            [workflowRunId],
        );
    });

    afterAll(async () => {
        try {
            await pool.query(
                `delete from workflow_run_cell_annotations
                 where workflow_run_cell_id in (
                    select c.id from workflow_run_cells c
                    join workflow_runs r on r.id=c.workflow_run_id
                    where r.team_id=$1
                 )`,
                [teamId],
            );
            await pool.query("delete from workflow_runs where team_id=$1", [
                teamId,
            ]);
            await pool.query("delete from prompt_workflows where team_id=$1", [
                teamId,
            ]);
            await pool.query(
                `delete from run_cell_annotations
                 where run_cell_id in (select id from run_cells where run_id in (select id from runs where team_id=$1))`,
                [teamId],
            );
            await pool.query(
                `delete from cell_scores
                 where run_cell_id in (select id from run_cells where run_id in (select id from runs where team_id=$1))`,
                [teamId],
            );
            await pool.query(
                "delete from run_cells where run_id in (select id from runs where team_id=$1)",
                [teamId],
            );
            await pool.query(
                "delete from run_models where run_id in (select id from runs where team_id=$1)",
                [teamId],
            );
            await pool.query("delete from runs where team_id=$1", [teamId]);
            await pool.query(
                "delete from dataset_items where dataset_id in (select id from datasets where team_id=$1)",
                [teamId],
            );
            await pool.query("delete from datasets where team_id=$1", [teamId]);
            await pool.query("delete from projects where team_id=$1", [teamId]);
            await pool.query("delete from users where team_id=$1", [teamId]);
            await pool.query("delete from teams where id=$1", [teamId]);
        } finally {
            await pool.end();
        }
    });

    it("pages 125 dataset items without dropping rows and summarizes them", async () => {
        const summary = await datasetSummaryPayload(
            db,
            teamId,
            projectId,
            datasetId,
        );
        expect(summary.itemCount).toBe(totalItemCount);

        const ids: string[] = [];
        let cursor: { createdAt: string; id: string } | undefined;
        let complete = false;
        while (!complete) {
            const page = await listDatasetItemsPagePayload(db, {
                teamId,
                projectId,
                datasetId,
                // The page ends on the first row in a group of timestamps
                // whose values differ only below JavaScript Date precision.
                limit: itemCount + 2,
                cursor,
                includeInputText: true,
            });
            ids.push(...page.items.map((item) => item.id));
            complete = page.complete;
            cursor = page.nextCursor;
            if (!complete) {
                expect(page.items).toHaveLength(itemCount + 2);
                expect(cursor?.createdAt).toBe("2000-01-01T00:00:00.123456Z");
            }
        }
        expect(ids).toHaveLength(totalItemCount);
        expect(new Set(ids).size).toBe(totalItemCount);
    });

    it("pages run cells by stable timestamp/id order, supports filters, and keeps details opt-in", async () => {
        const summary = await runSummaryPayload(db, teamId, projectId, runId);
        expect(summary.progress).toMatchObject({
            total: totalItemCount * 2,
            done: totalItemCount * 2,
        });
        expect(summary.modelIds).toEqual(["model-a", "model-b"]);

        const allIds: string[] = [];
        let cursor: { createdAt: string; id: string } | undefined;
        let complete = false;
        while (!complete) {
            const page = await listRunCellsPagePayload(db, {
                teamId,
                projectId,
                runId,
                limit: itemCount * 2 + 1,
                cursor,
            });
            expect(page.cells[0]).not.toHaveProperty("inputText");
            expect(page.cells[0]).not.toHaveProperty("output");
            allIds.push(...page.cells.map((cell) => cell.id));
            complete = page.complete;
            cursor = page.nextCursor;
        }
        expect(allIds).toHaveLength(totalItemCount * 2);
        expect(new Set(allIds).size).toBe(totalItemCount * 2);

        const filtered = await listRunCellsPagePayload(db, {
            teamId,
            projectId,
            runId,
            limit: 10,
            modelId: "model-a",
            status: "succeeded",
            includeInputText: true,
            includeOutput: true,
        });
        expect(filtered.cells).toHaveLength(10);
        expect(filtered.cells[0]).toMatchObject({
            modelId: "model-a",
            status: "succeeded",
            inputText: expect.stringMatching(/^mcp-page-/),
            output: { answer: "synthetic" },
        });
        expect(filtered.complete).toBe(false);

        const reviewed = await listRunCellsPagePayload(db, {
            teamId,
            projectId,
            runId,
            limit: 10,
            reviewVerdict: "needs_review",
            includeReview: true,
            includeScores: true,
        });
        expect(reviewed.cells).toHaveLength(1);
        expect(reviewed.cells[0]).toMatchObject({
            review: {
                verdict: "needs_review",
                comment: "synthetic review note",
            },
            scores: [{ scorerType: "judge", score: 0.75 }],
        });
    });

    it("summarizes and fully pages a 125-cell workflow run", async () => {
        const summary = await workflowRunSummaryPayload(
            db,
            teamId,
            projectId,
            workflowId,
            workflowRunId,
        );
        expect(summary.progress).toMatchObject({
            total: totalItemCount,
            done: totalItemCount,
            failed: 0,
            pending: 0,
        });

        const ids: string[] = [];
        let cursor: { createdAt: string; id: string } | undefined;
        let complete = false;
        while (!complete) {
            const page = await listWorkflowRunCellsPagePayload(db, {
                teamId,
                projectId,
                workflowId,
                runId: workflowRunId,
                limit: itemCount + 1,
                cursor,
                includeInputText: true,
                includeOutput: true,
            });
            ids.push(...page.cells.map((cell) => cell.id));
            complete = page.complete;
            cursor = page.nextCursor;
        }
        expect(ids).toHaveLength(totalItemCount);
        expect(new Set(ids).size).toBe(totalItemCount);

        const reviewed = await listWorkflowRunCellsPagePayload(db, {
            teamId,
            projectId,
            workflowId,
            runId: workflowRunId,
            limit: 10,
            reviewVerdict: "needs_review",
            includeReview: true,
            includeScores: true,
        });
        expect(reviewed.cells).toHaveLength(1);
        expect(reviewed.cells[0]).toMatchObject({
            review: {
                verdict: "needs_review",
                comment: "synthetic workflow review note",
            },
            scores: [{ scorerType: "judge", score: 0.5 }],
        });
    });

    it("pages large dataset, run, workflow, and workflow-run summary lists", async () => {
        const datasetPages = await collectPageIds(async (cursor) => {
            const page = await listDatasetSummariesPagePayload(
                db,
                teamId,
                projectId,
                { limit: 40, includeArchived: false, cursor },
            );
            return {
                ids: page.datasets.map((dataset) => dataset.id),
                complete: page.complete,
                nextCursor: page.nextCursor,
            };
        });
        const runPages = await collectPageIds(async (cursor) => {
            const page = await listRunSummariesPagePayload(
                db,
                teamId,
                projectId,
                { limit: 40, cursor },
            );
            return {
                ids: page.runs.map((run) => run.id),
                complete: page.complete,
                nextCursor: page.nextCursor,
            };
        });
        const workflowPages = await collectPageIds(async (cursor) => {
            const page = await listWorkflowSummariesPagePayload(
                db,
                teamId,
                projectId,
                { limit: 40, kind: "prompt", cursor },
            );
            return {
                ids: page.workflows.map((workflow) => workflow.id),
                complete: page.complete,
                nextCursor: page.nextCursor,
            };
        });
        const workflowRunPages = await collectPageIds(async (cursor) => {
            const page = await listWorkflowRunSummariesPagePayload(
                db,
                teamId,
                projectId,
                workflowId,
                { limit: 40, cursor },
            );
            return {
                ids: page.workflowRuns.map((run) => run.id),
                complete: page.complete,
                nextCursor: page.nextCursor,
            };
        });

        for (const pages of [
            datasetPages,
            runPages,
            workflowPages,
            workflowRunPages,
        ]) {
            expect(pages.ids).toHaveLength(listFixtureCount);
            expect(new Set(pages.ids).size).toBe(listFixtureCount);
            expect(pages.cursors).toHaveLength(3);
            expect(pages.cursors[0]?.createdAt).toMatch(/\.\d{6}Z$/);
        }
    });
});
