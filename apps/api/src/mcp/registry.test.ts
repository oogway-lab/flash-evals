import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isKnownMcpToolEffect } from "./effects.js";

const promptMocks = vi.hoisted(() => ({
    testPromptDraftPayload: vi.fn(),
}));
const datasetMocks = vi.hoisted(() => ({
    listDatasetsPayload: vi.fn(),
}));
const dashboardMocks = vi.hoisted(() => ({
    dashboardPayload: vi.fn(),
}));
const projectMocks = vi.hoisted(() => ({
    createProjectPayload: vi.fn(),
    listProjectsPayload: vi.fn(),
    updateProjectPayload: vi.fn(),
}));

vi.mock("../routes/datasets.js", () => ({
    createDatasetPayload: vi.fn(),
    datasetDetailPayload: vi.fn(),
    importGoldenAnswersPayload: vi.fn(),
    previewGoldenAnswersPayload: vi.fn(),
    commitGoldenAnswersPayload: vi.fn(),
    importImageAnswersPayload: vi.fn(),
    importImagesPayload: vi.fn(),
    importPairedItemsPayload: vi.fn(),
    importTextItemsPayload: vi.fn(),
    listDatasetsPayload: datasetMocks.listDatasetsPayload,
}));
vi.mock("../routes/dashboard.js", () => dashboardMocks);

vi.mock("../routes/projects.js", () => projectMocks);

vi.mock("../routes/prompts.js", () => ({
    createJudgePromptPayload: vi.fn(),
    deletePromptPayload: vi.fn(),
    duplicatePromptVersionPayload: vi.fn(),
    generatePromptSchemaPayload: vi.fn(),
    listPromptsPayload: vi.fn(),
    optimizePromptPayload: vi.fn(),
    promptDetailPayload: vi.fn(),
    promptWorkbenchSetupPayload: vi.fn(),
    saveRunnablePromptPayload: vi.fn(),
    testJudgeDraftPayload: vi.fn(),
    testPromptDraftPayload: promptMocks.testPromptDraftPayload,
    validateRunnablePromptPayload: vi.fn(),
}));

import { registerMosaicMcpCapabilities } from "./registry.js";
import type { IApiRuntime } from "../server.js";

interface IRegisteredTool {
    config: {
        title?: string;
        description?: string;
        annotations?: {
            destructiveHint?: boolean;
            idempotentHint?: boolean;
        };
        inputSchema?: z.ZodType;
    };
    handler: (input: Record<string, unknown>) => Promise<unknown>;
}

describe("MCP prompt tools", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("snapshots the complete tool catalog and input schemas", () => {
        const { tools } = registerTools();

        expect(
            [...tools].map(([name, { config }]) => ({
                name,
                title: config.title,
                description: config.description,
                annotations: config.annotations,
                inputSchema: config.inputSchema
                    ? z.toJSONSchema(config.inputSchema)
                    : undefined,
            })),
        ).toMatchSnapshot();
    });

    it("keeps route authoring and pinning schemas free of opaque dependency inputs", () => {
        const { tools } = registerTools();
        const createSchema = JSON.stringify(
            z.toJSONSchema(
                tools.get("create_workflow_llm_route_version")!.config
                    .inputSchema!,
            ),
        );
        expect(createSchema).not.toMatch(/providerKeyId|capabilityVersionId/);

        const candidatesSchema = JSON.stringify(
            z.toJSONSchema(
                tools.get("list_workflow_llm_provider_models")!.config
                    .inputSchema!,
            ),
        );
        expect(candidatesSchema).toContain("transport");

        const pinSchema = JSON.stringify(
            z.toJSONSchema(
                tools.get("select_workflow_llm_model")!.config.inputSchema!,
            ),
        );
        expect(pinSchema).toContain("routeVersionId");
        expect(pinSchema).not.toMatch(/provider|modelId/);
    });

    it("accepts and propagates transport with the authenticated team", async () => {
        const tools = new Map<string, IRegisteredTool>();
        const server = {
            registerTool: (
                name: string,
                config: IRegisteredTool["config"],
                handler: IRegisteredTool["handler"],
            ) => tools.set(name, { config, handler }),
            registerResource: vi.fn(),
            registerPrompt: vi.fn(),
        } as unknown as McpServer;
        const runtime = {
            config: {},
            db: { query: vi.fn(async () => ({ rows: [] })) },
        } as unknown as IApiRuntime;
        promptMocks.testPromptDraftPayload.mockResolvedValue({ results: [] });

        registerMosaicMcpCapabilities(server, {
            runtime,
            principal: {
                authMode: "oauth",
                profile: "admin",
                userId: "user-1",
                teamId: "authenticated-team",
                email: "user@example.com",
                name: "User",
            },
        });
        const tool = tools.get("test_prompt_draft")!;
        const input = {
            teamId: "attacker-team",
            prompt: "Answer",
            jsonSchema: { type: "object" },
            targetModelId: "gpt-4o",
            transport: "bifrost",
            samples: [{ name: "Sample", inputText: "hello" }],
        };

        expect(tool.config.inputSchema?.parse(input)).toMatchObject({
            transport: "bifrost",
        });
        await tool.handler(input);

        expect(promptMocks.testPromptDraftPayload).toHaveBeenCalledWith(
            runtime.db,
            runtime.config,
            expect.objectContaining({
                teamId: "authenticated-team",
                transport: "bifrost",
            }),
        );
    });

    it("uses an explicit project once after validating workspace ownership", async () => {
        const { tools, runtime } = registerTools();
        const projectId = "11111111-1111-4111-8111-111111111111";
        vi.mocked(runtime.db.query).mockResolvedValueOnce({
            rows: [{ id: projectId }],
            rowCount: 1,
        } as never);
        datasetMocks.listDatasetsPayload.mockResolvedValue([]);

        await tools.get("list_datasets")!.handler({ projectId });

        expect(runtime.db.query).toHaveBeenCalledTimes(1);
        expect(runtime.db.query).toHaveBeenCalledWith(
            expect.stringContaining("team_id = $1 and id = $2"),
            ["authenticated-team", projectId, null],
        );
        expect(datasetMocks.listDatasetsPayload).toHaveBeenCalledWith(
            runtime.db,
            "authenticated-team",
            projectId,
            { includeArchived: undefined },
        );
    });

    it("rate limits LLM-cost tools per principal before calling the payload", async () => {
        const { tools, runtime } = registerTools();
        vi.mocked(runtime.db.query).mockResolvedValueOnce({
            rows: [{ requestCount: 21, retryAfterSeconds: 9 }],
        } as never);
        promptMocks.testPromptDraftPayload.mockClear();

        const result = await tools.get("test_prompt_draft")!.handler({
            prompt: "Answer",
            jsonSchema: { type: "object" },
            targetModelId: "gpt-4o",
            samples: [{ name: "Sample", inputText: "hello" }],
        });
        expect(result).toMatchObject({
            isError: true,
            structuredContent: {
                error: {
                    code: "rate_limited",
                    retryable: true,
                    retryAfterSeconds: 9,
                },
            },
        });

        expect(runtime.db.query).toHaveBeenCalledWith(
            expect.stringContaining("insert into api_rate_limits"),
            ["llm:authenticated-team:user-1", 60],
        );
        expect(promptMocks.testPromptDraftPayload).not.toHaveBeenCalled();
    });

    it("does not rate limit read-only tools", async () => {
        const { tools, runtime } = registerTools();
        vi.mocked(runtime.db.query).mockResolvedValueOnce({
            rows: [{ id: "11111111-1111-4111-8111-111111111111" }],
            rowCount: 1,
        } as never);
        datasetMocks.listDatasetsPayload.mockResolvedValue([]);

        await tools.get("list_datasets")!.handler({});

        expect(runtime.db.query).not.toHaveBeenCalledWith(
            expect.stringContaining("api_rate_limits"),
            expect.anything(),
        );
    });

    it("masks non-domain handler errors from MCP clients", async () => {
        const { tools, runtime } = registerTools();
        vi.mocked(runtime.db.query).mockResolvedValueOnce({
            rows: [{ id: "11111111-1111-4111-8111-111111111111" }],
            rowCount: 1,
        } as never);
        datasetMocks.listDatasetsPayload.mockRejectedValueOnce(
            new Error("connect ECONNREFUSED 10.0.0.5:5432"),
        );
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);

        const result = await tools.get("list_datasets")!.handler({});
        expect(result).toMatchObject({
            isError: true,
            structuredContent: {
                error: { code: "internal_error", status: 500 },
            },
        });
        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining('"event":"mcp.handler.failed"'),
        );
        consoleError.mockRestore();
    });

    it("rejects a project outside the authenticated workspace", async () => {
        const { tools, runtime } = registerTools();
        const projectId = "22222222-2222-4222-8222-222222222222";
        vi.mocked(runtime.db.query).mockResolvedValueOnce({
            rows: [],
            rowCount: 0,
        } as never);

        const result = await tools.get("list_datasets")!.handler({ projectId });
        expect(result).toMatchObject({
            isError: true,
            structuredContent: {
                error: {
                    code: "not_found",
                    message:
                        "Project was not found in the authenticated workspace.",
                    status: 404,
                },
            },
        });
        expect(datasetMocks.listDatasetsPayload).not.toHaveBeenCalled();
    });

    it("exposes project discovery and creation with principal-owned scope", async () => {
        const { tools, runtime } = registerTools();
        projectMocks.listProjectsPayload.mockResolvedValue([]);
        projectMocks.createProjectPayload.mockResolvedValue({
            id: "project-1",
        });

        const workspaceId = "11111111-1111-4111-8111-111111111111";
        await tools.get("list_projects")!.handler({ workspaceId });
        await tools
            .get("create_project")!
            .handler({ workspaceId, name: "Research" });
        vi.mocked(runtime.db.query).mockResolvedValueOnce({
            rows: [{ id: "project-1" }],
            rowCount: 1,
        } as never);
        await tools.get("update_project")!.handler({
            projectId: "project-1",
            workspaceId,
            name: "Renamed",
        });

        expect(projectMocks.listProjectsPayload).toHaveBeenCalledWith(
            runtime.db,
            "authenticated-team",
            workspaceId,
        );
        expect(projectMocks.createProjectPayload).toHaveBeenCalledWith(
            runtime.db,
            {
                teamId: "authenticated-team",
                workspaceId,
                name: "Research",
                createdBy: "user-1",
            },
        );
        expect(projectMocks.updateProjectPayload).toHaveBeenCalledWith(
            runtime.db,
            {
                teamId: "authenticated-team",
                projectId: "project-1",
                workspaceId,
                name: "Renamed",
                updatedBy: "user-1",
            },
        );
    });

    it("loads the dashboard in principal-owned project scope", async () => {
        const { tools, runtime } = registerTools();
        const projectId = "11111111-1111-4111-8111-111111111111";
        vi.mocked(runtime.db.query).mockResolvedValueOnce({
            rows: [{ id: projectId }],
            rowCount: 1,
        } as never);
        dashboardMocks.dashboardPayload.mockResolvedValue({
            stats: {},
            recentRuns: [],
        });

        await tools.get("get_dashboard")!.handler({ projectId });

        expect(dashboardMocks.dashboardPayload).toHaveBeenCalledWith(
            runtime.db,
            "authenticated-team",
            projectId,
        );
    });

    it("describes every registered tool effect and denies direct admin-only calls to eval", async () => {
        const { tools, runtime } = registerTools("eval");
        expect([...tools.keys()].every(isKnownMcpToolEffect)).toBe(true);
        expect(
            tools.get("get_dataset_summary")?.config.annotations,
        ).toMatchObject({
            readOnlyHint: true,
            destructiveHint: false,
        });
        expect(tools.get("set_provider_key")?.config.annotations).toMatchObject(
            { readOnlyHint: false, openWorldHint: false },
        );

        const result = await tools.get("set_provider_key")!.handler({
            provider: "openai",
            key: "must-not-reach-the-handler",
        });
        expect(result).toMatchObject({
            isError: true,
            structuredContent: {
                error: {
                    code: "forbidden",
                    status: 403,
                    message: expect.stringContaining(
                        "requires the admin profile",
                    ),
                },
            },
        });
        expect(runtime.db.query).not.toHaveBeenCalled();
    });

    it("allows read calls and denies eval writes to the read profile even when called directly", async () => {
        const { tools, runtime } = registerTools("read");
        const forbidden = await tools.get("create_dataset")!.handler({
            projectId: "11111111-1111-4111-8111-111111111111",
            name: "No write",
            purpose: "evaluation",
            modality: "text",
        });
        expect(forbidden).toMatchObject({
            isError: true,
            structuredContent: { error: { code: "forbidden", status: 403 } },
        });
        expect(runtime.db.query).not.toHaveBeenCalled();
    });
});

function registerTools(profile: "read" | "eval" | "admin" = "admin"): {
    tools: Map<string, IRegisteredTool>;
    runtime: IApiRuntime;
} {
    const tools = new Map<string, IRegisteredTool>();
    const server = {
        registerTool: (
            name: string,
            config: IRegisteredTool["config"],
            handler: IRegisteredTool["handler"],
        ) => tools.set(name, { config, handler }),
        registerResource: vi.fn(),
        registerPrompt: vi.fn(),
    } as unknown as McpServer;
    const runtime = {
        config: {},
        db: { query: vi.fn() },
    } as unknown as IApiRuntime;
    registerMosaicMcpCapabilities(server, {
        runtime,
        principal: {
            authMode: "oauth",
            profile,
            userId: "user-1",
            teamId: "authenticated-team",
            email: "user@example.com",
            name: "User",
        },
    });
    return { tools, runtime };
}
