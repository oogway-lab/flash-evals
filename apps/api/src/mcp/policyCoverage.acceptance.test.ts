import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type {
    Transport,
    TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { IApiRuntime } from "../server.js";
import { registerMosaicMcpCapabilities } from "./registry.js";

// This policy is intentionally written out here instead of importing the
// effect annotations under test. A tool change must update this reviewed list.
const READ_TOOLS = [
    "list_workspaces",
    "get_current_user",
    "list_eval_context",
    "list_projects",
    "get_dashboard",
    "list_datasets",
    "get_dataset",
    "get_dataset_summary",
    "list_dataset_items",
    "get_prompt",
    "list_prompts",
    "list_runs",
    "get_run",
    "get_run_progress",
    "get_run_summary",
    "list_run_cells",
    "list_workflows",
    "get_workflow",
    "list_workflow_runs",
    "get_workflow_run",
    "get_workflow_run_summary",
    "list_workflow_run_cells",
    "get_workflow_run_progress",
    "list_provider_keys",
    "list_workflow_llm_capabilities",
    "list_workflow_llm_routes",
    "list_workflow_llm_provider_models",
    "list_workflow_llm_route_history",
    "get_workflow_llm_default",
] as const;

const ADMIN_ONLY_TOOLS = [
    "delete_dataset_item",
    "delete_dataset_label",
    "delete_dataset",
    "set_dataset_archived",
    "delete_prompt",
    "delete_run",
    "delete_workflow",
    "set_provider_key",
    "clear_provider_key",
    "clear_workflow_llm_default",
] as const;

const ALL_TOOLS = [
    "list_workspaces",
    "create_workspace",
    "rename_workspace",
    "get_current_user",
    "list_eval_context",
    "list_projects",
    "create_project",
    "update_project",
    "get_dashboard",
    "list_datasets",
    "get_dataset",
    "get_dataset_summary",
    "list_dataset_items",
    "create_dataset",
    "import_dataset_images",
    "import_dataset_text_items",
    "import_dataset_golden_answers",
    "preview_dataset_golden_answers",
    "commit_dataset_golden_answers",
    "import_dataset_image_answers",
    "import_dataset_paired_items",
    "add_dataset_item",
    "update_dataset_item",
    "delete_dataset_item",
    "delete_dataset_label",
    "rename_dataset",
    "update_dataset_description",
    "set_dataset_archived",
    "duplicate_dataset",
    "delete_dataset",
    "import_dataset_audio",
    "import_dataset_audio_answers",
    "list_prompts",
    "get_prompt",
    "generate_schema_from_prompt",
    "test_prompt_draft",
    "validate_runnable_prompt",
    "create_runnable_prompt",
    "optimize_prompt",
    "test_judge_draft",
    "generate_judge_for_run",
    "create_judge_prompt",
    "duplicate_prompt_version",
    "delete_prompt",
    "list_runs",
    "get_run",
    "get_run_progress",
    "get_run_summary",
    "list_run_cells",
    "create_eval_run",
    "save_run_note",
    "annotate_run_cell",
    "retry_run",
    "delete_run",
    "list_workflows",
    "get_workflow",
    "create_workflow",
    "create_multiworkflow",
    "update_workflow",
    "delete_workflow",
    "select_workflow_llm_model",
    "create_workflow_run",
    "list_workflow_runs",
    "get_workflow_run",
    "get_workflow_run_summary",
    "list_workflow_run_cells",
    "save_workflow_run_note",
    "annotate_workflow_run_cell",
    "get_workflow_run_progress",
    "list_provider_keys",
    "set_provider_key",
    "clear_provider_key",
    "create_stt_route_probe",
    "list_workflow_llm_capabilities",
    "refresh_workflow_llm_capabilities",
    "list_workflow_llm_routes",
    "list_workflow_llm_provider_models",
    "list_workflow_llm_route_history",
    "create_workflow_llm_route_version",
    "create_workflow_llm_route_for_model",
    "disable_workflow_llm_route",
    "get_workflow_llm_default",
    "set_workflow_llm_default",
    "clear_workflow_llm_default",
] as const;

const EXPECTED_BY_PROFILE = {
    read: new Set<string>(READ_TOOLS),
    eval: new Set<string>(
        ALL_TOOLS.filter((name) => !ADMIN_ONLY_TOOLS.includes(name as never)),
    ),
    admin: new Set<string>(ALL_TOOLS),
} as const;

describe("MCP independent profile policy over the protocol", () => {
    it("matches the reviewed 84-tool inventory and expected profile matrix", async () => {
        expect(new Set(ALL_TOOLS).size).toBe(84);
        expect(new Set(READ_TOOLS).size).toBe(29);
        expect(new Set(ADMIN_ONLY_TOOLS).size).toBe(10);
        expect(EXPECTED_BY_PROFILE.eval.size).toBe(74);

        for (const profile of ["read", "eval", "admin"] as const) {
            const session = await connect(profile);
            try {
                const { tools } = await session.client.listTools();
                const actual = new Set(tools.map((tool) => tool.name));
                expect(actual).toEqual(EXPECTED_BY_PROFILE[profile]);

                for (const tool of tools) {
                    expect(tool.annotations?.readOnlyHint).toBe(
                        READ_TOOLS.includes(tool.name as never),
                    );
                }

                const currentUser = await session.client.callTool({
                    name: "get_current_user",
                    arguments: {},
                });
                expect(currentUser.isError).not.toBe(true);
                expect(currentUser.content[0]?.text).toContain(
                    "policy@example.invalid",
                );

                if (profile !== "admin") {
                    let denied = false;
                    try {
                        const result = await session.client.callTool({
                            name: "clear_provider_key",
                            arguments: { provider: "openai", confirm: true },
                        });
                        denied = result.isError === true;
                    } catch {
                        denied = true;
                    }
                    expect(denied).toBe(true);
                }
            } finally {
                await session.close();
            }
        }
    });

    it("keeps the setup prompt and project-scoped resource catalog available in read profile", async () => {
        const session = await connect("read");
        try {
            const { resourceTemplates } =
                await session.client.listResourceTemplates();
            expect(resourceTemplates).toHaveLength(8);

            const { messages } = await session.client.getPrompt({
                name: "create_eval_happy_path",
            });
            expect(messages).toHaveLength(1);
            expect(messages[0]?.content.type).toBe("text");
        } finally {
            await session.close();
        }
    });
});

async function connect(profile: "read" | "eval" | "admin") {
    const toServer = new PassThrough();
    const fromServer = new PassThrough();
    const server = new McpServer({ name: "policy-acceptance", version: "1" });
    registerMosaicMcpCapabilities(server, {
        runtime: {
            config: {
                mosaicMcpEnabled: true,
                mosaicMcpAllowedOrigins: [],
                workflowLlmWritesEnabled: true,
                rateLimitLlmPerMinute: 0,
                rateLimitRunsPerMinute: 0,
            },
            db: {
                query: async () => {
                    throw new Error(
                        "Profile listing must not query the database",
                    );
                },
            },
        } as unknown as IApiRuntime,
        principal: {
            authMode: "oauth",
            profile,
            userId: "22222222-2222-4222-8222-222222222222",
            teamId: "33333333-3333-4333-8333-333333333333",
            email: "policy@example.invalid",
        },
    });
    await server.connect(new StdioServerTransport(toServer, fromServer));
    const client = new Client({
        name: "policy-acceptance-client",
        version: "1",
    });
    await client.connect(new StdioClientTransport(toServer, fromServer));
    return {
        client,
        async close() {
            await client.close();
            await server.close();
            toServer.destroy();
            fromServer.destroy();
        },
    };
}

class StdioClientTransport implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    private pending = "";

    constructor(
        private readonly toServer: PassThrough,
        private readonly fromServer: PassThrough,
    ) {
        this.fromServer.on("data", this.onData);
    }

    async start(): Promise<void> {}

    async send(
        message: JSONRPCMessage,
        _options?: TransportSendOptions,
    ): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.toServer.write(`${JSON.stringify(message)}\n`, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
    }

    async close(): Promise<void> {
        this.fromServer.off("data", this.onData);
        this.onclose?.();
    }

    private readonly onData = (chunk: Buffer | string): void => {
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
