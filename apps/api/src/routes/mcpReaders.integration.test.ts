import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IDb, ITransactionalDb } from "../db.js";
import {
    datasetSummaryPayload,
    listDatasetItemsPagePayload,
} from "./datasets.js";
import { listRunCellsPagePayload, runSummaryPayload } from "./runs.js";
import {
    listWorkflowRunCellsPagePayload,
    workflowRunSummaryPayload,
} from "./workflowRuns.js";

// Opt in with a disposable migrated database. The large fixture is synthetic.
const databaseUrl = process.env.MOSAIC_TEST_DATABASE_URL;

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
    const createdAt = "2026-10-10T00:00:00.000Z";
    const itemCount = 125;
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
            `insert into dataset_items(id,dataset_id,type,input_text,created_at)
             select gen_random_uuid(),$1,'text','mcp-page-'||n,$2::timestamptz
             from generate_series(1,$3) n`,
            [datasetId, createdAt, itemCount],
        );
        await pool.query(
            `insert into runs(id,team_id,project_id,dataset_id,status,config_snapshot,created_by)
             values($1,$2,$3,$4,'completed','{}'::jsonb,$5)`,
            [runId, teamId, projectId, datasetId, userId],
        );
        await pool.query(
            `insert into run_models(id,run_id,model_id)
             values($1,$3,'model-a'),($2,$3,'model-b')`,
            [runModelIds[0], runModelIds[1], runId],
        );
        await pool.query(
            `insert into run_cells(run_id,dataset_item_id,run_model_id,status,output_json,created_at)
             select $1,i.id,m.id,'succeeded','{"answer":"synthetic"}'::jsonb,$3::timestamptz
             from dataset_items i cross join run_models m
             where i.dataset_id=$2 and i.input_text like 'mcp-page-%'`,
            [runId, datasetId, createdAt],
        );
        await pool.query(
            `insert into prompt_workflows(id,team_id,project_id,name,kind,created_by)
             values($1,$2,$3,'Bounded reader workflow','prompt',$4)`,
            [workflowId, teamId, projectId, userId],
        );
        await pool.query(
            `insert into workflow_runs(
                id,team_id,project_id,workflow_id,dataset_id,status,
                workflow_snapshot,run_target,created_by
             ) values($1,$2,$3,$4,$5,'completed','{}'::jsonb,'dataset',$6)`,
            [workflowRunId, teamId, projectId, workflowId, datasetId, userId],
        );
        await pool.query(
            `insert into workflow_run_cells(
                workflow_run_id,dataset_item_id,node_key,status,input_text,output_json,created_at
             ) select $1,id,'input','succeeded',input_text,
                '{"answer":"synthetic"}'::jsonb,$3::timestamptz
             from dataset_items where dataset_id=$2 and input_text like 'mcp-page-%'`,
            [workflowRunId, datasetId, createdAt],
        );
    });

    afterAll(async () => {
        try {
            await pool.query("delete from workflow_runs where team_id=$1", [
                teamId,
            ]);
            await pool.query("delete from prompt_workflows where team_id=$1", [
                teamId,
            ]);
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
        expect(summary.itemCount).toBe(itemCount);

        const ids: string[] = [];
        let cursor: { createdAt: string; id: string } | undefined;
        let complete = false;
        while (!complete) {
            const page = await listDatasetItemsPagePayload(db, {
                teamId,
                projectId,
                datasetId,
                limit: 40,
                cursor,
                includeInputText: true,
            });
            ids.push(...page.items.map((item) => item.id));
            complete = page.complete;
            cursor = page.nextCursor;
            if (!complete) expect(page.items).toHaveLength(40);
        }
        expect(ids).toHaveLength(itemCount);
        expect(new Set(ids).size).toBe(itemCount);
    });

    it("pages run cells by stable timestamp/id order, supports filters, and keeps details opt-in", async () => {
        const summary = await runSummaryPayload(db, teamId, projectId, runId);
        expect(summary.progress).toMatchObject({
            total: itemCount * 2,
            done: itemCount * 2,
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
                limit: 50,
                cursor,
            });
            expect(page.cells[0]).not.toHaveProperty("inputText");
            expect(page.cells[0]).not.toHaveProperty("output");
            allIds.push(...page.cells.map((cell) => cell.id));
            complete = page.complete;
            cursor = page.nextCursor;
        }
        expect(allIds).toHaveLength(itemCount * 2);
        expect(new Set(allIds).size).toBe(itemCount * 2);

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
            total: itemCount,
            done: itemCount,
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
                limit: 50,
                cursor,
                includeInputText: true,
                includeOutput: true,
            });
            ids.push(...page.cells.map((cell) => cell.id));
            complete = page.complete;
            cursor = page.nextCursor;
        }
        expect(ids).toHaveLength(itemCount);
        expect(new Set(ids).size).toBe(itemCount);
    });
});
