/* global AbortSignal, console, fetch, process */
// Read-only MCP connection check. Run from the repository root with Node 24.
// Supply a local development token through MOSAIC_MCP_LOCAL_TOKEN, never a file
// committed to Git. An optional first argument overrides the endpoint URL.
const endpoint = process.argv[2] ?? "http://127.0.0.1:3001/mcp";
const token = process.env.MOSAIC_MCP_LOCAL_TOKEN;
if (!token) {
    throw new Error(
        "Set MOSAIC_MCP_LOCAL_TOKEN to your local MCP bearer token.",
    );
}
let requestId = 0;
let protocolVersion = "2025-11-25";

async function rpc(method, params = {}, notification = false) {
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "MCP-Protocol-Version": protocolVersion,
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            ...(notification ? {} : { id: ++requestId }),
            method,
            params,
        }),
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
        throw new Error(`${method}: HTTP ${response.status}`);
    }
    if (notification) return;
    const message = await response.json();
    if (message.error) {
        throw new Error(`${method}: ${message.error.message}`);
    }
    if (message.result?.isError) {
        const explanation = message.result.content
            ?.filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
        throw new Error(`${method}: ${explanation ?? "Tool failed"}`);
    }
    return message.result;
}

async function tool(name, args = {}) {
    const result = await rpc("tools/call", { name, arguments: args });
    return result.structuredContent.data;
}

const initialized = await rpc("initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "flash-evals-docs", version: "1.0.0" },
});
protocolVersion = initialized.protocolVersion;
await rpc("notifications/initialized", {}, true);
const { tools } = await rpc("tools/list");
const { resourceTemplates } = await rpc("resources/templates/list");
const { prompts } = await rpc("prompts/list");
const user = await tool("get_current_user");
const workspaces = await tool("list_workspaces");
const projects = [];
for (const workspace of workspaces) {
    projects.push(
        ...(await tool("list_projects", { workspaceId: workspace.id })),
    );
}
console.log(
    JSON.stringify(
        {
            server: initialized.serverInfo,
            protocolVersion,
            toolCount: tools.length,
            resourceTemplates: resourceTemplates.map(
                (entry) => entry.uriTemplate,
            ),
            prompts: prompts.map((entry) => entry.name),
            user,
            workspaces,
            projects,
        },
        null,
        2,
    ),
);
