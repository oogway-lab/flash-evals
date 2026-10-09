import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { expect, vi } from "vitest";
import type { z } from "zod";
import type { IApiRuntime } from "../../server.js";
import type { IMcpContext } from "./context.js";

export const TEST_PROJECT_ID = "11111111-1111-4111-8111-111111111111";
export const TEST_TEAM_ID = "team-1";

export interface IRegisteredTool {
    config: {
        annotations?: { destructiveHint?: boolean; idempotentHint?: boolean };
        inputSchema?: z.ZodType;
    };
    handler: (input: Record<string, unknown>) => Promise<unknown>;
}

interface IToolHarnessOptions {
    config?: Record<string, unknown>;
    projectId?: string;
    teamId?: string;
    userId?: string;
}

export function createToolHarness(
    register: (server: McpServer, context: IMcpContext) => void,
    options: IToolHarnessOptions = {},
): {
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
    } as unknown as McpServer;
    const runtime = {
        config: options.config ?? {},
        db: {
            query: vi.fn().mockResolvedValue({
                rows: [{ id: options.projectId ?? TEST_PROJECT_ID }],
                rowCount: 1,
            }),
        },
    } as unknown as IApiRuntime;
    register(server, {
        runtime,
        principal: {
            authMode: "oauth",
            userId: options.userId ?? "user-1",
            teamId: options.teamId ?? TEST_TEAM_ID,
            email: "user@example.com",
        },
    });
    return { tools, runtime };
}

export function expectConfirmationGate(
    tool: IRegisteredTool,
    inputWithoutConfirmation: Record<string, unknown>,
): void {
    expect(() =>
        tool.config.inputSchema!.parse(inputWithoutConfirmation),
    ).toThrow();
    expect(tool.config.annotations).toMatchObject({
        destructiveHint: true,
        idempotentHint: true,
    });
}
