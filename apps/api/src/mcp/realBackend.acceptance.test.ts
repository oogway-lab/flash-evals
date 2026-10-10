import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IApiConfig } from "../config.js";
import type { IDb, ITransactionalDb } from "../db.js";
import { resolveApiFeatureFlags } from "../featureFlags.js";
import type { IApiRuntime } from "../server.js";
import { createMcpTokenSecret, hashMcpToken } from "./auth.js";
import { handleMcpRequest } from "./http.js";

/*
 * Real server + real routes + real PostgreSQL + local filesystem storage.
 * No domain handler is mocked. The bearer token and all rows are synthetic.
 * Configure a disposable, migrated DB named flash_evals_mcp_acceptance and
 * set MOSAIC_MCP_ACCEPTANCE_DATABASE_URL to its loopback connection string.
 */
const databaseUrl =
    process.env.MOSAIC_MCP_ACCEPTANCE_DATABASE_URL?.trim() ?? "";

describe.skipIf(!databaseUrl)("MCP real-backend acceptance", () => {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    const teamId = randomUUID();
    const userId = randomUUID();
    const foreignTeamId = randomUUID();
    const foreignUserId = randomUUID();
    const fixtureProjectId = randomUUID();
    const fixtureValidationAttemptId = randomUUID();
    const fixtureRunId = randomUUID();
    const fixtureRunModelId = randomUUID();
    const fixtureRunCellId = randomUUID();
    const fixtureToken = createMcpTokenSecret();
    const uploadDir = path.join(
        os.tmpdir(),
        `flash-evals-mcp-acceptance-${randomUUID()}`,
    );
    const previousUploadDir = process.env.UPLOAD_DIR;
    const fixture = {
        workspaceId: "",
        projectId: "",
        imageDatasetId: "",
        imageItemId: "",
        imageStorageKey: "",
        workflowId: "",
        multiWorkflowId: "",
        workflowRunId: "",
        workflowRunCellId: "",
        evalRunId: "",
    };

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

    const config = acceptanceConfig(databaseUrl);
    const runtime: IApiRuntime = { config, db };
    let requestId = 0;

    beforeAll(async () => {
        assertDisposableLocalDatabase(databaseUrl!);
        const migrated = await pool.query<{ projects: string | null }>(
            "select to_regclass('public.projects')::text as projects",
        );
        expect(migrated.rows[0]?.projects).toBe("projects");
        process.env.UPLOAD_DIR = uploadDir;
        await fs.mkdir(uploadDir, { recursive: true });

        await pool.query("insert into teams(id,name) values($1,$2)", [
            teamId,
            `MCP real-backend acceptance ${teamId}`,
        ]);
        await pool.query(
            "insert into users(id,team_id,email,name) values($1,$2,$3,$4)",
            [userId, teamId, `${userId}@example.invalid`, "Synthetic MCP user"],
        );
        await pool.query(
            `insert into mcp_access_tokens(user_id,team_id,name,token_hash,created_by)
             values($1,$2,'acceptance',$3,$1)`,
            [
                userId,
                teamId,
                hashMcpToken(fixtureToken, config.mosaicMcpTokenPepper),
            ],
        );

        await pool.query("insert into teams(id,name) values($1,$2)", [
            foreignTeamId,
            `MCP foreign fixture ${foreignTeamId}`,
        ]);
        await pool.query(
            "insert into users(id,team_id,email,name) values($1,$2,$3,$4)",
            [
                foreignUserId,
                foreignTeamId,
                `${foreignUserId}@example.invalid`,
                "Synthetic foreign user",
            ],
        );
        const foreignWorkspaceId = randomUUID();
        await pool.query(
            "insert into workspaces(id,team_id,name,owner_user_id) values($1,$2,$3,$4)",
            [
                foreignWorkspaceId,
                foreignTeamId,
                `Foreign workspace ${foreignWorkspaceId}`,
                foreignUserId,
            ],
        );
        await pool.query(
            "insert into projects(id,team_id,workspace_id,name,created_by) values($1,$2,$3,$4,$5)",
            [
                fixtureProjectId,
                foreignTeamId,
                foreignWorkspaceId,
                `Foreign project ${fixtureProjectId}`,
                foreignUserId,
            ],
        );
    });

    afterAll(async () => {
        try {
            const immutableRouteFixture = await pool.query<{
                retained: boolean;
            }>(
                "select exists(select 1 from llm_route_versions where team_id=$1) as retained",
                [teamId],
            );
            // Route-version history is protected by database triggers and can
            // never be deleted. In that case, preserve the complete synthetic
            // fixture graph and discard this explicitly disposable database.
            if (!immutableRouteFixture.rows[0]?.retained) {
                await pool.query(
                    "delete from api_rate_limits where bucket_key like $1",
                    [`%:${teamId}:%`],
                );
                const pgBoss = await pool.query<{ relation: string | null }>(
                    "select to_regclass('pgboss.job')::text as relation",
                );
                const syntheticRunIds = [
                    fixtureRunId,
                    fixture.evalRunId,
                ].filter(Boolean);
                if (pgBoss.rows[0]?.relation && syntheticRunIds.length) {
                    await pool.query(
                        `delete from pgboss.job
                     where name='eval-run' and data->>'runId'=any($1::text[])`,
                        [syntheticRunIds],
                    );
                }
                if (pgBoss.rows[0]?.relation && fixture.workflowRunId) {
                    await pool.query(
                        `delete from pgboss.job
                     where name='workflow-run' and data->>'workflowRunId'=$1`,
                        [fixture.workflowRunId],
                    );
                }
                await pool.query(
                    `delete from workflow_run_cell_annotations
                 where workflow_run_cell_id in (
                    select id from workflow_run_cells
                    where workflow_run_id in (select id from workflow_runs where team_id=$1)
                 )`,
                    [teamId],
                );
                await pool.query(
                    "delete from workflow_run_notes where workflow_run_id in (select id from workflow_runs where team_id=$1)",
                    [teamId],
                );
                await pool.query(
                    "delete from workflow_run_enqueue_outbox where workflow_run_id in (select id from workflow_runs where team_id=$1)",
                    [teamId],
                );
                await pool.query(
                    "delete from workflow_run_cells where workflow_run_id in (select id from workflow_runs where team_id=$1)",
                    [teamId],
                );
                await pool.query("delete from workflow_runs where team_id=$1", [
                    teamId,
                ]);
                await pool.query(
                    "delete from workflow_edges where workflow_id in (select id from prompt_workflows where team_id=$1)",
                    [teamId],
                );
                await pool.query(
                    "delete from workflow_nodes where workflow_id in (select id from prompt_workflows where team_id=$1)",
                    [teamId],
                );
                await pool.query(
                    "delete from prompt_workflows where team_id=$1",
                    [teamId],
                );
                await pool.query(
                    "delete from project_llm_defaults where team_id=$1",
                    [teamId],
                );
                await pool.query(
                    "delete from llm_route_versions where team_id=$1",
                    [teamId],
                );
                await pool.query("delete from llm_routes where team_id=$1", [
                    teamId,
                ]);
                await pool.query(
                    "delete from llm_capability_versions where team_id=$1",
                    [teamId],
                );
                await pool.query(
                    "delete from run_cell_annotations where run_cell_id in (select id from run_cells where run_id=$1)",
                    [fixtureRunId],
                );
                await pool.query("delete from run_notes where run_id=$1", [
                    fixtureRunId,
                ]);
                await pool.query("delete from run_cells where run_id=$1", [
                    fixtureRunId,
                ]);
                await pool.query("delete from run_models where run_id=$1", [
                    fixtureRunId,
                ]);
                await pool.query("delete from runs where id=$1", [
                    fixtureRunId,
                ]);
                await pool.query(
                    `delete from prompt_version_fit_tags
                 where prompt_version_id in (
                    select pv.id from prompt_versions pv join prompts p on p.id=pv.prompt_id where p.team_id=$1
                 )`,
                    [teamId],
                );
                await pool.query(
                    "update prompt_versions set status='legacy', validation_attempt_id=null where prompt_id in (select id from prompts where team_id=$1)",
                    [teamId],
                );
                await pool.query(
                    "delete from prompt_validation_attempts where team_id=$1",
                    [teamId],
                );
                await pool.query(
                    "delete from prompt_versions where prompt_id in (select id from prompts where team_id=$1)",
                    [teamId],
                );
                await pool.query(
                    "delete from prompt_schema_versions where prompt_id in (select id from prompts where team_id=$1)",
                    [teamId],
                );
                await pool.query("delete from prompts where team_id=$1", [
                    teamId,
                ]);
                await pool.query(
                    "delete from prompt_schema_generation_attempts where team_id=$1",
                    [teamId],
                );
                await pool.query(
                    "delete from prompt_optimization_attempts where team_id=$1",
                    [teamId],
                );
                await pool.query(
                    "delete from stt_route_probes where team_id=$1",
                    [teamId],
                );
                if (fixture.imageDatasetId) {
                    await pool.query(
                        "delete from labels where dataset_item_id in (select id from dataset_items where dataset_id=$1)",
                        [fixture.imageDatasetId],
                    );
                    await pool.query(
                        "delete from dataset_items where dataset_id=$1",
                        [fixture.imageDatasetId],
                    );
                    await pool.query("delete from datasets where id=$1", [
                        fixture.imageDatasetId,
                    ]);
                }
                if (fixture.projectId) {
                    await pool.query(
                        "delete from labels where dataset_item_id in (select i.id from dataset_items i join datasets d on d.id=i.dataset_id where d.project_id=$1)",
                        [fixture.projectId],
                    );
                    await pool.query(
                        "delete from dataset_items where dataset_id in (select id from datasets where project_id=$1)",
                        [fixture.projectId],
                    );
                    await pool.query(
                        "delete from datasets where project_id=$1",
                        [fixture.projectId],
                    );
                    await pool.query("delete from projects where id=$1", [
                        fixture.projectId,
                    ]);
                }
                if (fixture.workspaceId) {
                    await pool.query("delete from workspaces where id=$1", [
                        fixture.workspaceId,
                    ]);
                }
                await pool.query("delete from projects where id=$1", [
                    fixtureProjectId,
                ]);
                await pool.query("delete from workspaces where team_id=$1", [
                    foreignTeamId,
                ]);
                await pool.query(
                    "delete from mcp_access_tokens where user_id=$1",
                    [userId],
                );
                await pool.query("delete from provider_keys where team_id=$1", [
                    teamId,
                ]);
                await pool.query("delete from users where id in ($1,$2)", [
                    userId,
                    foreignUserId,
                ]);
                await pool.query("delete from teams where id in ($1,$2)", [
                    teamId,
                    foreignTeamId,
                ]);
            }
        } finally {
            await pool.end();
            if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
            else process.env.UPLOAD_DIR = previousUploadDir;
            await fs.rm(uploadDir, { recursive: true, force: true });
        }
    });

    it("creates and reads tenant-owned workspaces, projects, and datasets through tools/call", async () => {
        const tools = await rpc("tools/list", {});
        expect(tools.result?.tools).toHaveLength(84);

        const workspace = data(
            await tool("create_workspace", { name: "Acceptance workspace" }),
        );
        expect(workspace.id).toMatch(UUID_PATTERN);
        fixture.workspaceId = workspace.id as string;
        expect(
            (
                await pool.query(
                    "select id from workspaces where id=$1 and team_id=$2",
                    [fixture.workspaceId, teamId],
                )
            ).rowCount,
        ).toBe(1);

        const project = data(
            await tool("create_project", {
                workspaceId: fixture.workspaceId,
                name: "Acceptance project",
            }),
        );
        expect(project.id).toMatch(UUID_PATTERN);
        fixture.projectId = project.id as string;
        const renamedWorkspace = data(
            await tool("rename_workspace", {
                workspaceId: fixture.workspaceId,
                name: "Acceptance workspace renamed",
            }),
        );
        expect(renamedWorkspace.name).toBe("Acceptance workspace renamed");
        const updatedProject = data(
            await tool("update_project", {
                workspaceId: fixture.workspaceId,
                projectId: fixture.projectId,
                name: "Acceptance project renamed",
            }),
        );
        expect(updatedProject.name).toBe("Acceptance project renamed");

        const dataset = data(
            await tool("create_dataset", {
                projectId: fixture.projectId,
                name: "Acceptance text dataset",
                purpose: "evaluation",
                modality: "text",
            }),
        );
        const datasetId = dataset.id as string;
        expect(datasetId).toMatch(UUID_PATTERN);
        const imported = data(
            await tool("import_dataset_text_items", {
                projectId: fixture.projectId,
                datasetId,
                format: "jsonl",
                content: [
                    JSON.stringify({ inputText: "first synthetic example" }),
                    JSON.stringify({ inputText: "second synthetic example" }),
                ].join("\n"),
            }),
        );
        expect(imported.importedCount).toBe(2);
        expect(imported.failures).toEqual([]);

        const concurrentCopyInput = {
            projectId: fixture.projectId,
            datasetId,
            idempotencyKey: `copy-concurrent-${teamId}`,
        };
        const [copyResponseA, copyResponseB] = await Promise.all([
            requestRpc("tools/call", {
                name: "duplicate_dataset",
                arguments: concurrentCopyInput,
            }),
            requestRpc("tools/call", {
                name: "duplicate_dataset",
                arguments: concurrentCopyInput,
            }),
        ]);
        expect(copyResponseA.status).toBe(200);
        expect(copyResponseB.status).toBe(200);
        const copyA = data(copyResponseA.body.result as McpToolResult);
        const copyB = data(copyResponseB.body.result as McpToolResult);
        expect(copyA.createdDatasetId).toMatch(UUID_PATTERN);
        expect(copyB.createdDatasetId).toBe(copyA.createdDatasetId);
        expect(copyA.sourceDatasetId).toBe(datasetId);
        const copiedItems = await pool.query<{ count: number }>(
            "select count(*)::int as count from dataset_items where dataset_id=$1",
            [copyA.createdDatasetId],
        );
        expect(copiedItems.rows[0]?.count).toBe(2);

        const droppedResponseInput = {
            projectId: fixture.projectId,
            datasetId,
            idempotencyKey: `copy-lost-response-${teamId}`,
        };
        const firstResponse = await requestRpc("tools/call", {
            name: "duplicate_dataset",
            arguments: droppedResponseInput,
        });
        expect(firstResponse.status).toBe(200);
        expect(firstResponse.body.result?.isError).not.toBe(true);
        // Model a response lost after commit by dropping it at the client edge.
        const retryCopy = data(
            await tool("duplicate_dataset", droppedResponseInput),
        );
        const replayedCopy = data(
            await tool("duplicate_dataset", droppedResponseInput),
        );
        expect(replayedCopy.createdDatasetId).toBe(retryCopy.createdDatasetId);
        const retryCopyCount = await pool.query<{ count: number }>(
            "select count(*)::int as count from datasets where id=$1 and project_id=$2",
            [retryCopy.createdDatasetId, fixture.projectId],
        );
        expect(retryCopyCount.rows[0]?.count).toBe(1);

        const summary = data(
            await tool("get_dataset_summary", {
                projectId: fixture.projectId,
                datasetId,
            }),
        );
        expect(summary.dataset.id).toBe(datasetId);
        expect(summary.itemCount).toBe(2);
        const detail = data(
            await tool("get_dataset", {
                projectId: fixture.projectId,
                datasetId,
            }),
        );
        expect(detail.dataset.id).toBe(datasetId);
        expect(detail.items).toHaveLength(2);
        const listed = data(
            await tool("list_datasets", { projectId: fixture.projectId }),
        );
        expect(listed.map((entry: { id: string }) => entry.id)).toContain(
            datasetId,
        );
        const projects = data(
            await tool("list_projects", { workspaceId: fixture.workspaceId }),
        );
        expect(projects.map((entry: { id: string }) => entry.id)).toContain(
            fixture.projectId,
        );
        expect(data(await tool("get_current_user", {}))).toMatchObject({
            userId,
            teamId,
        });

        const foreign = await rpc("tools/call", {
            name: "get_dataset",
            arguments: { projectId: fixtureProjectId, datasetId },
        });
        expect(foreign.result?.isError).toBe(true);
        expect(foreign.result?.structuredContent?.error?.status).toBe(404);

        const rows = await pool.query<{ id: string }>(
            "select id from dataset_items where dataset_id=$1 order by input_text",
            [datasetId],
        );
        expect(rows.rows).toHaveLength(2);
        // Representative PostgreSQL microsecond timestamps; .000Z fixtures
        // cannot expose cursor truncation from pg's Date-to-millisecond path.
        await pool.query(
            "update dataset_items set created_at='2025-04-05T06:07:08.123456Z' where id=$1",
            [rows.rows[0]!.id],
        );
        await pool.query(
            "update dataset_items set created_at='2025-04-05T06:07:08.654321Z' where id=$1",
            [rows.rows[1]!.id],
        );

        const firstPage = data(
            await tool("list_dataset_items", {
                projectId: fixture.projectId,
                datasetId,
                limit: 1,
                includeInputText: true,
            }),
        );
        expect(firstPage.items).toHaveLength(1);
        expect(firstPage.complete).toBe(false);
        expect(firstPage.items[0]?.inputText).toBe("first synthetic example");
        expect(firstPage.nextCursor).toEqual(expect.any(String));
        const secondPage = data(
            await tool("list_dataset_items", {
                projectId: fixture.projectId,
                datasetId,
                limit: 1,
                includeInputText: true,
                cursor: firstPage.nextCursor,
            }),
        );
        expect(secondPage.items).toHaveLength(1);
        expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
        expect(secondPage.items[0]?.inputText).toBe("second synthetic example");
        expect(secondPage.complete).toBe(true);
    });

    it("reads tenant workspace, eval setup, and dashboard state from PostgreSQL", async () => {
        const { workspaceId, projectId } = fixture;
        const workspaces = data(await tool("list_workspaces", {})) as Array<{
            id: string;
            name: string;
        }>;
        expect(workspaces).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: workspaceId,
                    name: "Acceptance workspace renamed",
                }),
            ]),
        );

        const context = data(
            await tool("list_eval_context", { workspaceId, projectId }),
        );
        expect(context.datasets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: expect.any(String),
                    name: "Acceptance text dataset",
                    itemCount: 2,
                }),
            ]),
        );
        expect(context.llmRouting).toMatchObject({
            capabilities: [],
            routes: [],
        });

        const dashboard = data(
            await tool("get_dashboard", { workspaceId, projectId }),
        );
        const datasetCount = await pool.query<{ count: number }>(
            "select count(*)::int as count from datasets where team_id=$1 and project_id=$2",
            [teamId, projectId],
        );
        expect(dashboard.stats).toMatchObject({
            datasetCount: datasetCount.rows[0]?.count,
            promptCount: 0,
            runCount: 0,
            hasDatasetWithItems: true,
            hasPrompt: false,
        });
    });

    it("runs workflow CRUD, durable creation, reader, and review tools on owned rows", async () => {
        const { projectId } = fixture;
        const dataset = data(await tool("list_datasets", { projectId })).find(
            (row: { name: string }) => row.name === "Acceptance text dataset",
        );
        const datasetId = dataset.id as string;
        const inputNode = {
            nodeKey: "input-1",
            label: "Synthetic input",
            nodeType: "input",
            nodeConfig: {
                type: "input",
                modality: "text",
                datasetId,
            },
            evalConfig: { type: "none" },
        };
        const graph = { nodes: [inputNode], edges: [] };
        const created = data(
            await tool("create_workflow", {
                projectId,
                name: "Acceptance multi workflow",
                description: "Synthetic real-backend graph",
                kind: "multi",
                ...graph,
            }),
        );
        fixture.workflowId = created.id as string;
        expect(fixture.workflowId).toMatch(UUID_PATTERN);
        const initialDetail = data(
            await tool("get_workflow", {
                projectId,
                workflowId: fixture.workflowId,
            }),
        );
        expect(initialDetail).toMatchObject({
            id: fixture.workflowId,
            name: "Acceptance multi workflow",
            kind: "multi",
            nodes: [expect.objectContaining({ nodeKey: "input-1" })],
        });

        const multi = data(
            await tool("create_multiworkflow", {
                projectId,
                name: "Acceptance seeded multi workflow",
                modality: "text",
                datasetId,
            }),
        );
        fixture.multiWorkflowId = multi.id as string;
        expect(fixture.multiWorkflowId).toMatch(UUID_PATTERN);
        expect(
            data(await tool("list_workflows", { projectId })).map(
                (workflow: { id: string }) => workflow.id,
            ),
        ).toEqual(
            expect.arrayContaining([
                fixture.workflowId,
                fixture.multiWorkflowId,
            ]),
        );

        const updated = data(
            await tool("update_workflow", {
                projectId,
                workflowId: fixture.multiWorkflowId,
                name: "Acceptance seeded multi workflow updated",
                description: "Updated through MCP",
                kind: "multi",
                ...graph,
            }),
        );
        expect(updated.id).toBe(fixture.multiWorkflowId);
        expect(updated.name).toBe("Acceptance seeded multi workflow updated");
        await tool("delete_workflow", {
            projectId,
            workflowId: fixture.multiWorkflowId,
            confirm: true,
        });
        expect(
            (
                await pool.query(
                    "select archived_at from prompt_workflows where id=$1",
                    [fixture.multiWorkflowId],
                )
            ).rows[0]?.archived_at,
        ).not.toBeNull();

        const itemId = (
            await pool.query<{ id: string }>(
                "select id from dataset_items where dataset_id=$1 order by input_text limit 1",
                [datasetId],
            )
        ).rows[0]!.id;
        const input = {
            projectId,
            workflowId: fixture.workflowId,
            datasetId,
            runTarget: "single_item",
            itemId,
            idempotencyKey: `workflow-run-${teamId}`,
        };
        const createdRun = data(await tool("create_workflow_run", input));
        fixture.workflowRunId = createdRun.workflowRunId as string;
        expect(fixture.workflowRunId).toMatch(UUID_PATTERN);
        expect(["queued", "pending_enqueue"]).toContain(
            createdRun.enqueueStatus,
        );
        const replay = data(await tool("create_workflow_run", input));
        expect(replay.workflowRunId).toBe(fixture.workflowRunId);
        expect(
            (
                await pool.query(
                    "select count(*)::int as count from workflow_runs where team_id=$1 and idempotency_key=$2",
                    [teamId, input.idempotencyKey],
                )
            ).rows[0]?.count,
        ).toBe(1);

        const workflowCell = (
            await pool.query<{ id: string }>(
                `select id from workflow_run_cells
                 where workflow_run_id=$1 and node_key='input-1' and dataset_item_id=$2`,
                [fixture.workflowRunId, itemId],
            )
        ).rows[0];
        expect(workflowCell).toBeDefined();
        fixture.workflowRunCellId = workflowCell!.id;
        await pool.query(
            "update workflow_runs set status='completed' where id=$1",
            [fixture.workflowRunId],
        );
        await pool.query(
            `update workflow_run_cells set status='succeeded',
                input_text='first synthetic example',output_json='{"seen":true}'::jsonb,
                created_at='2025-04-05T06:07:08.123456Z'
             where id=$1`,
            [fixture.workflowRunCellId],
        );

        const runs = data(
            await tool("list_workflow_runs", {
                projectId,
                workflowId: fixture.workflowId,
            }),
        ) as Array<{ id: string }>;
        expect(runs.map((run) => run.id)).toContain(fixture.workflowRunId);
        const detail = data(
            await tool("get_workflow_run", {
                projectId,
                workflowId: fixture.workflowId,
                workflowRunId: fixture.workflowRunId,
            }),
        );
        expect(detail.workflowRun.id).toBe(fixture.workflowRunId);
        expect(detail.cells).toEqual([
            expect.objectContaining({
                id: fixture.workflowRunCellId,
                nodeKey: "input-1",
                status: "succeeded",
            }),
        ]);
        expect(
            data(
                await tool("get_workflow_run_summary", {
                    projectId,
                    workflowId: fixture.workflowId,
                    workflowRunId: fixture.workflowRunId,
                }),
            ),
        ).toMatchObject({
            run: { id: fixture.workflowRunId, status: "completed" },
            progress: { total: 1, done: 1, failed: 0 },
        });
        expect(
            data(
                await tool("get_workflow_run_progress", {
                    projectId,
                    workflowId: fixture.workflowId,
                    workflowRunId: fixture.workflowRunId,
                }),
            ),
        ).toMatchObject({ total: 1, done: 1, failed: 0 });
        const cells = data(
            await tool("list_workflow_run_cells", {
                projectId,
                workflowId: fixture.workflowId,
                workflowRunId: fixture.workflowRunId,
                includeInputText: true,
                includeOutput: true,
            }),
        );
        expect(cells.cells).toEqual([
            expect.objectContaining({
                id: fixture.workflowRunCellId,
                inputText: "first synthetic example",
                output: { seen: true },
            }),
        ]);
        await tool("save_workflow_run_note", {
            projectId,
            workflowRunId: fixture.workflowRunId,
            body: "Synthetic workflow review note",
        });
        expect(
            (
                await pool.query(
                    "select body from workflow_run_notes where workflow_run_id=$1",
                    [fixture.workflowRunId],
                )
            ).rows[0]?.body,
        ).toBe("Synthetic workflow review note");
        await tool("annotate_workflow_run_cell", {
            projectId,
            workflowRunCellId: fixture.workflowRunCellId,
            verdict: "approved",
            comment: "Synthetic workflow cell verified",
        });
        expect(
            (
                await pool.query(
                    "select verdict,comment from workflow_run_cell_annotations where workflow_run_cell_id=$1",
                    [fixture.workflowRunCellId],
                )
            ).rows[0],
        ).toEqual({
            verdict: "approved",
            comment: "Synthetic workflow cell verified",
        });
    });

    it("sets and clears only a synthetic provider key and reads route metadata", async () => {
        const { projectId } = fixture;
        const before = data(await tool("list_provider_keys", {}));
        expect(before).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    provider: "openai",
                    configured: false,
                }),
            ]),
        );

        const syntheticKey = "sk-test-only-not-a-real-provider-credential";
        expect(
            JSON.stringify(
                await tool("set_provider_key", {
                    provider: "openai",
                    key: syntheticKey,
                }),
            ),
        ).not.toContain(syntheticKey);
        const encrypted = await pool.query<{
            ciphertext: Buffer;
            hint: string;
        }>(
            "select ciphertext,hint from provider_keys where team_id=$1 and provider='openai'",
            [teamId],
        );
        expect(encrypted.rows).toHaveLength(1);
        expect(encrypted.rows[0]?.ciphertext.toString("utf8")).not.toContain(
            syntheticKey,
        );
        expect(encrypted.rows[0]?.hint).toMatch(/^••••.{4}$/);
        expect(data(await tool("list_provider_keys", {}))).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    provider: "openai",
                    configured: true,
                }),
            ]),
        );

        await tool("clear_provider_key", { provider: "openai", confirm: true });
        expect(
            (
                await pool.query(
                    "select id from provider_keys where team_id=$1 and provider='openai'",
                    [teamId],
                )
            ).rowCount,
        ).toBe(0);
        expect(
            data(await tool("list_workflow_llm_capabilities", { projectId })),
        ).toEqual([]);
        expect(
            data(await tool("list_workflow_llm_routes", { projectId })),
        ).toEqual([]);
        expect(
            data(await tool("get_workflow_llm_default", { projectId })),
        ).toEqual({});
        expect(
            data(
                await tool("clear_workflow_llm_default", {
                    projectId,
                    confirm: true,
                }),
            ),
        ).toMatchObject({ default: {} });
    });

    it("runs provider-backed MCP tools through a deterministic no-network adapter", async () => {
        const { projectId } = fixture;
        const realFetch = globalThis.fetch;
        const providerRequests: string[] = [];
        globalThis.fetch = async (input, init) => {
            providerRequests.push(
                `${init?.method ?? (input instanceof Request ? input.method : "GET")} ${new URL(input instanceof Request ? input.url : input.toString()).pathname}`,
            );
            return syntheticProviderFetch(input, init);
        };
        try {
            const syntheticKey = "sk-acceptance-stub-only";
            await tool("set_provider_key", {
                provider: "openai",
                key: syntheticKey,
            });

            const jsonSchema = {
                type: "object",
                additionalProperties: false,
                properties: { class: { type: "string" } },
                required: ["class"],
            };
            const samples = [{ name: "synthetic fruit", inputText: "apple" }];
            const generated = data(
                await tool("generate_schema_from_prompt", {
                    projectId,
                    content: "Return the item's class as JSON.",
                    targetModelId: "gpt-4o",
                    generatorModelId: "gpt-4o-mini",
                }),
            );
            expect(generated).toMatchObject({
                schema: jsonSchema,
                openaiCompatible: true,
            });

            const tested = data(
                await tool("test_prompt_draft", {
                    prompt: "Return the item's class as JSON.",
                    jsonSchema,
                    targetModelId: "gpt-4o",
                    samples,
                }),
            );
            expect(tested.status).toBe("success");
            expect(tested.results).toEqual([
                expect.objectContaining({
                    sampleName: "synthetic fruit",
                    status: "success",
                    parsedOutput: { class: "synthetic" },
                    validation: { valid: true, errors: [] },
                }),
            ]);

            const validation = data(
                await tool("validate_runnable_prompt", {
                    projectId,
                    prompt: "Return the item's class as JSON.",
                    jsonSchema,
                    samples,
                    targetModelId: "gpt-4o",
                }),
            );
            expect(validation).toMatchObject({
                passed: true,
                evidence: {
                    schemaValidation: { localValid: true },
                    sampleResults: [
                        expect.objectContaining({
                            sampleName: "synthetic fruit",
                            status: "passed",
                            parsedOutput: { class: "synthetic" },
                        }),
                    ],
                },
            });

            const runnable = data(
                await tool("create_runnable_prompt", {
                    projectId,
                    name: "Acceptance provider prompt",
                    targetModelId: "gpt-4o",
                    content: "Return the item's class as JSON.",
                    jsonSchema,
                    fieldConfigs: [{ field: "class", kind: "factual" }],
                    samples,
                    fitTags: ["acceptance"],
                }),
            );
            expect(runnable).toMatchObject({
                promptId: expect.stringMatching(UUID_PATTERN),
                promptVersionId: expect.stringMatching(UUID_PATTERN),
                promptVersion: 1,
            });
            expect(
                (
                    await pool.query(
                        `select status,validation_attempt_id from prompt_versions
                         where id=$1 and prompt_id=$2`,
                        [runnable.promptVersionId, runnable.promptId],
                    )
                ).rows[0],
            ).toMatchObject({
                status: "runnable",
                validation_attempt_id: expect.stringMatching(UUID_PATTERN),
            });

            const optimized = data(
                await tool("optimize_prompt", {
                    projectId,
                    content: "Return a category.",
                    targetModelId: "gpt-4o",
                    optimizerModelId: "gpt-4o-mini",
                    jsonSchema,
                }),
            );
            expect(optimized).toMatchObject({
                optimizedPrompt: "Return a concise JSON class.",
                optimizationRationale: "The revised instruction is specific.",
                optimizerAttemptId: expect.stringMatching(UUID_PATTERN),
            });

            const judgeTest = data(
                await tool("test_judge_draft", {
                    content: "Score correctness.",
                    targetModelId: "gpt-4o",
                    declaredInputs: ["task_input", "candidate_output"],
                    taskInput: "Classify the fruit.",
                    candidateOutput: { class: "synthetic" },
                }),
            );
            expect(judgeTest).toMatchObject({
                score: 0.9,
                rationale: "correctness: matches the requested class",
            });

            const datasetId = (
                await pool.query<{ id: string }>(
                    "select id from datasets where project_id=$1 and name='Acceptance text dataset'",
                    [projectId],
                )
            ).rows[0]!.id;
            const generatedJudge = data(
                await tool("generate_judge_for_run", {
                    projectId,
                    promptVersionId: runnable.promptVersionId,
                    datasetId,
                    generatorModelId: "gpt-4o-mini",
                }),
            );
            expect(generatedJudge.rubricPrompt).toContain(
                "Synthetic rubric: score correctness and completeness.",
            );

            const probe = data(
                await tool("create_stt_route_probe", {
                    projectId,
                    modelId: "openai:gpt-4o-transcribe-diarize",
                }),
            );
            expect(probe).toMatchObject({
                modelId: "openai:gpt-4o-transcribe-diarize",
                status: "available",
                transcript: "synthetic probe transcript",
            });
            expect(
                (
                    await pool.query(
                        "select status,reason from stt_route_probes where team_id=$1 and project_id=$2 and model_id=$3",
                        [teamId, projectId, probe.modelId],
                    )
                ).rows[0],
            ).toMatchObject({ status: "available", reason: null });

            const listedModels = data(
                await tool("list_workflow_llm_provider_models", {
                    projectId,
                    transport: "openai",
                }),
            );
            expect(listedModels).toEqual([
                expect.objectContaining({
                    provider: "openai",
                    configured: true,
                    coverage: "provider_model_listing",
                    models: expect.arrayContaining([
                        expect.objectContaining({ modelId: "gpt-4o" }),
                    ]),
                }),
            ]);
            const capabilities = data(
                await tool("refresh_workflow_llm_capabilities", {
                    projectId,
                    transport: "openai",
                }),
            );
            expect(capabilities).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        transport: "openai",
                        snapshot: expect.objectContaining({
                            transport: expect.objectContaining({
                                modelId: "gpt-4o",
                            }),
                        }),
                    }),
                ]),
            );

            const routeConfig = {
                transportConfig: { transport: "openai" },
                modelId: "gpt-4o",
                generation: { maxOutputTokens: 64 },
                structuredOutput: { mode: "text" },
                retry: {
                    owner: "mosaic",
                    maxAttempts: 1,
                    timeoutMs: 10000,
                    retryableErrorClasses: [],
                },
                cache: {
                    mosaicReuse: "allow",
                    providerCaching: "allow",
                },
            };
            const route1 = data(
                await tool("create_workflow_llm_route_version", {
                    projectId,
                    name: "Acceptance route",
                    config: routeConfig,
                }),
            );
            expect(route1.routeVersionId).toMatch(UUID_PATTERN);
            const routeId = route1.route.id as string;
            const route2 = data(
                await tool("create_workflow_llm_route_version", {
                    projectId,
                    routeId,
                    name: "Acceptance route v2",
                    config: routeConfig,
                }),
            );
            expect(route2.route.id).toBe(routeId);
            expect(route2.routeVersionId).toMatch(UUID_PATTERN);
            const history = data(
                await tool("list_workflow_llm_route_history", {
                    projectId,
                    routeId,
                }),
            );
            expect(history.versions).toHaveLength(2);
            expect(
                history.versions.map(
                    (version: { version: number }) => version.version,
                ),
            ).toEqual([2, 1]);

            const routeForModel = data(
                await tool("create_workflow_llm_route_for_model", {
                    projectId,
                    transport: "openai",
                    modelId: "gpt-4o",
                    name: "Acceptance model route",
                    generation: { maxOutputTokens: 64 },
                }),
            );
            expect(routeForModel.routeVersionId).toMatch(UUID_PATTERN);
            const defaultUpdate = data(
                await tool("set_workflow_llm_default", {
                    projectId,
                    routeVersionId: route2.routeVersionId,
                }),
            );
            expect(defaultUpdate.default.default.routeVersionId).toBe(
                route2.routeVersionId,
            );
            expect(
                data(await tool("get_workflow_llm_default", { projectId })),
            ).toMatchObject({
                default: { routeVersionId: route2.routeVersionId },
            });

            const selectableWorkflow = data(
                await tool("create_workflow", {
                    projectId,
                    name: "Acceptance route selection workflow",
                    kind: "prompt",
                    nodes: [
                        {
                            nodeKey: "prompt-1",
                            label: "Synthetic prompt node",
                            nodeType: "prompt",
                            nodeConfig: { type: "prompt" },
                            promptVersionId: runnable.promptVersionId,
                            modelId: "gpt-4o",
                            evalConfig: { type: "none" },
                        },
                    ],
                    edges: [],
                }),
            );
            const selected = data(
                await tool("select_workflow_llm_model", {
                    projectId,
                    workflowId: selectableWorkflow.id,
                    nodeKey: "prompt-1",
                    routeVersionId: routeForModel.routeVersionId,
                }),
            );
            expect(selected.nodes).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        nodeKey: "prompt-1",
                        llmExecutionSelection: {
                            mode: "pinned_route",
                            routeVersionId: routeForModel.routeVersionId,
                        },
                    }),
                ]),
            );
            await tool("clear_workflow_llm_default", {
                projectId,
                confirm: true,
            });
            const disabled = data(
                await tool("disable_workflow_llm_route", {
                    projectId,
                    routeId: routeForModel.route.id,
                    confirm: true,
                }),
            );
            expect(disabled.route.disabledAt).toEqual(expect.any(String));
            expect(providerRequests).toEqual(
                expect.arrayContaining([
                    expect.stringContaining("/v1/models"),
                    expect.stringContaining("/v1/chat/completions"),
                    expect.stringContaining("/v1/audio/transcriptions"),
                ]),
            );
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it("imports golden answers and exercises dataset rename, archive, label, item, and delete operations", async () => {
        const { projectId } = fixture;
        const dataset = data(
            await tool("create_dataset", {
                projectId,
                name: "Acceptance golden lifecycle",
                purpose: "golden",
                modality: "text",
            }),
        );
        const datasetId = dataset.id as string;
        const inputText = `golden-${teamId}`;
        const item = data(
            await tool("add_dataset_item", {
                projectId,
                datasetId,
                inputText,
            }),
        );
        expect(item.datasetId).toBe(datasetId);
        const itemId = (
            await pool.query<{ id: string }>(
                "select id from dataset_items where dataset_id=$1 and input_text=$2",
                [datasetId, inputText],
            )
        ).rows[0]!.id;
        const imported = data(
            await tool("import_dataset_golden_answers", {
                projectId,
                datasetId,
                answersContent: JSON.stringify({
                    key: inputText,
                    label: { expected: "synthetic-answer" },
                }),
            }),
        );
        expect(imported).toMatchObject({ importedCount: 1, failures: [] });
        expect(
            (
                await pool.query<{ label_json: Record<string, unknown> }>(
                    `select l.label_json from labels l
                     join dataset_items i on i.id=l.dataset_item_id
                     where i.id=$1`,
                    [itemId],
                )
            ).rows[0]?.label_json,
        ).toEqual({ expected: "synthetic-answer" });

        await tool("rename_dataset", {
            projectId,
            datasetId,
            name: "Acceptance golden lifecycle renamed",
        });
        await tool("update_dataset_description", {
            projectId,
            datasetId,
            description: "Synthetic golden answer lifecycle",
        });
        const renamed = data(
            await tool("get_dataset", { projectId, datasetId }),
        );
        expect(renamed.dataset).toMatchObject({
            id: datasetId,
            name: "Acceptance golden lifecycle renamed",
            description: "Synthetic golden answer lifecycle",
        });

        await tool("set_dataset_archived", {
            projectId,
            datasetId,
            archived: true,
            confirm: true,
        });
        expect(
            data(await tool("list_datasets", { projectId })).map(
                (row: { id: string }) => row.id,
            ),
        ).not.toContain(datasetId);
        await tool("set_dataset_archived", {
            projectId,
            datasetId,
            archived: false,
            confirm: true,
        });
        expect(
            data(await tool("list_datasets", { projectId })).map(
                (row: { id: string }) => row.id,
            ),
        ).toContain(datasetId);

        await tool("delete_dataset_label", {
            projectId,
            itemId,
            confirm: true,
        });
        expect(
            (
                await pool.query(
                    "select dataset_item_id from labels where dataset_item_id=$1",
                    [itemId],
                )
            ).rowCount,
        ).toBe(0);
        await tool("delete_dataset_item", {
            projectId,
            itemId,
            confirm: true,
        });
        expect(
            (
                await pool.query("select id from dataset_items where id=$1", [
                    itemId,
                ])
            ).rowCount,
        ).toBe(0);

        const empty = data(
            await tool("create_dataset", {
                projectId,
                name: "Acceptance dataset delete",
                purpose: "evaluation",
                modality: "text",
            }),
        );
        await tool("delete_dataset", {
            projectId,
            datasetId: empty.id,
            confirm: true,
        });
        expect(
            (
                await pool.query("select id from datasets where id=$1", [
                    empty.id,
                ])
            ).rowCount,
        ).toBe(0);
    });

    it("imports image and audio files and previews and commits mapped audio answers", async () => {
        const { projectId } = fixture;
        const pngBase64 =
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7e05QAAAAASUVORK5CYII=";
        const imageDataset = data(
            await tool("create_dataset", {
                projectId,
                name: "Acceptance imported image dataset",
                purpose: "golden",
                modality: "image",
            }),
        );
        const rawImage = data(
            await tool("import_dataset_images", {
                projectId,
                datasetId: imageDataset.id,
                images: [
                    {
                        name: "unpaired.png",
                        mimeType: "image/png",
                        size: Buffer.from(pngBase64, "base64").byteLength,
                        base64Data: pngBase64,
                    },
                ],
            }),
        );
        expect(rawImage).toMatchObject({ importedCount: 1, failures: [] });
        const answeredImage = data(
            await tool("import_dataset_image_answers", {
                projectId,
                datasetId: imageDataset.id,
                images: [
                    {
                        name: "answered.png",
                        mimeType: "image/png",
                        size: Buffer.from(pngBase64, "base64").byteLength,
                        base64Data: pngBase64,
                    },
                ],
                answersContent: JSON.stringify({
                    filename: "answered.png",
                    label: { expectedClass: "synthetic" },
                }),
            }),
        );
        expect(answeredImage).toMatchObject({ importedCount: 1, failures: [] });
        expect(
            (
                await pool.query<{ label_json: Record<string, unknown> }>(
                    `select l.label_json from labels l
                     join dataset_items i on i.id=l.dataset_item_id
                     where i.dataset_id=$1 and i.source_name='answered.png'`,
                    [imageDataset.id],
                )
            ).rows[0]?.label_json,
        ).toEqual({ expectedClass: "synthetic" });
        await pool.query(
            `insert into dataset_schemas(dataset_id,json_schema,field_rules)
             values($1,$2::jsonb,'[]'::jsonb)`,
            [
                imageDataset.id,
                JSON.stringify({
                    type: "object",
                    additionalProperties: false,
                    properties: { expectedClass: { type: "string" } },
                    required: ["expectedClass"],
                }),
            ],
        );
        const paired = data(
            await tool("import_dataset_paired_items", {
                projectId,
                datasetId: imageDataset.id,
                images: [
                    {
                        name: "paired.png",
                        mimeType: "image/png",
                        size: Buffer.from(pngBase64, "base64").byteLength,
                        base64Data: pngBase64,
                    },
                ],
                csvContent:
                    "filename,expectedClass\npaired.png,paired-synthetic",
            }),
        );
        expect(paired).toMatchObject({ importedCount: 1, failures: [] });
        expect(
            (
                await pool.query<{ label_json: Record<string, unknown> }>(
                    `select l.label_json from labels l
                     join dataset_items i on i.id=l.dataset_item_id
                     where i.dataset_id=$1 and i.source_name='paired.png'`,
                    [imageDataset.id],
                )
            ).rows[0]?.label_json,
        ).toEqual({ expectedClass: "paired-synthetic" });

        const audioDataset = data(
            await tool("create_dataset", {
                projectId,
                name: "Acceptance imported audio dataset",
                purpose: "golden",
                modality: "audio",
            }),
        );
        const audio = (name: string) => ({
            name,
            mimeType: "audio/wav",
            size: 1,
            base64Data: "YQ==",
        });
        expect(
            data(
                await tool("import_dataset_audio", {
                    projectId,
                    datasetId: audioDataset.id,
                    audio: [audio("raw.wav")],
                }),
            ),
        ).toMatchObject({ importedCount: 1, failures: [] });
        expect(
            data(
                await tool("import_dataset_audio_answers", {
                    projectId,
                    datasetId: audioDataset.id,
                    audio: [audio("answered.wav")],
                    answersContent: JSON.stringify({
                        filename: "answered.wav",
                        label: {
                            expectedTranscript: "synthetic transcript",
                            referenceKind: "human_gold",
                        },
                    }),
                }),
            ),
        ).toMatchObject({ importedCount: 1, failures: [] });
        expect(
            data(
                await tool("import_dataset_audio", {
                    projectId,
                    datasetId: audioDataset.id,
                    audio: [audio("preview.wav")],
                }),
            ),
        ).toMatchObject({ importedCount: 1, failures: [] });

        const answerFile = {
            fileName: "preview.json",
            content: JSON.stringify({ transcript: "mapped transcript" }),
        };
        const mapping = { transcript: "expectedTranscript" };
        const preview = data(
            await tool("preview_dataset_golden_answers", {
                projectId,
                datasetId: audioDataset.id,
                answerFiles: [answerFile],
                mapping,
            }),
        );
        expect(preview).toMatchObject({
            importableCount: 1,
            failingCount: 0,
            proposedMapping: mapping,
        });
        expect(
            data(
                await tool("commit_dataset_golden_answers", {
                    projectId,
                    datasetId: audioDataset.id,
                    answerFiles: [answerFile],
                    mapping: preview.proposedMapping,
                    confirm: true,
                }),
            ),
        ).toMatchObject({ importedCount: 1, failures: [] });
        expect(
            (
                await pool.query<{ label_json: Record<string, unknown> }>(
                    `select l.label_json from labels l
                     join dataset_items i on i.id=l.dataset_item_id
                     where i.dataset_id=$1 and i.source_name='preview.wav'`,
                    [audioDataset.id],
                )
            ).rows[0]?.label_json,
        ).toMatchObject({ expectedTranscript: "mapped transcript" });

        await tool("delete_dataset", {
            projectId,
            datasetId: imageDataset.id,
            confirm: true,
        });
        await tool("delete_dataset", {
            projectId,
            datasetId: audioDataset.id,
            confirm: true,
        });
    });

    it("persists image bytes to disposable local storage and returns their stored metadata", async () => {
        const { projectId } = fixture;
        const dataset = data(
            await tool("create_dataset", {
                projectId,
                name: "Acceptance image dataset",
                purpose: "golden",
                modality: "image",
            }),
        );
        fixture.imageDatasetId = dataset.id as string;
        const pngBase64 =
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7e05QAAAAASUVORK5CYII=";
        const bytes = Buffer.from(pngBase64, "base64");
        const add = data(
            await tool("add_dataset_item", {
                projectId,
                datasetId: fixture.imageDatasetId,
                inputText: "classify the one-pixel image",
                label: { class: "synthetic" },
                image: {
                    name: "synthetic.png",
                    mimeType: "image/png",
                    size: bytes.byteLength,
                    base64Data: pngBase64,
                },
            }),
        );
        expect(add.datasetId).toBe(fixture.imageDatasetId);
        const stored = await pool.query<{
            id: string;
            storage_key: string;
            mime_type: string;
        }>(
            `select id,storage_key,mime_type from dataset_items
             where dataset_id=$1 and source_name='synthetic.png'`,
            [fixture.imageDatasetId],
        );
        expect(stored.rows).toHaveLength(1);
        fixture.imageItemId = stored.rows[0]!.id;
        fixture.imageStorageKey = stored.rows[0]!.storage_key;
        expect(stored.rows[0]!.mime_type).toBe("image/png");
        await expect(
            fs.readFile(path.join(uploadDir, fixture.imageStorageKey)),
        ).resolves.toEqual(bytes);

        const updated = data(
            await tool("update_dataset_item", {
                projectId,
                itemId: fixture.imageItemId,
                inputText: "updated synthetic prompt",
                label: { class: "updated" },
            }),
        );
        expect(updated.datasetId).toBe(fixture.imageDatasetId);
        const listed = data(
            await tool("list_dataset_items", {
                projectId,
                datasetId: fixture.imageDatasetId,
                includeInputText: true,
                includeStorageKey: true,
                includeLabel: true,
            }),
        );
        expect(listed.items[0]).toMatchObject({
            id: fixture.imageItemId,
            inputText: "updated synthetic prompt",
            storageKey: fixture.imageStorageKey,
            label: { class: "updated" },
        });
    });

    it("roundtrips resources, the setup prompt, tool/resource HTTP 403, and resource 404 protocol errors", async () => {
        const { projectId } = fixture;
        const promptId = randomUUID();
        const promptVersionId = randomUUID();
        const schemaVersionId = randomUUID();
        const datasetId = fixture.imageDatasetId;
        await pool.query(
            `insert into prompts(id,team_id,project_id,name,kind,target_model_id)
             values($1,$2,$3,'Synthetic prompt','eval','gpt-4o')`,
            [promptId, teamId, projectId],
        );
        await pool.query(
            `insert into prompt_schema_versions(
                id,prompt_id,version,json_schema,field_configs,schema_hash,
                openai_compatible,compatibility_errors,created_by
             ) values($1,$2,1,'{"type":"object","properties":{"class":{"type":"string"}}}',
                '[]','acceptance-schema',true,'[]',$3)`,
            [schemaVersionId, promptId, userId],
        );
        await pool.query(
            `insert into prompt_validation_attempts(
                id,team_id,project_id,prompt_id,prompt_version_id,schema_version_id,
                target_model_id,status,schema_hash,evidence,created_by
             ) values($1,$2,$3,$4,null,$5,'gpt-4o','passed','acceptance-schema','{}'::jsonb,$6)`,
            [
                fixtureValidationAttemptId,
                teamId,
                projectId,
                promptId,
                schemaVersionId,
                userId,
            ],
        );
        await pool.query(
            `insert into prompt_versions(
                id,prompt_id,version,content,schema_version_id,status,created_by,validation_attempt_id
             ) values($1,$2,1,'Return the class.',$3,'runnable',$4,$5)`,
            [
                promptVersionId,
                promptId,
                schemaVersionId,
                userId,
                fixtureValidationAttemptId,
            ],
        );
        await pool.query(
            `insert into runs(id,team_id,project_id,dataset_id,status,config_snapshot,created_by)
             values($1,$2,$3,$4,'completed','{}',$5)`,
            [fixtureRunId, teamId, projectId, datasetId, userId],
        );
        await pool.query(
            `insert into run_models(id,run_id,model_id,prompt_version_id,schema_version_id)
             values($1,$2,'gpt-4o',$3,$4)`,
            [fixtureRunModelId, fixtureRunId, promptVersionId, schemaVersionId],
        );
        await pool.query(
            `insert into run_cells(id,run_id,dataset_item_id,run_model_id,status,output_json,created_at)
             values($1,$2,$3,$4,'succeeded','{"class":"synthetic"}',
                '2025-04-05T06:07:08.123456Z')`,
            [
                fixtureRunCellId,
                fixtureRunId,
                fixture.imageItemId,
                fixtureRunModelId,
            ],
        );

        const prompts = data(
            await tool("list_prompts", { projectId }),
        ) as Array<{ id: string; name: string }>;
        expect(prompts.map((prompt) => prompt.id)).toContain(promptId);
        expect(
            data(await tool("get_prompt", { projectId, promptId })),
        ).toMatchObject({
            prompt: { id: promptId, name: "Synthetic prompt" },
            latestVersion: { id: promptVersionId },
        });
        const promptCopyInput = {
            projectId,
            sourcePromptVersionId: promptVersionId,
            idempotencyKey: `prompt-copy-${teamId}`,
        };
        const promptCopy = data(
            await tool("duplicate_prompt_version", promptCopyInput),
        );
        const promptCopyReplay = data(
            await tool("duplicate_prompt_version", promptCopyInput),
        );
        expect(promptCopy.promptId).toMatch(UUID_PATTERN);
        expect(promptCopy.promptVersionId).toMatch(UUID_PATTERN);
        expect(promptCopyReplay).toEqual(promptCopy);
        expect(
            (
                await pool.query(
                    "select id from prompt_versions where id=$1 and prompt_id=$2 and status='runnable'",
                    [promptCopy.promptVersionId, promptCopy.promptId],
                )
            ).rowCount,
        ).toBe(1);
        const deletedPrompt = data(
            await tool("delete_prompt", {
                projectId,
                promptId: promptCopy.promptId,
                confirm: true,
            }),
        );
        expect(deletedPrompt.promptId).toBe(promptCopy.promptId);
        expect(
            (
                await pool.query("select id from prompts where id=$1", [
                    promptCopy.promptId,
                ])
            ).rowCount,
        ).toBe(0);

        const judge = data(
            await tool("create_judge_prompt", {
                projectId,
                name: "Synthetic acceptance judge",
                modelId: "gpt-4o-mini",
                rubricPrompt: "Return a strict JSON judgment.",
                declaredInputs: ["task_input", "candidate_output"],
            }),
        );
        expect(judge.promptId).toMatch(UUID_PATTERN);
        expect(judge.promptVersionId).toMatch(UUID_PATTERN);
        expect(
            (
                await pool.query(
                    "select p.id from prompts p join prompt_versions v on v.prompt_id=p.id where p.id=$1 and p.kind='judge' and v.status='runnable'",
                    [judge.promptId],
                )
            ).rowCount,
        ).toBe(1);
        await tool("delete_prompt", {
            projectId,
            promptId: judge.promptId,
            confirm: true,
        });

        const listedRuns = data(
            await tool("list_runs", { projectId }),
        ) as Array<{ id: string }>;
        expect(listedRuns.map((run) => run.id)).toContain(fixtureRunId);
        const runDetail = data(
            await tool("get_run", { projectId, runId: fixtureRunId }),
        );
        expect(runDetail.run.id).toBe(fixtureRunId);
        expect(runDetail.cells).toHaveLength(1);
        expect(
            data(
                await tool("get_run_progress", {
                    projectId,
                    runId: fixtureRunId,
                }),
            ),
        ).toMatchObject({ status: "completed", total: 1, done: 1 });
        expect(
            data(
                await tool("get_run_summary", {
                    projectId,
                    runId: fixtureRunId,
                }),
            ),
        ).toMatchObject({
            run: { id: fixtureRunId, datasetId },
            progress: { total: 1, done: 1 },
            modelIds: ["gpt-4o"],
        });
        const runCells = data(
            await tool("list_run_cells", {
                projectId,
                runId: fixtureRunId,
                includeInputText: true,
                includeOutput: true,
            }),
        );
        expect(runCells.cells).toEqual([
            expect.objectContaining({
                id: fixtureRunCellId,
                inputText: "updated synthetic prompt",
                output: { class: "synthetic" },
            }),
        ]);
        expect(
            data(
                await tool("save_run_note", {
                    projectId,
                    runId: fixtureRunId,
                    body: "Synthetic acceptance note",
                }),
            ),
        ).toEqual({ runId: fixtureRunId });
        expect(
            (
                await pool.query("select body from run_notes where run_id=$1", [
                    fixtureRunId,
                ])
            ).rows[0]?.body,
        ).toBe("Synthetic acceptance note");
        expect(
            data(
                await tool("annotate_run_cell", {
                    projectId,
                    runCellId: fixtureRunCellId,
                    verdict: "approved",
                    comment: "Synthetic output verified",
                }),
            ),
        ).toEqual({ runId: fixtureRunId });
        expect(
            (
                await pool.query(
                    "select verdict,comment from run_cell_annotations where run_cell_id=$1",
                    [fixtureRunCellId],
                )
            ).rows[0],
        ).toEqual({
            verdict: "approved",
            comment: "Synthetic output verified",
        });

        const templates = await rpc("resources/templates/list", {});
        expect(templates.result?.resourceTemplates).toHaveLength(8);
        const uris = [
            `mosaic://projects/${projectId}/datasets/${datasetId}`,
            `mosaic://projects/${projectId}/prompts/${promptId}`,
            `mosaic://projects/${projectId}/runs/${fixtureRunId}`,
            `mosaic://projects/${projectId}/models`,
            `mosaic://projects/${projectId}/datasets/${datasetId}/summary`,
            `mosaic://projects/${projectId}/datasets/${datasetId}/items/1/first`,
            `mosaic://projects/${projectId}/runs/${fixtureRunId}/summary`,
            `mosaic://projects/${projectId}/runs/${fixtureRunId}/cells/1/first`,
        ];
        for (const uri of uris) {
            const response = await rpc("resources/read", { uri });
            expect(response.error).toBeUndefined();
            const contents = response.result?.contents;
            expect(contents).toHaveLength(1);
            expect(contents?.[0]?.uri).toBe(uri);
            expect(() => JSON.parse(contents?.[0]?.text ?? "")).not.toThrow();
        }
        const datasetPage = await rpc("resources/read", { uri: uris[5] });
        const datasetPageData = JSON.parse(
            datasetPage.result?.contents?.[0]?.text ?? "{}",
        ) as { items?: unknown[] };
        expect(datasetPageData.items).toHaveLength(1);

        const setupPrompt = await rpc("prompts/get", {
            name: "create_eval_happy_path",
        });
        expect(setupPrompt.result?.messages).toHaveLength(1);

        const blockedOrigin = await requestRpc(
            "tools/list",
            {},
            { origin: "https://blocked.example" },
        );
        expect(blockedOrigin.status).toBe(403);
        const blockedResourceOrigin = await requestRpc(
            "resources/read",
            { uri: uris[0] },
            { origin: "https://blocked.example" },
        );
        expect(blockedResourceOrigin.status).toBe(403);

        const createdEvalRun = data(
            await tool("create_eval_run", {
                projectId,
                datasetId,
                promptVersionId,
                maxTokens: 64,
                judgeModelId: "gpt-4o-mini",
                modelIds: ["gpt-4o"],
                fieldConfigs: [{ field: "class", kind: "factual" }],
                idempotencyKey: `eval-run-${teamId}`,
            }),
        );
        fixture.evalRunId = createdEvalRun.runId as string;
        expect(fixture.evalRunId).toMatch(UUID_PATTERN);
        expect(["queued", "pending_enqueue"]).toContain(
            createdEvalRun.enqueueStatus,
        );
        expect(
            (
                await pool.query(
                    "select r.status,count(rm.id)::int as models from runs r join run_models rm on rm.run_id=r.id where r.id=$1 group by r.status",
                    [fixture.evalRunId],
                )
            ).rows[0],
        ).toMatchObject({ status: "pending", models: 1 });
        const retried = data(
            await tool("retry_run", { projectId, runId: fixtureRunId }),
        );
        expect(retried.runId).toBe(fixtureRunId);
        expect(["queued", "pending_enqueue"]).toContain(retried.enqueueStatus);
        expect(
            (
                await pool.query("select status from runs where id=$1", [
                    fixtureRunId,
                ])
            ).rows[0]?.status,
        ).toBe("pending");
        expect(
            data(
                await tool("delete_run", {
                    projectId,
                    runId: fixture.evalRunId,
                    confirm: true,
                }),
            ),
        ).toEqual({ runId: fixture.evalRunId });
        expect(
            (
                await pool.query("select id from runs where id=$1", [
                    fixture.evalRunId,
                ])
            ).rowCount,
        ).toBe(0);

        const foreignResource = await rpc("resources/read", {
            uri: `mosaic://projects/${fixtureProjectId}/datasets/${datasetId}`,
        });
        // Resource callbacks must fail as a JSON-RPC protocol error, not return
        // a tool-call result object inside resources/read's result.contents.
        expect(foreignResource.error).toMatchObject({
            code: expect.any(Number),
        });
        expect(foreignResource.result?.isError).toBeUndefined();
        expect(foreignResource.result?.structuredContent).toBeUndefined();
    });

    it("reports schema rejection and tenant-scoped not-found errors through tools/call", async () => {
        const invalid = await rpc("tools/call", {
            name: "create_dataset",
            arguments: {
                projectId: fixture.projectId,
                name: "Invalid dataset",
                purpose: "evaluation",
                modality: "spreadsheet",
            },
        });
        expect(invalid.result?.isError).toBe(true);

        const foreign = await rpc("tools/call", {
            name: "list_datasets",
            arguments: { projectId: fixtureProjectId },
        });
        expect(foreign.result?.isError).toBe(true);
        expect(foreign.result?.structuredContent?.error?.status).toBe(404);
    });

    async function tool(name: string, args: Record<string, unknown>) {
        const response = await rpc("tools/call", { name, arguments: args });
        expect(
            response.error,
            `${name} should produce a JSON-RPC response`,
        ).toBeUndefined();
        expect(
            response.result?.isError,
            `${name} should succeed; tool result=${JSON.stringify(response.result)}`,
        ).not.toBe(true);
        return response.result as McpToolResult;
    }

    async function rpc(method: string, params: Record<string, unknown>) {
        const response = await requestRpc(method, params);
        expect(response.status).toBe(200);
        return response.body;
    }

    async function requestRpc(
        method: string,
        params: Record<string, unknown>,
        extraHeaders: Record<string, string> = {},
    ) {
        const response = await handleMcpRequest(
            new Request("https://acceptance.example/mcp", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${fixtureToken}`,
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                    ...extraHeaders,
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: ++requestId,
                    method,
                    params,
                }),
            }),
            runtime,
        );
        const body = (await response.json()) as McpRpcResponse;
        return { status: response.status, body };
    }

    function data(result: McpToolResult) {
        const value = result.structuredContent?.data;
        expect(value).toBeDefined();
        return value as Record<string, any>;
    }
});

interface McpToolResult {
    isError?: boolean;
    structuredContent?: {
        data?: Record<string, any>;
        error?: { status?: number; code?: string };
    };
    content?: Array<{ type: string; text?: string }>;
}

interface McpRpcResponse {
    error?: { code: number; message: string; data?: unknown };
    result?: McpToolResult & {
        tools?: Array<{ name: string }>;
        resourceTemplates?: unknown[];
        contents?: Array<{ uri: string; text: string; mimeType?: string }>;
        messages?: Array<{ content: { type: string; text?: string } }>;
    };
}

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// eslint-disable-next-line complexity -- routes every allowed stub endpoint and rejects any other network request.
async function syntheticProviderFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<Response> {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(
        typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
    );
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    if (
        url.origin !== "https://api.openai.com" ||
        !["GET", "POST"].includes(method)
    ) {
        throw new Error(
            `Unexpected provider request ${method} ${url.host}${url.pathname}`,
        );
    }
    if (method === "GET" && url.pathname === "/v1/models") {
        return providerJsonResponse({
            object: "list",
            data: ["gpt-4o", "gpt-4o-mini", "gpt-5.4-mini"].map((id) => ({
                id,
                object: "model",
                created: 1,
                owned_by: "acceptance-stub",
            })),
        });
    }
    if (method === "POST" && url.pathname === "/v1/audio/transcriptions") {
        return providerJsonResponse({ text: "synthetic probe transcript" });
    }
    if (method === "POST" && url.pathname === "/v1/chat/completions") {
        const rawBody = init?.body;
        const body =
            typeof rawBody === "string"
                ? (JSON.parse(rawBody) as Record<string, any>)
                : request
                  ? ((await request.clone().json()) as Record<string, any>)
                  : {};
        const schemaName = body.response_format?.json_schema?.name;
        const requestText = JSON.stringify(body.messages ?? []);
        const output =
            schemaName === "prompt_optimization"
                ? JSON.stringify({
                      proposedPrompt: "Return a concise JSON class.",
                      rationale: "The revised instruction is specific.",
                      fitTags: ["clarity", "structured-output"],
                      structuredOutputNotes: [
                          "Use the supplied schema.",
                          "Return JSON only.",
                      ],
                  })
                : schemaName === "judge_verdict"
                  ? JSON.stringify({
                        criteria: [
                            {
                                name: "correctness",
                                reasoning: "matches the requested class",
                                score: 0.9,
                            },
                        ],
                        score: 0.9,
                    })
                  : schemaName === "prompt_output"
                    ? JSON.stringify({ class: "synthetic" })
                    : JSON.stringify({
                          type: "object",
                          additionalProperties: false,
                          properties: { class: { type: "string" } },
                          required: ["class"],
                      });
        const text = schemaName
            ? output
            : requestText.includes("Produce a JSON Schema")
              ? output
              : "Synthetic rubric: score correctness and completeness.";
        return providerJsonResponse({
            id: "chatcmpl-acceptance-stub",
            object: "chat.completion",
            created: 1,
            model: body.model ?? "gpt-4o",
            choices: [
                {
                    index: 0,
                    message: { role: "assistant", content: text },
                    finish_reason: "stop",
                },
            ],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
            },
        });
    }
    throw new Error(
        `Unexpected provider request ${method} ${url.host}${url.pathname}`,
    );
}

function providerJsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

function acceptanceConfig(databaseUrl: string): IApiConfig {
    return {
        nodeEnv: "test",
        port: 0,
        databaseUrl,
        storageAdapter: "local",
        supabaseUrl: "",
        supabaseServiceRoleKey: "",
        supabaseStorageBucket: "mcp-acceptance-unused",
        clerkSecretKey: "",
        mosaicTenancyMode: "isolated",
        mosaicAllowedEmailDomain: "",
        corsOrigins: [],
        mosaicLlmProvider: "openai",
        sttCapabilityProbes: {},
        profilingEnabled: false,
        workflowLlmWritesEnabled: true,
        rateLimitLlmPerMinute: 0,
        rateLimitRunsPerMinute: 0,
        mosaicMcpEnabled: true,
        mosaicMcpAllowedOrigins: ["https://allowed.example"],
        mosaicMcpRawTokenFallbackEnabled: true,
        mosaicMcpTokenPepper: "synthetic-acceptance-pepper",
        mosaicSecretsEncKey: Buffer.alloc(32, 0x41).toString("base64"),
        featureFlags: resolveApiFeatureFlags({}),
    };
}

function assertDisposableLocalDatabase(value: string): void {
    const parsed = new URL(value);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    if (
        !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
        databaseName !== "flash_evals_mcp_acceptance"
    ) {
        throw new Error(
            "Refusing MCP acceptance writes: use a loopback database named flash_evals_mcp_acceptance.",
        );
    }
}
