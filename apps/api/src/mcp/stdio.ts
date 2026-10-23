import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getApiConfig } from "../config.js";
import { createDb } from "../db.js";
import { startRunEnqueueReplay } from "../runEnqueue.js";
import { resolveMcpPrincipalForRawToken } from "./auth.js";
import { registerFlashEvalsMcpCapabilities } from "./registry.js";

function requiredEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required env: ${name}`);
    return value;
}

export async function startFlashEvalsMcpStdio(): Promise<void> {
    const config = getApiConfig();
    if (!config.flashEvalsMcpRawTokenFallbackEnabled) {
        throw new Error(
            "FLASH_EVALS_MCP_RAW_TOKEN_FALLBACK_ENABLED must be true for local stdio MCP.",
        );
    }

    const db = createDb(config);
    const token = requiredEnv("FLASH_EVALS_MCP_LOCAL_TOKEN");
    const principal = await resolveMcpPrincipalForRawToken(db, config, token);

    const server = new McpServer({
        name: "flash-evals",
        version: "0.1.0",
    });
    registerFlashEvalsMcpCapabilities(server, {
        runtime: { config, db },
        principal,
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    const stopRunReplay = startRunEnqueueReplay(db, config);
    server.server.onclose = stopRunReplay;
    console.error("Flash Evals MCP stdio server running.");
}

const isEntrypoint =
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
    startFlashEvalsMcpStdio().catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
