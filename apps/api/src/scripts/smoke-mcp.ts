import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const token = process.env.FLASH_EVALS_MCP_LOCAL_TOKEN;
assert(token, "Set FLASH_EVALS_MCP_LOCAL_TOKEN in apps/api/.env first.");
const stdio = process.argv.includes("--stdio");
const url = new URL(
    process.env.FLASH_EVALS_MCP_TEST_URL || "/mcp",
    process.env.FLASH_EVALS_API_PUBLIC_URL || "http://localhost:3001",
);
const client = new Client({
    name: "flash-evals-local-smoke",
    version: "1.0.0",
});

async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    assert(!result.isError, `${name} returned an MCP tool error.`);
    const structured = result.structuredContent as
        { data?: unknown } | undefined;
    return structured?.data;
}

try {
    if (!stdio) {
        const rejectedHeaders: Record<string, string>[] = [
            {},
            { Authorization: "Bearer invalid-local-token" },
        ];
        for (const headers of rejectedHeaders) {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json, text/event-stream",
                    ...headers,
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "initialize",
                    params: {
                        protocolVersion: "2025-03-26",
                        capabilities: {},
                        clientInfo: { name: "auth-check", version: "1" },
                    },
                }),
            });
            assert(
                [401, 403].includes(response.status),
                "MCP must reject missing and invalid tokens.",
            );
        }
    }
    const transport = stdio
        ? new StdioClientTransport({
              command: process.execPath,
              args: ["--import", "tsx", "src/mcp/stdio.ts"],
              cwd: process.cwd(),
              env: Object.fromEntries(
                  Object.entries(process.env).filter(
                      (entry): entry is [string, string] =>
                          entry[1] !== undefined,
                  ),
              ),
              stderr: "pipe",
          })
        : new StreamableHTTPClientTransport(url, {
              requestInit: { headers: { Authorization: `Bearer ${token}` } },
          });
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, "flash-evals");
    const tools = await client.listTools();
    assert(tools.tools.some((tool) => tool.name === "get_current_user"));
    assert(tools.tools.some((tool) => tool.name === "list_workspaces"));
    await call("get_current_user");
    const workspaces = await call("list_workspaces");
    assert(
        Array.isArray(workspaces) && workspaces.length > 0,
        "Expected existing development workspace.",
    );
    const projects = await call("list_projects", {
        workspaceId: workspaces[0].id,
    });
    assert(
        Array.isArray(projects) && projects.length > 0,
        "Expected existing development project.",
    );
    const datasets = await call("list_datasets", { projectId: projects[0].id });
    assert(
        Array.isArray(datasets) && datasets.length > 0,
        "Expected an existing development dataset.",
    );
    const resource = await client.readResource({
        uri: `flash-evals://projects/${projects[0].id}/datasets/${datasets[0].id}/summary`,
    });
    assert(resource.contents.length > 0, "Expected dataset summary resource.");
    const templates = await client.listResourceTemplates();
    assert(
        templates.resourceTemplates.every((template) =>
            template.uriTemplate.startsWith("flash-evals://"),
        ),
    );
    console.info(
        JSON.stringify({
            transport: stdio ? "stdio" : "http",
            server: client.getServerVersion()?.name,
            tools: tools.tools.length,
            resourceTemplates: templates.resourceTemplates.length,
            authentication: "verified",
            existingDatasetRead: "ok",
            providerCalls: 0,
        }),
    );
} finally {
    await client.close();
}
