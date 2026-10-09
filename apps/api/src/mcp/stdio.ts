import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getApiConfig } from "../config.js";
import { createDb } from "../db.js";
import { resolveMcpPrincipalForRawToken } from "./auth.js";
import { registerMosaicMcpCapabilities } from "./registry.js";

function requiredEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required env: ${name}`);
    return value;
}

export async function startMosaicMcpStdio(): Promise<void> {
    const config = getApiConfig();
    if (!config.mosaicMcpRawTokenFallbackEnabled) {
        throw new Error(
            "MOSAIC_MCP_RAW_TOKEN_FALLBACK_ENABLED must be true for local stdio MCP.",
        );
    }

    const db = createDb(config);
    const token = requiredEnv("MOSAIC_MCP_LOCAL_TOKEN");
    const principal = await resolveMcpPrincipalForRawToken(db, config, token);

    const server = new McpServer({
        name: "mosaic-evals",
        version: "0.1.0",
    });
    registerMosaicMcpCapabilities(server, { runtime: { config, db }, principal });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Flash Evals MCP stdio server running.");
}

const isEntrypoint =
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
    startMosaicMcpStdio().catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
