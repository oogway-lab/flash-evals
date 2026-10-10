import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type {
    Transport,
    TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IApiRuntime } from "../server.js";

const routeMocks = vi.hoisted(() => {
    const createModule = (
        names: string[],
        special: Record<string, (...args: never[]) => unknown> = {},
    ) => {
        return Object.fromEntries(
            names.map((name) => [
                name,
                vi.fn(special[name] ?? (async () => ({}))),
            ]),
        );
    };
    return {
        datasets: createModule(
            [
                "commitGoldenAnswersPayload",
                "createDatasetItemFromFormPayload",
                "createDatasetItemPayload",
                "createDatasetPayload",
                "datasetDetailPayload",
                "datasetSummaryPayload",
                "deleteDatasetItemPayload",
                "deleteDatasetPayload",
                "deleteLabelPayload",
                "duplicateDatasetPayload",
                "importAudioAnswersPayload",
                "importAudioPayload",
                "importGoldenAnswersPayload",
                "importImageAnswersPayload",
                "importImagesPayload",
                "importPairedItemsPayload",
                "importTextItemsPayload",
                "listDatasetsPayload",
                "listDatasetItemsPagePayload",
                "listDatasetSummariesPagePayload",
                "previewGoldenAnswersPayload",
                "setDatasetArchivedPayload",
                "updateDatasetDescriptionPayload",
                "updateDatasetItemPayload",
                "updateDatasetNamePayload",
            ],
            {
                datasetSummaryPayload: async () => ({
                    dataset: {
                        id: "22222222-2222-4222-8222-222222222222",
                        name: "Fixture",
                        purpose: "evaluation",
                        modality: "text",
                        pipelineId: null,
                        description: null,
                        archivedAt: null,
                    },
                    itemCount: 0,
                    labeledItemCount: 0,
                    labelMode: "freeform",
                    freeformLabel: true,
                    isRunnable: false,
                }),
                listDatasetItemsPagePayload: async () => ({
                    items: [],
                    complete: true,
                }),
                listDatasetSummariesPagePayload: async () => ({
                    datasets: [],
                    complete: true,
                }),
                duplicateDatasetPayload: async () => ({
                    sourceDatasetId: "22222222-2222-4222-8222-222222222222",
                    createdDatasetId: "33333333-3333-4333-8333-333333333333",
                }),
            },
        ),
        prompts: createModule(
            [
                "createJudgePromptPayload",
                "deletePromptPayload",
                "duplicatePromptVersionPayload",
                "generatePromptSchemaPayload",
                "listPromptsPayload",
                "optimizePromptPayload",
                "promptDetailPayload",
                "promptWorkbenchSetupPayload",
                "saveRunnablePromptPayload",
                "testJudgeDraftPayload",
                "testPromptDraftPayload",
                "validateRunnablePromptPayload",
            ],
            {
                saveRunnablePromptPayload: async () => ({
                    promptId: "33333333-3333-4333-8333-333333333333",
                    promptVersionId: "55555555-5555-4555-8555-555555555555",
                }),
                duplicatePromptVersionPayload: async () => ({
                    sourcePromptVersionId:
                        "44444444-4444-4444-8444-444444444444",
                    promptId: "33333333-3333-4333-8333-333333333333",
                    promptVersionId: "55555555-5555-4555-8555-555555555555",
                }),
                validateRunnablePromptPayload: async () => ({
                    passed: true,
                    evidence: { sampleResults: [] },
                }),
            },
        ),
        runs: createModule(
            [
                "createRunFromSelectionPayload",
                "deleteRunPayload",
                "generateJudgeForRunPayload",
                "listRunCellsPagePayload",
                "listRunsPayload",
                "listRunSummariesPagePayload",
                "runDetailPayload",
                "runProgressPayload",
                "runSummaryPayload",
                "saveCellAnnotationPayload",
                "saveRunNotePayload",
                "retryRunPayload",
                "runSetupPayload",
            ],
            {
                runSummaryPayload: async () => ({
                    run: {
                        id: "22222222-2222-4222-8222-222222222222",
                        datasetId: "33333333-3333-4333-8333-333333333333",
                        status: "completed",
                        createdAt: "2026-10-10T00:00:00.000Z",
                    },
                    progress: {
                        total: 0,
                        done: 0,
                        failed: 0,
                        pending: 0,
                    },
                    modelIds: [],
                }),
                listRunCellsPagePayload: async () => ({
                    cells: [],
                    complete: true,
                }),
                listRunSummariesPagePayload: async () => ({
                    runs: [],
                    complete: true,
                }),
                createRunFromSelectionPayload: async () => ({
                    runId: "22222222-2222-4222-8222-222222222222",
                    enqueueStatus: "queued",
                }),
            },
        ),
        workflows: createModule(
            [
                "createWorkflowPayload",
                "createWorkflowRunPayload",
                "deleteWorkflowPayload",
                "listWorkflowRunCellsPagePayload",
                "listWorkflowRunSummariesPagePayload",
                "listWorkflowRunsPayload",
                "listWorkflowSummariesPagePayload",
                "listWorkflowsPayload",
                "saveWorkflowRunCellAnnotationPayload",
                "saveWorkflowRunNotePayload",
                "selectWorkflowLlmModelPayload",
                "updateWorkflowPayload",
                "workflowDetailPayload",
                "workflowRunDetailPayload",
                "workflowRunProgressPayload",
                "workflowRunSummaryPayload",
            ],
            {
                workflowRunSummaryPayload: async () => ({
                    run: {
                        id: "44444444-4444-4444-8444-444444444444",
                        datasetId: "55555555-5555-4555-8555-555555555555",
                        targetItemId: null,
                        status: "completed",
                        runTarget: "dataset",
                        createdAt: "2026-10-10T00:00:00.000Z",
                    },
                    progress: {
                        status: "completed",
                        total: 0,
                        done: 0,
                        failed: 0,
                        pending: 0,
                    },
                }),
                listWorkflowRunCellsPagePayload: async () => ({
                    cells: [],
                    complete: true,
                }),
                listWorkflowRunSummariesPagePayload: async () => ({
                    workflowRuns: [],
                    complete: true,
                }),
                listWorkflowSummariesPagePayload: async () => ({
                    workflows: [],
                    complete: true,
                }),
                createWorkflowRunPayload: async () => ({
                    workflowRunId: "33333333-3333-4333-8333-333333333333",
                    enqueueStatus: "queued",
                }),
            },
        ),
        providerKeys: createModule(
            [
                "clearProviderKeyPayload",
                "listProviderKeysPayload",
                "setProviderKeyPayload",
            ],
            {
                listProviderKeysPayload: async () => [
                    {
                        id: "88888888-8888-4888-8888-888888888888",
                        provider: "openai",
                    },
                ],
            },
        ),
        llmRouting: createModule(
            [
                "assertWorkflowLlmWritesEnabled",
                "clearWorkflowLlmProjectDefaultPayload",
                "createWorkflowLlmRouteForModelPayload",
                "createWorkflowLlmRouteVersionPayload",
                "disableWorkflowLlmRoutePayload",
                "getWorkflowLlmProjectDefaultPayload",
                "listWorkflowLlmCapabilitiesPayload",
                "listWorkflowLlmRouteCandidatesPayload",
                "listWorkflowLlmRouteHistoryPayload",
                "listWorkflowLlmRoutesPayload",
                "refreshWorkflowLlmCapabilitiesPayload",
                "setWorkflowLlmProjectDefaultPayload",
            ],
            {
                listWorkflowLlmCapabilitiesPayload: async () => [],
                listWorkflowLlmRoutesPayload: async () => [],
                getWorkflowLlmProjectDefaultPayload: async () => ({}),
                createWorkflowLlmRouteVersionPayload: async () => ({
                    id: "66666666-6666-4666-8666-666666666666",
                    latestVersion: {
                        id: "77777777-7777-4777-8777-777777777777",
                    },
                }),
                createWorkflowLlmRouteForModelPayload: async () => ({
                    id: "66666666-6666-4666-8666-666666666666",
                    latestVersion: {
                        id: "77777777-7777-4777-8777-777777777777",
                    },
                }),
                listWorkflowLlmRouteCandidatesPayload: async () => ({
                    coverage: [],
                    candidates: [],
                }),
            },
        ),
        projects: createModule([
            "createProjectPayload",
            "listProjectsPayload",
            "updateProjectPayload",
        ]),
        workspaces: createModule([
            "createWorkspacePayload",
            "listWorkspacesPayload",
            "updateWorkspacePayload",
        ]),
        dashboard: createModule(["dashboardPayload"]),
        sttProbes: createModule(["createSttRouteProbePayload"]),
        publishRunEnqueue: vi.fn(async () => ({})),
        publishWorkflowRunEnqueue: vi.fn(async () => ({})),
        resolveMcpPrincipal: vi.fn(async () => ({
            authMode: "oauth",
            profile: "admin",
            userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            teamId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            email: "coverage@example.invalid",
        })),
    };
});

vi.mock("../routes/datasets.js", () => routeMocks.datasets);
vi.mock("../routes/prompts.js", () => routeMocks.prompts);
vi.mock("../routes/runs.js", () => routeMocks.runs);
vi.mock("../routes/workflows.js", () => routeMocks.workflows);
vi.mock("../routes/keys.js", () => routeMocks.providerKeys);
vi.mock("../routes/llmRouting.js", () => routeMocks.llmRouting);
vi.mock("../routes/projects.js", () => routeMocks.projects);
vi.mock("../routes/workspaces.js", () => routeMocks.workspaces);
vi.mock("../routes/dashboard.js", () => routeMocks.dashboard);
vi.mock("../routes/sttProbes.js", () => routeMocks.sttProbes);
vi.mock("../runEnqueue.js", () => ({
    publishRunEnqueue: routeMocks.publishRunEnqueue,
}));
vi.mock("../workflowRunEnqueue.js", () => ({
    publishWorkflowRunEnqueue: routeMocks.publishWorkflowRunEnqueue,
}));
vi.mock("./auth.js", async (importOriginal) => {
    const original = (await importOriginal()) as Record<string, unknown>;
    return {
        ...original,
        resolveMcpPrincipal: routeMocks.resolveMcpPrincipal,
    };
});

import { registerMosaicMcpCapabilities } from "./registry.js";
import { handleMcpRequest } from "./http.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const datasetId = "22222222-2222-4222-8222-222222222222";
const promptId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const expectedReadTools = [
    "get_current_user",
    "get_dashboard",
    "get_dataset",
    "get_dataset_summary",
    "get_prompt",
    "get_run",
    "get_run_progress",
    "get_run_summary",
    "get_workflow",
    "get_workflow_llm_default",
    "get_workflow_run",
    "get_workflow_run_progress",
    "get_workflow_run_summary",
    "list_dataset_items",
    "list_dataset_summaries_page",
    "list_datasets",
    "list_eval_context",
    "list_projects",
    "list_prompts",
    "list_provider_keys",
    "list_run_cells",
    "list_run_summaries_page",
    "list_runs",
    "list_workflow_llm_capabilities",
    "list_workflow_llm_provider_models",
    "list_workflow_llm_route_history",
    "list_workflow_llm_routes",
    "list_workflow_run_cells",
    "list_workflow_run_summaries_page",
    "list_workflow_runs",
    "list_workflow_summaries_page",
    "list_workflows",
    "list_workspaces",
];

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

async function connect(profile: "read" | "eval" | "admin" = "admin") {
    const clientInput = new PassThrough();
    const serverOutput = new PassThrough();
    const server = new McpServer({
        name: "mcp-coverage-fixture",
        version: "1",
    });
    const runtime = runtimeFixture();
    registerMosaicMcpCapabilities(server, {
        runtime,
        principal: {
            authMode: "oauth",
            profile,
            userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            teamId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            email: "coverage@example.invalid",
        },
    });
    await server.connect(new StdioServerTransport(clientInput, serverOutput));
    const client = new Client({ name: "mcp-coverage-client", version: "1" });
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

function runtimeFixture(): IApiRuntime {
    return {
        config: {
            mosaicMcpEnabled: true,
            mosaicMcpAllowedOrigins: [],
            workflowLlmWritesEnabled: true,
        },
        db: {
            query: vi.fn(async (sql: string) =>
                sql.includes("from projects")
                    ? { rows: [{ id: projectId }], rowCount: 1 }
                    : sql.includes("api_rate_limits")
                      ? {
                            rows: [{ requestCount: 1, retryAfterSeconds: 1 }],
                            rowCount: 1,
                        }
                      : { rows: [], rowCount: 0 },
            ),
        },
    } as unknown as IApiRuntime;
}

async function callHttp(
    runtime: IApiRuntime,
    message: Record<string, unknown>,
): Promise<Record<string, any>> {
    const response = await handleMcpRequest(
        new Request("https://api.example.invalid/mcp", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...message }),
        }),
        runtime,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, any>;
}

function specimen(schema: Record<string, unknown> | undefined): unknown {
    if (!schema) return {};
    if ("const" in schema) return schema.const;
    if (Array.isArray(schema.enum)) return schema.enum[0];
    const alternative = firstSchemaAlternative(schema);
    if (alternative) return specimen(alternative);
    return specimenForType(schema, schemaType(schema));
}

function firstSchemaAlternative(
    schema: Record<string, unknown>,
): Record<string, unknown> | undefined {
    const alternatives = schema.anyOf ?? schema.oneOf ?? schema.allOf;
    if (!Array.isArray(alternatives) || alternatives.length === 0) {
        return undefined;
    }
    return alternatives[0] as Record<string, unknown>;
}

function schemaType(schema: Record<string, unknown>): unknown {
    return Array.isArray(schema.type) ? schema.type[0] : schema.type;
}

function specimenForType(
    schema: Record<string, unknown>,
    type: unknown,
): unknown {
    if (type === "string") return specimenString(schema);
    if (type === "integer" || type === "number") return specimenNumber(schema);
    if (type === "boolean") return true;
    if (type === "array") return specimenArray(schema);
    if (type === "object" || schema.properties) return specimenObject(schema);
    return {};
}

function specimenString(schema: Record<string, unknown>): string {
    if (schema.format === "uuid") return projectId;
    if (schema.format === "uri" || schema.format === "url") {
        return "https://example.invalid/resource";
    }
    return "fixture";
}

function specimenNumber(schema: Record<string, unknown>): number {
    return typeof schema.minimum === "number" ? schema.minimum : 1;
}

function specimenArray(schema: Record<string, unknown>): unknown[] {
    const count = typeof schema.minItems === "number" ? schema.minItems : 0;
    return Array.from({ length: count }, () =>
        specimen(schema.items as Record<string, unknown> | undefined),
    );
}

function specimenObject(
    schema: Record<string, unknown>,
): Record<string, unknown> {
    const properties = (schema.properties ?? {}) as Record<
        string,
        Record<string, unknown>
    >;
    const required = Array.isArray(schema.required)
        ? (schema.required as string[])
        : [];
    return Object.fromEntries(
        required.map((name) => [name, specimen(properties[name])]),
    );
}

function invalidSpecimen(
    schema: Record<string, unknown>,
    valid: Record<string, unknown>,
): Record<string, unknown> | undefined {
    const properties = (schema.properties ?? {}) as Record<
        string,
        Record<string, unknown>
    >;
    const required = Array.isArray(schema.required)
        ? (schema.required as string[])
        : [];
    const field = required[0] ?? Object.keys(properties)[0];
    if (!field) return undefined;
    const fieldSchema = properties[field] ?? {};
    const type = Array.isArray(fieldSchema.type)
        ? fieldSchema.type[0]
        : fieldSchema.type;
    let invalid: unknown = null;
    if (fieldSchema.format === "uuid") invalid = "not-a-uuid";
    else if (type === "string") invalid = "";
    else if (type === "integer" || type === "number") {
        invalid =
            typeof fieldSchema.minimum === "number"
                ? fieldSchema.minimum - 1
                : "not-a-number";
    } else if (type === "array") invalid = [];
    else if (type === "boolean") invalid = "not-a-boolean";
    return { ...valid, [field]: invalid };
}

describe("MCP complete tool call coverage over stdio", () => {
    let close: (() => Promise<void>) | undefined;

    afterEach(async () => {
        await close?.();
        close = undefined;
    });

    it("calls every registered tool and checks invalid input schemas", async () => {
        const harness = await connect();
        close = harness.close;
        const { tools } = await harness.client.listTools();
        expect(tools).toHaveLength(88);

        const outcomes: Array<{ name: string; result: string }> = [];
        const invalidOutcomes: string[] = [];
        for (const tool of tools) {
            const args = specimen(
                tool.inputSchema as Record<string, unknown>,
            ) as Record<string, unknown> | undefined;
            if (
                args &&
                [
                    "test_prompt_draft",
                    "validate_runnable_prompt",
                    "create_runnable_prompt",
                ].includes(tool.name)
            ) {
                args.samples = [{ name: "fixture", inputText: "example" }];
            }
            if (args && tool.name === "create_multiworkflow") {
                args.modality = "text";
            }
            if (args && tool.name === "create_workflow_run") {
                args.runTarget = "dataset";
            }
            try {
                const result = await harness.client.callTool({
                    name: tool.name,
                    arguments: args ?? {},
                });
                outcomes.push({
                    name: tool.name,
                    result: result.isError
                        ? JSON.stringify({
                              structuredContent: result.structuredContent,
                              content: result.content,
                          })
                        : "success",
                });
            } catch (error) {
                outcomes.push({
                    name: tool.name,
                    result: `threw: ${String(error)}`,
                });
            }

            const invalid = tool.inputSchema
                ? invalidSpecimen(
                      tool.inputSchema as Record<string, unknown>,
                      args ?? {},
                  )
                : undefined;
            if (invalid) {
                try {
                    const result = await harness.client.callTool({
                        name: tool.name,
                        arguments: invalid,
                    });
                    if (result.isError) invalidOutcomes.push(tool.name);
                } catch {
                    invalidOutcomes.push(tool.name);
                }
            }
        }

        expect(outcomes.filter((entry) => entry.result !== "success")).toEqual(
            [],
        );
        expect(invalidOutcomes).toHaveLength(
            tools.filter((tool) =>
                invalidSpecimen(
                    tool.inputSchema as Record<string, unknown>,
                    specimen(
                        tool.inputSchema as Record<string, unknown>,
                    ) as Record<string, unknown>,
                ),
            ).length,
        );
    });

    it("keeps every read-profile-restricted action blocked when called directly", async () => {
        const harness = await connect("read");
        close = harness.close;
        const { tools } = await harness.client.listTools();
        expect(
            tools.every((tool) => tool.annotations?.readOnlyHint === true),
        ).toBe(true);
        expect(tools.map((tool) => tool.name).sort()).toEqual(
            [...expectedReadTools].sort(),
        );

        const positiveCalls: string[] = [];
        for (const tool of tools) {
            const args = specimen(
                tool.inputSchema as Record<string, unknown>,
            ) as Record<string, unknown> | undefined;
            const result = await harness.client.callTool({
                name: tool.name,
                arguments: args ?? {},
            });
            if (!result.isError) positiveCalls.push(tool.name);
        }
        expect(positiveCalls.sort()).toEqual([...expectedReadTools].sort());

        const catalog = await connect();
        let allTools: Array<{
            name: string;
            annotations?: { readOnlyHint?: boolean };
            inputSchema?: Record<string, unknown>;
        }>;
        try {
            allTools = (await catalog.client.listTools()).tools;
        } finally {
            await catalog.close();
        }
        const unavailable = allTools.filter(
            (tool) => tool.annotations?.readOnlyHint !== true,
        );
        expect(unavailable.length).toBeGreaterThan(0);
        for (const tool of unavailable) {
            const args = specimen(tool.inputSchema) as
                Record<string, unknown> | undefined;
            if (
                args &&
                [
                    "test_prompt_draft",
                    "validate_runnable_prompt",
                    "create_runnable_prompt",
                ].includes(tool.name)
            ) {
                args.samples = [{ name: "fixture", inputText: "example" }];
            }
            if (args && tool.name === "create_multiworkflow") {
                args.modality = "text";
            }
            if (args && tool.name === "create_workflow_run") {
                args.runTarget = "dataset";
            }
            let result:
                Awaited<ReturnType<typeof harness.client.callTool>> | undefined;
            try {
                result = await harness.client.callTool({
                    name: tool.name,
                    arguments: args ?? {},
                });
            } catch {
                // The SDK may reject a disabled tool as a protocol error.
            }
            if (result) expect(result.isError).toBe(true);
        }
        const readableResource = await harness.client.readResource({
            uri: `mosaic://projects/${projectId}/models`,
        });
        expect(readableResource.contents).toHaveLength(1);
    });

    it("reads all resources and gets the setup prompt over stdio", async () => {
        const harness = await connect();
        close = harness.close;
        const { resourceTemplates } =
            await harness.client.listResourceTemplates();
        expect(resourceTemplates).toHaveLength(8);
        const uris = [
            `mosaic://projects/${projectId}/datasets/${datasetId}`,
            `mosaic://projects/${projectId}/prompts/${promptId}`,
            `mosaic://projects/${projectId}/runs/${runId}`,
            `mosaic://projects/${projectId}/models`,
            `mosaic://projects/${projectId}/datasets/${datasetId}/summary`,
            `mosaic://projects/${projectId}/datasets/${datasetId}/items/50/first`,
            `mosaic://projects/${projectId}/runs/${runId}/summary`,
            `mosaic://projects/${projectId}/runs/${runId}/cells/50/first`,
        ];
        for (const uri of uris) {
            const result = await harness.client.readResource({ uri });
            expect(result.contents.length).toBeGreaterThan(0);
        }
        const prompt = await harness.client.getPrompt({
            name: "create_eval_happy_path",
        });
        expect(prompt.messages).toHaveLength(1);
    });

    it("allows eval-profile reads and writes while blocking admin actions", async () => {
        const harness = await connect("eval");
        close = harness.close;
        const readable = await harness.client.callTool({
            name: "list_projects",
            arguments: { workspaceId: projectId },
        });
        expect(readable.isError).toBeFalsy();

        const writable = await harness.client.callTool({
            name: "create_project",
            arguments: { workspaceId: projectId, name: "Eval fixture project" },
        });
        expect(writable.isError).toBeFalsy();

        const adminOnly = await harness.client.callTool({
            name: "set_provider_key",
            arguments: { provider: "openai", key: "synthetic-fixture" },
        });
        expect(adminOnly.isError).toBe(true);
    });
});

describe("MCP complete tool call coverage over HTTP", () => {
    it("calls every registered tool and checks invalid input schemas", async () => {
        const runtime = runtimeFixture();
        const listed = await callHttp(runtime, {
            method: "tools/list",
            params: {},
        });
        const tools = listed.result.tools as Array<{
            name: string;
            inputSchema?: Record<string, unknown>;
        }>;
        expect(tools).toHaveLength(88);

        const invalidNames = new Set<string>();
        const failedPositive: string[] = [];
        for (const tool of tools) {
            const args = specimen(tool.inputSchema) as
                Record<string, unknown> | undefined;
            if (
                args &&
                [
                    "test_prompt_draft",
                    "validate_runnable_prompt",
                    "create_runnable_prompt",
                ].includes(tool.name)
            ) {
                args.samples = [{ name: "fixture", inputText: "example" }];
            }
            if (args && tool.name === "create_multiworkflow") {
                args.modality = "text";
            }
            if (args && tool.name === "create_workflow_run") {
                args.runTarget = "dataset";
            }
            const positive = await callHttp(runtime, {
                method: "tools/call",
                params: { name: tool.name, arguments: args ?? {} },
            });
            if (positive.error || positive.result?.isError) {
                failedPositive.push(tool.name);
            }

            const invalid = tool.inputSchema
                ? invalidSpecimen(tool.inputSchema, args ?? {})
                : undefined;
            if (invalid) {
                const rejected = await callHttp(runtime, {
                    method: "tools/call",
                    params: { name: tool.name, arguments: invalid },
                });
                if (rejected.error || rejected.result?.isError) {
                    invalidNames.add(tool.name);
                }
            }
        }
        expect(failedPositive).toEqual([]);
        expect(invalidNames.size).toBe(
            tools.filter((tool) =>
                tool.inputSchema
                    ? invalidSpecimen(
                          tool.inputSchema,
                          specimen(tool.inputSchema) as Record<string, unknown>,
                      )
                    : false,
            ).length,
        );
    });

    it("reads all resources and retrieves the setup prompt over HTTP", async () => {
        const runtime = runtimeFixture();
        const templates = await callHttp(runtime, {
            method: "resources/templates/list",
            params: {},
        });
        expect(templates.result.resourceTemplates).toHaveLength(8);
        const uris = [
            `mosaic://projects/${projectId}/datasets/${datasetId}`,
            `mosaic://projects/${projectId}/prompts/${promptId}`,
            `mosaic://projects/${projectId}/runs/${runId}`,
            `mosaic://projects/${projectId}/models`,
            `mosaic://projects/${projectId}/datasets/${datasetId}/summary`,
            `mosaic://projects/${projectId}/datasets/${datasetId}/items/50/first`,
            `mosaic://projects/${projectId}/runs/${runId}/summary`,
            `mosaic://projects/${projectId}/runs/${runId}/cells/50/first`,
        ];
        for (const uri of uris) {
            const resource = await callHttp(runtime, {
                method: "resources/read",
                params: { uri },
            });
            expect(resource.result.contents.length).toBeGreaterThan(0);
        }
        const prompt = await callHttp(runtime, {
            method: "prompts/get",
            params: { name: "create_eval_happy_path" },
        });
        expect(prompt.result.messages).toHaveLength(1);
    });

    it("rejects a direct hidden admin mutation for the read profile", async () => {
        const runtime = runtimeFixture();
        vi.mocked(routeMocks.resolveMcpPrincipal).mockResolvedValueOnce({
            authMode: "oauth",
            profile: "read",
            userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            teamId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            email: "coverage@example.invalid",
        });
        const denied = await callHttp(runtime, {
            method: "tools/call",
            params: {
                name: "set_provider_key",
                arguments: { provider: "openai", key: "synthetic-fixture" },
            },
        });
        expect(denied.error || denied.result?.isError).toBeTruthy();
    });

    it("allows read-profile calls for every annotated read tool over HTTP", async () => {
        const runtime = runtimeFixture();
        const catalog = await callHttp(runtime, {
            method: "tools/list",
            params: {},
        });
        const allTools = catalog.result.tools as Array<{
            name: string;
            inputSchema?: Record<string, unknown>;
        }>;
        vi.mocked(routeMocks.resolveMcpPrincipal).mockResolvedValue({
            authMode: "oauth",
            profile: "read",
            userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            teamId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            email: "coverage@example.invalid",
        });
        const readCatalog = await callHttp(runtime, {
            method: "tools/list",
            params: {},
        });
        const readable = readCatalog.result.tools as Array<{
            name: string;
            inputSchema?: Record<string, unknown>;
        }>;
        expect(readable.map((tool) => tool.name).sort()).toEqual(
            [...expectedReadTools].sort(),
        );
        for (const name of expectedReadTools) {
            const tool = allTools.find((candidate) => candidate.name === name)!;
            const args = specimen(tool.inputSchema) as
                Record<string, unknown> | undefined;
            const result = await callHttp(runtime, {
                method: "tools/call",
                params: { name, arguments: args ?? {} },
            });
            expect(result.error || result.result?.isError).toBeFalsy();
        }
        vi.mocked(routeMocks.resolveMcpPrincipal).mockResolvedValue({
            authMode: "oauth",
            profile: "admin",
            userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            teamId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            email: "coverage@example.invalid",
        });
    });

    it("allows eval-profile reads and writes while blocking admin actions over HTTP", async () => {
        const runtime = runtimeFixture();
        vi.mocked(routeMocks.resolveMcpPrincipal).mockResolvedValue({
            authMode: "oauth",
            profile: "eval",
            userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            teamId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            email: "coverage@example.invalid",
        });
        for (const [name, args] of [
            ["list_projects", { workspaceId: projectId }],
            [
                "create_project",
                { workspaceId: projectId, name: "Eval fixture project" },
            ],
        ] as const) {
            const result = await callHttp(runtime, {
                method: "tools/call",
                params: { name, arguments: args },
            });
            expect(result.error || result.result?.isError).toBeFalsy();
        }
        const adminOnly = await callHttp(runtime, {
            method: "tools/call",
            params: {
                name: "set_provider_key",
                arguments: { provider: "openai", key: "synthetic-fixture" },
            },
        });
        expect(adminOnly.error || adminOnly.result?.isError).toBeTruthy();
        vi.mocked(routeMocks.resolveMcpPrincipal).mockResolvedValue({
            authMode: "oauth",
            profile: "admin",
            userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            teamId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            email: "coverage@example.invalid",
        });
    });

    it("denies direct HTTP calls to every non-read tool for the read profile", async () => {
        const runtime = runtimeFixture();
        const catalog = await callHttp(runtime, {
            method: "tools/list",
            params: {},
        });
        const tools = catalog.result.tools as Array<{
            name: string;
            annotations?: { readOnlyHint?: boolean };
            inputSchema?: Record<string, unknown>;
        }>;
        vi.mocked(routeMocks.resolveMcpPrincipal).mockResolvedValue({
            authMode: "oauth",
            profile: "read",
            userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            teamId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            email: "coverage@example.invalid",
        });
        const restricted = tools.filter(
            (tool) => tool.annotations?.readOnlyHint !== true,
        );
        for (const tool of restricted) {
            const args = specimen(tool.inputSchema) as
                Record<string, unknown> | undefined;
            if (
                args &&
                [
                    "test_prompt_draft",
                    "validate_runnable_prompt",
                    "create_runnable_prompt",
                ].includes(tool.name)
            ) {
                args.samples = [{ name: "fixture", inputText: "example" }];
            }
            if (args && tool.name === "create_multiworkflow") {
                args.modality = "text";
            }
            if (args && tool.name === "create_workflow_run") {
                args.runTarget = "dataset";
            }
            const denied = await callHttp(runtime, {
                method: "tools/call",
                params: { name: tool.name, arguments: args ?? {} },
            });
            expect(denied.error || denied.result?.isError).toBeTruthy();
        }
        vi.mocked(routeMocks.resolveMcpPrincipal).mockResolvedValue({
            authMode: "oauth",
            profile: "admin",
            userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            teamId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            email: "coverage@example.invalid",
        });
    });
});
