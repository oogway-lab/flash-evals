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
    const fixturePromptId = randomUUID();
    const fixturePromptVersionId = randomUUID();
    const fixtureSchemaVersionId = randomUUID();
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
            await pool.query(
                "delete from api_rate_limits where bucket_key like $1",
                [`%:${teamId}:%`],
            );
            await pool.query("delete from run_cells where run_id=$1", [
                fixtureRunId,
            ]);
            await pool.query("delete from run_models where run_id=$1", [
                fixtureRunId,
            ]);
            await pool.query("delete from runs where id=$1", [fixtureRunId]);
            await pool.query("delete from prompt_versions where id=$1", [
                fixturePromptVersionId,
            ]);
            await pool.query("delete from prompt_schema_versions where id=$1", [
                fixtureSchemaVersionId,
            ]);
            await pool.query("delete from prompts where id=$1", [
                fixturePromptId,
            ]);
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
                await pool.query("delete from datasets where project_id=$1", [
                    fixture.projectId,
                ]);
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
            await pool.query("delete from mcp_access_tokens where user_id=$1", [
                userId,
            ]);
            await pool.query("delete from users where id in ($1,$2)", [
                userId,
                foreignUserId,
            ]);
            await pool.query("delete from teams where id in ($1,$2)", [
                teamId,
                foreignTeamId,
            ]);
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

    it("roundtrips the eight resource templates, one setup prompt, HTTP 403, and resource 404 protocol errors", async () => {
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
            `insert into prompt_versions(
                id,prompt_id,version,content,schema_version_id,status,created_by
             ) values($1,$2,1,'Return the class.',$3,'legacy',$4)`,
            [promptVersionId, promptId, schemaVersionId, userId],
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
        expect(response.result?.isError, `${name} should succeed`).not.toBe(
            true,
        );
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
