import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type {
    Transport,
    TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IApiRuntime } from "../server.js";
import { ApiForbiddenError } from "../errors.js";
import { registerMosaicMcpCapabilities } from "./registry.js";

function resourceText(contents: { text?: string; blob?: string }[]): string {
    const content = contents[0];
    if (!content || typeof content.text !== "string") {
        throw new Error("Expected a text resource result.");
    }
    return content.text;
}

async function readResource(client: Client, uri: string) {
    try {
        return await client.readResource({ uri });
    } catch (error) {
        throw new Error(`Resource read failed for ${uri}: ${String(error)}`);
    }
}

class StdioStreamClientTransport implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;

    private pending = "";

    constructor(
        private readonly toServer: PassThrough,
        private readonly fromServer: PassThrough,
    ) {
        this.fromServer.on("data", this.handleData);
    }

    async start(): Promise<void> {}

    async send(
        message: JSONRPCMessage,
        _options?: TransportSendOptions,
    ): Promise<void> {
        const line = `${JSON.stringify(message)}\n`;
        await new Promise<void>((resolve, reject) => {
            this.toServer.write(line, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }

    async close(): Promise<void> {
        this.fromServer.off("data", this.handleData);
        this.onclose?.();
    }

    private readonly handleData = (chunk: Buffer | string): void => {
        this.pending += chunk.toString();
        let newline = this.pending.indexOf("\n");
        while (newline >= 0) {
            const line = this.pending.slice(0, newline).replace(/\r$/, "");
            this.pending = this.pending.slice(newline + 1);
            try {
                this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
            } catch (error) {
                this.onerror?.(
                    error instanceof Error ? error : new Error(String(error)),
                );
            }
            newline = this.pending.indexOf("\n");
        }
    };
}

function createRuntime(
    query: (text: string, values?: unknown[]) => Promise<unknown> = vi
        .fn()
        .mockResolvedValue({ rows: [], rowCount: 0 }),
): IApiRuntime {
    return {
        config: {},
        db: {
            query,
        },
    } as unknown as IApiRuntime;
}

interface IPageFixtureIds {
    projectId: string;
    datasetId: string;
    runId: string;
    workflowRunId: string;
    itemIds: string[];
    runCellIds: string[];
}

type IQueryFixtureResult = {
    rows: Record<string, unknown>[];
    rowCount: number;
};

function createPageQueryFixture(ids: IPageFixtureIds) {
    return vi.fn(async (sql: string, values: unknown[] = []) => {
        return (
            datasetPageQuery(sql, values, ids) ??
            runPageQuery(sql, values, ids) ??
            workflowPageQuery(sql, values, ids) ?? { rows: [], rowCount: 0 }
        );
    });
}

function datasetPageQuery(
    sql: string,
    values: unknown[],
    ids: IPageFixtureIds,
): IQueryFixtureResult | undefined {
    if (sql.includes("from projects")) {
        return { rows: [{ id: ids.projectId }], rowCount: 1 };
    }
    if (sql.includes("from datasets d") && sql.includes("item_count")) {
        return {
            rows: [
                {
                    id: ids.datasetId,
                    team_id: "stdio-test-team",
                    name: "Synthetic dataset",
                    purpose: "evaluation",
                    modality: "text",
                    pipeline_id: null,
                    description: null,
                    archived_at: null,
                    item_count: 2,
                    labeled_item_count: 0,
                    has_legacy_schema: false,
                },
            ],
            rowCount: 1,
        };
    }
    if (sql.includes("select id from datasets")) {
        return { rows: [{ id: ids.datasetId }], rowCount: 1 };
    }
    if (sql.includes("select i.id,i.type")) {
        const itemIds = values[5] !== null ? ids.itemIds.slice(1) : ids.itemIds;
        const rows = itemIds.map((id) => ({
            id,
            type: "text",
            input_text: "bounded sample",
            source_name: null,
            storage_key: null,
            mime_type: null,
            label_json: null,
            cursor_created_at: "2026-10-10T00:00:00.000000Z",
        }));
        return { rows, rowCount: rows.length };
    }
    return undefined;
}

function runPageQuery(
    sql: string,
    values: unknown[],
    ids: IPageFixtureIds,
): IQueryFixtureResult | undefined {
    if (sql.includes("from runs") && sql.includes("config_snapshot")) {
        return {
            rows: [
                {
                    id: ids.runId,
                    team_id: "stdio-test-team",
                    project_id: ids.projectId,
                    dataset_id: ids.datasetId,
                    status: "completed",
                    config_snapshot: {},
                    created_at: new Date("2026-10-10T00:00:00.000Z"),
                },
            ],
            rowCount: 1,
        };
    }
    if (sql.includes("from runs") && sql.includes("enqueueStatus")) {
        return {
            rows: [{ status: "completed", enqueueStatus: "queued" }],
            rowCount: 1,
        };
    }
    if (sql.includes("from run_cells") && sql.includes("group by status")) {
        return {
            rows: [{ status: "succeeded", count: 2 }],
            rowCount: 1,
        };
    }
    if (sql.includes("select distinct model_id from run_models")) {
        return { rows: [{ model_id: "model-a" }], rowCount: 1 };
    }
    if (sql.includes("select c.id,c.dataset_item_id,m.model_id")) {
        const cellIds =
            values[4] !== null ? ids.runCellIds.slice(1) : ids.runCellIds;
        const rows = cellIds.map((id) => ({
            id,
            dataset_item_id: ids.itemIds[0],
            model_id: "model-a",
            status: "succeeded",
            input_text: null,
            output_json: null,
            latency_ms: 2,
            cost_usd: null,
            prompt_tokens: null,
            completion_tokens: null,
            error: null,
            cursor_created_at: "2026-10-10T00:00:00.000000Z",
        }));
        return { rows, rowCount: rows.length };
    }
    return undefined;
}

function workflowPageQuery(
    sql: string,
    values: unknown[],
    ids: IPageFixtureIds,
): IQueryFixtureResult | undefined {
    if (
        sql.includes("from workflow_runs") &&
        sql.includes("left join workflow_run_cells")
    ) {
        return {
            rows: [
                {
                    status: "completed",
                    total: 2,
                    done: 2,
                    failed: 0,
                    pending: 0,
                },
            ],
            rowCount: 1,
        };
    }
    if (sql.includes("from workflow_runs") && sql.includes("run_target")) {
        return {
            rows: [
                {
                    id: ids.workflowRunId,
                    dataset_id: ids.datasetId,
                    target_item_id: null,
                    status: "completed",
                    run_target: "dataset",
                    created_at: new Date("2026-10-10T00:00:00.000Z"),
                },
            ],
            rowCount: 1,
        };
    }
    if (sql.includes("select id from workflow_runs")) {
        return { rows: [{ id: ids.workflowRunId }], rowCount: 1 };
    }
    if (sql.includes("select c.id,c.dataset_item_id,c.node_key")) {
        const cellIds =
            values[4] !== null ? ids.runCellIds.slice(1) : ids.runCellIds;
        const rows = cellIds.map((id) => ({
            id,
            dataset_item_id: ids.itemIds[0],
            node_key: "input",
            status: "succeeded",
            input_text: null,
            output_json: null,
            latency_ms: 2,
            cost_usd: null,
            error: null,
            cursor_created_at: "2026-10-10T00:00:00.000000Z",
        }));
        return { rows, rowCount: rows.length };
    }
    return undefined;
}

async function connectStdioClient(runtime = createRuntime()): Promise<{
    client: Client;
    close: () => Promise<void>;
}> {
    const clientInput = new PassThrough();
    const serverOutput = new PassThrough();
    const server = new McpServer({ name: "stdio-test-server", version: "1" });
    registerMosaicMcpCapabilities(server, {
        runtime,
        principal: {
            authMode: "oauth",
            profile: "eval",
            userId: "stdio-test-user",
            teamId: "stdio-test-team",
            email: "stdio-test@example.invalid",
        },
    });

    await server.connect(new StdioServerTransport(clientInput, serverOutput));
    const client = new Client({ name: "stdio-test-client", version: "1" });
    await client.connect(
        new StdioStreamClientTransport(clientInput, serverOutput),
    );

    return {
        client,
        async close() {
            await client.close();
            await server.close();
            clientInput.destroy();
            serverOutput.destroy();
        },
    };
}

describe("MCP stdio transport", () => {
    let close: (() => Promise<void>) | undefined;

    afterEach(async () => {
        await close?.();
        close = undefined;
    });

    it("lists tools and returns positive and invalid-input tool results", async () => {
        const harness = await connectStdioClient();
        close = harness.close;

        const { tools } = await harness.client.listTools();
        expect(tools).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: "get_current_user" }),
                expect.objectContaining({ name: "list_datasets" }),
            ]),
        );
        expect(tools.map((tool) => tool.name)).not.toContain(
            "set_provider_key",
        );
        expect(tools.map((tool) => tool.name)).not.toContain("delete_run");

        const currentUser = await harness.client.callTool({
            name: "get_current_user",
            arguments: {},
        });
        expect(currentUser.isError).not.toBe(true);
        expect(currentUser.structuredContent).toMatchObject({
            data: {
                userId: "stdio-test-user",
                teamId: "stdio-test-team",
                email: "stdio-test@example.invalid",
            },
        });

        const deniedMutation = await harness.client.callTool({
            name: "set_provider_key",
            arguments: {
                provider: "openai",
                key: "secret-that-must-not-be-accepted",
            },
        });
        expect(deniedMutation.isError).toBe(true);

        const invalidInput = await harness.client.callTool({
            name: "list_datasets",
            arguments: { projectId: "not-a-uuid" },
        });
        expect(invalidInput.isError).toBe(true);
        expect(invalidInput.content).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: "text" })]),
        );
    });

    it("exposes discoverable bounded resources and the setup prompt", async () => {
        const projectId = "11111111-1111-4111-8111-111111111111";
        const datasetId = "22222222-2222-4222-8222-222222222222";
        const runId = "55555555-5555-4555-8555-555555555555";
        const workflowId = "88888888-8888-4888-8888-888888888888";
        const workflowRunId = "99999999-9999-4999-8999-999999999999";
        const runCellIds = [
            "66666666-6666-4666-8666-666666666666",
            "77777777-7777-4777-8777-777777777777",
        ];
        const itemIds = [
            "33333333-3333-4333-8333-333333333333",
            "44444444-4444-4444-8444-444444444444",
        ];
        const query = createPageQueryFixture({
            projectId,
            datasetId,
            runId,
            workflowRunId,
            itemIds,
            runCellIds,
        });
        const harness = await connectStdioClient(createRuntime(query));
        close = harness.close;

        const { resourceTemplates } =
            await harness.client.listResourceTemplates();
        expect(resourceTemplates).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: "mosaic-dataset-summary" }),
                expect.objectContaining({ name: "mosaic-dataset-items" }),
                expect.objectContaining({ name: "mosaic-run-summary" }),
                expect.objectContaining({ name: "mosaic-run-cells" }),
            ]),
        );
        expect(resourceTemplates).toHaveLength(8);

        const summary = await readResource(
            harness.client,
            `mosaic://projects/${projectId}/datasets/${datasetId}/summary`,
        );
        const summaryData = JSON.parse(resourceText(summary.contents));
        expect(summaryData.itemCount).toBe(2);
        expect(summaryData.related.tool.name).toBe("list_dataset_items");

        const firstPage = await readResource(
            harness.client,
            `mosaic://projects/${projectId}/datasets/${datasetId}/items/1/first`,
        );
        const firstPageData = JSON.parse(resourceText(firstPage.contents));
        expect(firstPageData).toMatchObject({ complete: false });
        expect(firstPageData.items).toHaveLength(1);
        expect(firstPageData.nextPageUri).toContain("/items/1/");
        const nextPage = await readResource(
            harness.client,
            firstPageData.nextPageUri,
        );
        expect(JSON.parse(resourceText(nextPage.contents))).toMatchObject({
            complete: true,
            items: [{ id: itemIds[1] }],
        });

        const runSummary = await readResource(
            harness.client,
            `mosaic://projects/${projectId}/runs/${runId}/summary`,
        );
        const runSummaryData = JSON.parse(resourceText(runSummary.contents));
        expect(runSummaryData.progress.total).toBe(2);
        expect(runSummaryData.related.tool.name).toBe("list_run_cells");
        const runPage = await readResource(
            harness.client,
            `mosaic://projects/${projectId}/runs/${runId}/cells/1/first`,
        );
        const runPageData = JSON.parse(resourceText(runPage.contents));
        expect(runPageData.cells).toHaveLength(1);
        expect(runPageData.complete).toBe(false);

        const prompt = await harness.client.getPrompt({
            name: "create_eval_happy_path",
        });
        const promptText = prompt.messages[0]?.content;
        expect(JSON.stringify(promptText)).toContain(
            "validates and saves the version on success",
        );

        const datasetToolSummary = await harness.client.callTool({
            name: "get_dataset_summary",
            arguments: { projectId, datasetId },
        });
        expect(datasetToolSummary.isError).not.toBe(true);
        expect(datasetToolSummary.structuredContent).toMatchObject({
            data: { itemCount: 2 },
        });
        const datasetToolPage = await harness.client.callTool({
            name: "list_dataset_items",
            arguments: { projectId, datasetId, limit: 1 },
        });
        expect(datasetToolPage.isError).not.toBe(true);
        expect(datasetToolPage.structuredContent).toMatchObject({
            data: {
                complete: false,
                items: [expect.objectContaining({ id: itemIds[0] })],
            },
        });

        const runToolSummary = await harness.client.callTool({
            name: "get_run_summary",
            arguments: { projectId, runId },
        });
        expect(runToolSummary.isError).not.toBe(true);
        expect(runToolSummary.structuredContent).toMatchObject({
            data: { progress: { total: 2 }, modelIds: ["model-a"] },
        });
        const runToolPage = await harness.client.callTool({
            name: "list_run_cells",
            arguments: { projectId, runId, limit: 1 },
        });
        expect(runToolPage.isError).not.toBe(true);
        expect(runToolPage.structuredContent).toMatchObject({
            data: {
                complete: false,
                cells: [expect.objectContaining({ id: runCellIds[0] })],
            },
        });

        const workflowToolSummary = await harness.client.callTool({
            name: "get_workflow_run_summary",
            arguments: { projectId, workflowId, workflowRunId },
        });
        expect(workflowToolSummary.isError).not.toBe(true);
        expect(workflowToolSummary.structuredContent).toMatchObject({
            data: { progress: { total: 2 }, run: { id: workflowRunId } },
        });
        const workflowToolPage = await harness.client.callTool({
            name: "list_workflow_run_cells",
            arguments: { projectId, workflowId, workflowRunId, limit: 1 },
        });
        expect(workflowToolPage.isError).not.toBe(true);
        expect(workflowToolPage.structuredContent).toMatchObject({
            data: {
                complete: false,
                cells: [expect.objectContaining({ id: runCellIds[0] })],
            },
        });
        expect(query).toHaveBeenCalled();
    });

    it.each([
        {
            name: "cross tenant",
            uri: "mosaic://projects/11111111-1111-4111-8111-111111111111/datasets/22222222-2222-4222-8222-222222222222",
            query: vi.fn(async (sql: string) =>
                sql.includes("from projects")
                    ? { rows: [], rowCount: 0 }
                    : { rows: [], rowCount: 0 },
            ),
            code: -32602,
            message: "Project was not found in the authenticated workspace.",
            dataCode: "not_found",
        },
        {
            name: "not found",
            uri: "mosaic://projects/11111111-1111-4111-8111-111111111111/datasets/22222222-2222-4222-8222-222222222222",
            query: vi.fn(async (sql: string) => {
                if (sql.includes("from projects")) {
                    return {
                        rows: [{ id: "11111111-1111-4111-8111-111111111111" }],
                        rowCount: 1,
                    };
                }
                if (sql.includes("from datasets")) {
                    return { rows: [], rowCount: 0 };
                }
                return { rows: [], rowCount: 0 };
            }),
            code: -32602,
            message: "Not found",
            dataCode: "not_found",
        },
        {
            name: "forbidden",
            uri: "mosaic://projects/11111111-1111-4111-8111-111111111111/datasets/22222222-2222-4222-8222-222222222222",
            query: vi.fn(async (sql: string) => {
                if (sql.includes("from projects")) {
                    return {
                        rows: [{ id: "11111111-1111-4111-8111-111111111111" }],
                        rowCount: 1,
                    };
                }
                if (sql.includes("from datasets")) {
                    throw new ApiForbiddenError("Dataset access denied.");
                }
                return { rows: [], rowCount: 0 };
            }),
            code: -32003,
            message: "Dataset access denied.",
            dataCode: "forbidden",
        },
        {
            name: "malformed cursor",
            uri: "mosaic://projects/11111111-1111-4111-8111-111111111111/datasets/22222222-2222-4222-8222-222222222222/items/10/not-a-cursor",
            query: vi.fn(async (sql: string) =>
                sql.includes("from projects")
                    ? {
                          rows: [
                              {
                                  id: "11111111-1111-4111-8111-111111111111",
                              },
                          ],
                          rowCount: 1,
                      }
                    : { rows: [], rowCount: 0 },
            ),
            code: -32602,
            message:
                "Invalid page cursor. Restart pagination without a cursor.",
            dataCode: "bad_request",
        },
        {
            name: "internal failure",
            uri: "mosaic://projects/11111111-1111-4111-8111-111111111111/datasets/22222222-2222-4222-8222-222222222222",
            query: vi.fn(async (sql: string) => {
                if (sql.includes("from projects")) {
                    return {
                        rows: [{ id: "11111111-1111-4111-8111-111111111111" }],
                        rowCount: 1,
                    };
                }
                if (sql.includes("from datasets")) {
                    throw new Error("private database diagnostic");
                }
                return { rows: [], rowCount: 0 };
            }),
            code: -32603,
            message:
                "Internal server error. Check the request ID before retrying.",
            dataCode: "internal_error",
        },
    ])(
        "returns a sanitized MCP resource protocol error for $name",
        async (testCase) => {
            const query = testCase.query as unknown as Parameters<
                typeof createRuntime
            >[0];
            const harness = await connectStdioClient(createRuntime(query));
            close = harness.close;

            let caught: unknown;
            try {
                await harness.client.readResource({ uri: testCase.uri });
            } catch (error) {
                caught = error;
            }

            expect(caught).toMatchObject({
                code: testCase.code,
                message: expect.stringContaining(testCase.message),
                data: {
                    code: testCase.dataCode,
                    requestId: expect.any(String),
                },
            });
            expect(String(caught)).not.toContain("private database diagnostic");
            expect(caught).not.toHaveProperty("contents");
        },
    );
});
