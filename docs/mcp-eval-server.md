# Connect an agent with MCP

[Documentation home](../README.md#documentation) · [Configuration](configuration.md)

[Local setup](#local-setup) · [First evaluation](#a-first-evaluation-through-tools) ·
[Tool reference](#tool-reference) · [OAuth setup](#deployed-oauth-setup) ·
[Troubleshooting](#troubleshooting)

MCP (Model Context Protocol) lets an agent discover and call Flash Evals tools.
It can inspect datasets and results, build prompts and workflows, start runs, and
save review notes. These operations use the same API logic and data as the web app.

The HTTP endpoint is `/mcp` on the **API**, normally
`http://127.0.0.1:3001/mcp` locally. Enable it with `MOSAIC_MCP_ENABLED=true`.
The server uses **stateless Streamable HTTP**, not the older standalone SSE
transport. It creates no persistent MCP session ID. Send authorization on every
request; reconnecting does not cancel or undo work already created.

There are two authentication paths:

| Use               | Authentication                                                             |
| ----------------- | -------------------------------------------------------------------------- |
| Local development | Explicitly enabled raw bearer-token fallback                               |
| Deployed instance | Clerk OAuth, with a Flash Evals account linked by signing into the web app |

**The web app's `AUTH_DEV` bypass never authenticates MCP requests.** Do not
publish local bearer tokens or put them in checked-in client configuration.

## Local setup

First complete [Getting started](getting-started.md), including migrations and
the synthetic seed. Keep the API, web app, and worker running with `pnpm run dev`.

### Enable and create a development token

1. Add these settings to `apps/api/.env`. Generate a random pepper with
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
   and use its output in place of the placeholder:

    ```dotenv
    MOSAIC_MCP_ENABLED=true
    MOSAIC_MCP_RAW_TOKEN_FALLBACK_ENABLED=true
    MOSAIC_MCP_TOKEN_PEPPER=replace-with-your-generated-value
    ```

2. Stop and restart `pnpm run dev` to load the changes. Leave the OAuth settings
   unset for this local fallback; a partial OAuth configuration can prevent the
   API from starting, and a complete OAuth configuration takes precedence over
   raw tokens on HTTP.
3. In a second terminal at the repository root, create a token for the seeded
   development account:

    ```bash
    pnpm --filter @mosaic/api mcp:token:create -- --email dev@local --name "Local MCP"
    ```

    The command prints `tokenId`, `userId`, `teamId`, and the full `token` once.
    Keep the token private and retain its ID for revocation. For another existing
    local account, replace `dev@local` with that account's email. The command does
    not create a user.

The pepper must stay the same when creating and using tokens. Changing it makes
existing token hashes unusable. Raw-token fallback is rejected in production.

### Check the connection without making model calls

In a Bash terminal, read the token without putting it into shell history, then
run the included example:

```bash
read -r -s -p "Local MCP token: " MOSAIC_MCP_LOCAL_TOKEN
printf '\n'
export MOSAIC_MCP_LOCAL_TOKEN
node docs/examples/mcp-read-only.mjs
```

The [example source](examples/mcp-read-only.mjs) negotiates the protocol, lists
tools, resource templates, and prompts, and reads your user, workspaces, and
projects. It does not create datasets or run evaluations. It reports **84 tools,
8 resource templates, and 1 prompt** on this revision. It also gives you the
workspace and project IDs needed for subsequent calls.

An optional first argument selects another local API address:

```bash
node docs/examples/mcp-read-only.mjs http://127.0.0.1:3002/mcp
```

Only pass a trusted endpoint: the example sends your bearer token to that URL.
It is a local raw-token example, not an OAuth login client.

### Configure your MCP client

For an HTTP client, select Streamable HTTP and use:

- URL: `http://127.0.0.1:3001/mcp`
- Header: `Authorization: Bearer YOUR_LOCAL_TOKEN`

Store the header in the client's private configuration. If it sends an `Origin`
header, add that exact origin to the comma-separated
`MOSAIC_MCP_ALLOWED_ORIGINS` in `apps/api/.env`, then restart the API. A client
without an `Origin` header does not need an origin-list entry. This setting is
separate from the web app's `CORS_ORIGINS`.

A local client can alternatively launch the stdio entrypoint from the repository
root. Build shared packages first if this is a fresh checkout:

```bash
node scripts/build-packages.mjs
pnpm --silent --filter @mosaic/api mcp:stdio
```

`--silent` keeps pnpm's command banners off the stdio protocol stream.
The client process must inherit `MOSAIC_MCP_LOCAL_TOKEN`, and the API environment
file must enable `MOSAIC_MCP_RAW_TOKEN_FALLBACK_ENABLED=true`. Configure the
client's working directory as the repository root. The stdio server talks to the
same database and queue directly; it still needs a running database and worker
for evaluations. It does not turn the server into an unauthenticated local tool.

When finished, revoke the token by the ID printed during creation:

```bash
pnpm --filter @mosaic/api mcp:token:revoke -- --token-id YOUR_TOKEN_UUID
unset MOSAIC_MCP_LOCAL_TOKEN
```

## Understand scope and responses

Start with `get_current_user`, `list_workspaces`, and `list_projects`. Most tools
require an explicit `projectId`; `list_projects` requires `workspaceId`, and
`list_eval_context` requires both. Use IDs returned by this instance. A project
outside the authenticated tenant is rejected even when its UUID is valid.

The token determines `userId` and `teamId`. Supplying those fields in a tool call
does not change the caller's identity. Projects organize data within the tenant;
they do not grant per-project privacy.

MCP also enforces a server-side profile for every tool call. OAuth clients may
request `flash-evals:read`, `flash-evals:eval`, or `flash-evals:admin`; admin
includes the lower profile capabilities. Existing OAuth clients without a
Flash Evals profile scope keep the evaluation profile. `read` allows read-only
tools, `eval` adds evaluation and ordinary project writes, and `admin` adds
destructive actions and provider-key configuration. Existing raw-token clients
retain admin access for compatibility; use OAuth profiles for routine agents.
The server omits tools above the caller's profile from `tools/list` and rejects
direct calls to them. Tool annotations describe effects for clients but do not
grant permission. A routine evaluation agent therefore cannot see or submit the
raw `key` field on `set_provider_key`; configure provider credentials through
the admin profile or the web app.

### A successful HTTP request can contain a failed tool call

For a successful tool call, the JSON-RPC response contains:

```json
{
    "jsonrpc": "2.0",
    "id": 2,
    "result": {
        "content": [
            { "type": "text", "text": "Human-readable summary and data" }
        ],
        "structuredContent": { "data": { "example": "tool-specific result" } }
    }
}
```

Check all of these before treating an operation as successful:

1. HTTP status: authentication, origin, and transport failures may be non-2xx.
2. JSON-RPC `error`: the protocol request itself may have failed.
3. `result.isError`: a tool can return HTTP 200 with `isError: true`.
4. Tool-specific data: for example, `validate_runnable_prompt` can complete
   successfully while `result.structuredContent.data.passed` is `false`.

Read successful machine-readable results from `result.structuredContent.data`.
Do not parse the prose summary to recover IDs. The read-only example checks the
first three levels; callers must interpret validation and run status themselves.

## A first evaluation through tools

This is a small structured-text example. Use an MCP client to call each named
tool with the JSON arguments shown. Replace uppercase ID placeholders with
returned UUIDs and `MODEL_ID` with an available, structured-output-capable model
from your own `list_eval_context` response.

**Steps 3–4 make provider calls and may cost money.** The default path calls
`create_runnable_prompt` once; it validates the supplied samples and saves the
prompt only when validation passes. This example uses the configured default
transport throughout. Review the selected provider before proceeding.

For explicit provider selection, pass the same optional `transport` to each
prompt operation you choose. Accepted values are `openai`, `gateway`,
`openrouter`, and `bifrost`. Omitting it keeps the configured default. Use
`test_prompt_draft` or `validate_runnable_prompt` as separate exploratory checks
only when useful; `create_runnable_prompt` validates again because it creates a
new validation record for the saved version. Workflow routes provide explicit
execution-time routing.

### 1. Discover the project and available models

Call `list_workspaces` with no arguments, then `list_projects` with:

```json
{ "workspaceId": "WORKSPACE_UUID" }
```

Call `list_eval_context`:

```json
{ "workspaceId": "WORKSPACE_UUID", "projectId": "PROJECT_UUID" }
```

### 2. Create a dataset and one reference answer

Call `create_dataset`:

```json
{
    "projectId": "PROJECT_UUID",
    "name": "Sentiment example",
    "purpose": "golden",
    "modality": "text"
}
```

Keep the returned `id` as `DATASET_UUID`. Call `add_dataset_item`:

```json
{
    "projectId": "PROJECT_UUID",
    "datasetId": "DATASET_UUID",
    "inputText": "The delivery was fast and everything worked.",
    "label": { "sentiment": "positive" }
}
```

### 3. Validate and save a runnable prompt

Call `create_runnable_prompt` once with the prompt, schema, and representative
sample. It returns validation evidence and saves a version only when the sample
passes:

```json
{
    "projectId": "PROJECT_UUID",
    "name": "Sentiment classifier",
    "targetModelId": "MODEL_ID",
    "content": "Classify the sentiment of the input as positive, negative, or neutral. Return the requested JSON object.",
    "jsonSchema": {
        "type": "object",
        "properties": {
            "sentiment": {
                "type": "string",
                "enum": ["positive", "negative", "neutral"]
            }
        },
        "required": ["sentiment"],
        "additionalProperties": false
    },
    "fieldConfigs": [{ "field": "sentiment", "kind": "factual" }],
    "samples": [
        {
            "name": "positive",
            "inputText": "The delivery was fast and everything worked."
        }
    ]
}
```

Keep the returned `promptVersionId` as `PROMPT_VERSION_UUID`. If validation
fails, inspect its evidence and revise the prompt or schema before retrying.
`create_runnable_prompt` calls the prompt text `content`; the standalone
validation tool calls it `prompt`.

### 4. Create a run and inspect its results

Choose an `idempotencyKey` once for this logical run, such as
`sentiment-example-001`, and retain it with the request. Reuse the same key and
arguments if you retry after a timeout or error. Choose a new key for a new
evaluation, including another pass through this walkthrough.

Use a judge-capable model for `judgeModelId`, then call `create_eval_run`:

```json
{
    "projectId": "PROJECT_UUID",
    "datasetId": "DATASET_UUID",
    "promptVersionId": "PROMPT_VERSION_UUID",
    "idempotencyKey": "sentiment-example-001",
    "modelIds": ["MODEL_ID"],
    "maxTokens": 256,
    "judgeModelId": "MODEL_ID",
    "judgeRubric": "Score whether the sentiment classification matches the input.",
    "fieldConfigs": [{ "field": "sentiment", "kind": "factual" }]
}
```

Keep the returned `runId`. The response also contains `enqueueStatus`:

- `queued`: the run has been published to the worker queue.
- `pending_enqueue`: the run and its publication intent are saved, and the server
  will retry queue publication. It is safe to keep polling this run.

Call `get_run_progress` every few seconds with:

```json
{ "projectId": "PROJECT_UUID", "runId": "RUN_UUID" }
```

When the run reaches a terminal state, call `get_run` with the same arguments.
Inspect failed cells and individual outputs as well as aggregate scores.
`save_run_note` accepts `projectId`, `runId`, and `body`; `annotate_run_cell`
accepts a `runCellId` from the result and review fields shown by `tools/list`.

`create_eval_run` accepts an optional `idempotencyKey` of 1–200 characters after
trimming, scoped to the authenticated team, project, and creator. Repeating the
same key with the same original request returns the existing run, including
after dataset or prompt state changes. Reusing it for different input returns a
conflict. Omitting it creates a new run on each call, so do not blindly repeat an
unkeyed request after a timeout; inspect `list_runs` and the API logs first.

`retry_run` retries failed work and also returns `runId` and `enqueueStatus`.
It may make additional paid provider calls. There is no durable run-cancellation
tool; disconnecting the MCP client does not stop a queued run.

### Workflows

A workflow connects steps into a graph. Read `get_workflow` before editing it.
`select_workflow_llm_model` updates one node atomically, preserving concurrent
selections on other nodes. If the target node was removed, reload the graph
before trying again. `update_workflow` still replaces the complete graph, so
refresh your copy before submitting a whole-graph edit.

Use `list_eval_context` and the workflow model tools to choose explicit model
routing for model-backed nodes. A saved route version pins a provider/model
configuration; a project default is resolved when the run is created.

`create_workflow_run` requires `projectId`, `workflowId`, `datasetId`,
`runTarget` (`dataset` or `single_item`), and a non-empty `idempotencyKey`.
For `single_item`, also supply `itemId`. Choose one stable key for a logical
request and reuse it with the same input when retrying. A result with
`enqueueStatus: "pending_enqueue"` identifies a durable run awaiting queue
publication; preserve its `workflowRunId` rather than creating another run.
Poll `get_workflow_run_progress` with the project, workflow, and workflow-run IDs.

## Resources and the setup prompt

Discover the eight **resource templates** with `resources/templates/list`.
`resources/list` is not the inventory of these parameterized resources.

| Resource          | URI template                                          |
| ----------------- | ----------------------------------------------------- |
| Dataset           | `mosaic://projects/{projectId}/datasets/{id}`         |
| Prompt            | `mosaic://projects/{projectId}/prompts/{id}`          |
| Eval run          | `mosaic://projects/{projectId}/runs/{id}`             |
| Model options     | `mosaic://projects/{projectId}/models`                |
| Dataset summary   | `mosaic://projects/{projectId}/datasets/{id}/summary` |
| Dataset item page | `mosaic://projects/{projectId}/datasets/{id}/items`   |
| Run summary       | `mosaic://projects/{projectId}/runs/{id}/summary`     |
| Run cell page     | `mosaic://projects/{projectId}/runs/{id}/cells`       |

Replace the braces with actual IDs, then call `resources/read` with a `uri`.
The content is JSON text. The original dataset and run resources retain their
full v1 responses. Use the summary resources for compact context and item/cell
resources for pages. Start at `/items/{limit}/first` or `/cells/{limit}/first`,
then follow `nextPageUri` until `complete` is true. Use the page tools when you
need filters or opt-in item/cell detail. The `mosaic://` prefix is an existing
protocol identifier and should not be renamed to `flash-evals://`.

`prompts/list` exposes one prompt, `create_eval_happy_path`. Retrieve it with
`prompts/get` and `{"name":"create_eval_happy_path"}` for a suggested sequence.
It is guidance for the client, not an operation that creates a run by itself.

## Tool reference

The current catalog contains **84 tools** across six groups. `tools/list` is the
authoritative source for each tool's input schema, description, and annotations.
The [registry snapshot test](../apps/api/src/mcp/registry.test.ts) checks the
catalog; listing a tool does not establish that every provider or execution path
has been tested. See the [MCP audit coverage matrix](mcp-audit-coverage.md) for
the suite evidence and integration boundaries.

| Group                               | Tools |
| ----------------------------------- | ----- |
| Identity, workspaces, and projects  | 9     |
| Datasets                            | 23    |
| Prompts                             | 12    |
| Runs and review                     | 10    |
| Provider settings and model routing | 15    |
| Workflows                           | 15    |

See the [complete tool index](mcp-tool-reference.md) for every name.

Deletion, archive changes, and provider-key removal require `confirm: true` and
advertise destructive annotations. Inspect the target first. This boolean is a
client-supplied argument, **not human consent enforced by the server**. Configure
your agent's own approval controls for deletion, credentials, and paid work.

## Deployed OAuth setup

This section describes the MCP authentication requirements for an instance you
already operate. It is not a complete hosted-deployment walkthrough.

1. Configure the Flash Evals web app and API for Clerk, and sign into the web app
   once. MCP looks up the linked Clerk user; it does not provision the account.
2. Enable MCP and supply the API's OAuth settings:

    ```dotenv
    MOSAIC_MCP_ENABLED=true
    MOSAIC_MCP_RESOURCE_URL=https://your-api.example/mcp
    CLERK_ISSUER=https://your-clerk-host.example
    CLERK_SECRET_KEY=your-server-secret
    CLERK_PUBLISHABLE_KEY=your-publishable-key
    CLERK_JWT_KEY=your-jwt-public-key
    MOSAIC_MCP_RAW_TOKEN_FALLBACK_ENABLED=false
    ```

3. Choose a client-registration policy:
    - **One pinned client:** set `MOSAIC_MCP_OAUTH_CLIENT_ID` to that Clerk OAuth
      application's client ID and register the client's exact redirect URI in
      Clerk. Tokens issued for another client are rejected.
    - **Dynamic clients:** enable dynamic client registration in Clerk, set
      `MOSAIC_MCP_OAUTH_DYNAMIC_CLIENTS=true`, and leave
      `MOSAIC_MCP_OAUTH_CLIENT_ID` unset. The Flash Evals setting alone does not
      enable registration in Clerk. Without a pin, the client-ID equality guard
      does not restrict access to one application; review that trust decision.
4. Set `MOSAIC_MCP_ALLOWED_ORIGINS` to the exact origins of browser-based clients
   you want to allow. Avoid copying another deployment's allowlist. Review
   `CLERK_AUTHORIZED_PARTIES` if you use additional token restrictions. Clerk
   checks that explicit allowlist against the token's `azp` claim. OAuth JWTs
   identify the client with `client_id`; Flash Evals checks the verified client
   ID against `MOSAIC_MCP_OAUTH_CLIENT_ID` separately. The client ID is not an
   implicit `azp` restriction.
5. In the MCP client, select Streamable HTTP, enter your API's `/mcp` URL, and
   complete OAuth. Grant a profile scope explicitly when the client supports
   custom scopes; do not grant `flash-evals:admin` to routine evaluation agents.
   Client support for discovery, registration, scopes, and
   redirects varies; use the client's and Clerk's current instructions.

Production requires an HTTPS resource URL and refuses raw-token fallback.
MCP OAuth requires JWT access tokens with an `at+jwt` or `application/at+jwt`
header type and an `iss` claim exactly equal to `CLERK_ISSUER`. Configure Clerk
to issue JWT OAuth access tokens with the MCP resource as their audience.
Opaque OAuth access tokens have no verifiable issuer claim and are rejected.
Keep the server secret private. The publishable key, client ID, and JWT public
key have different roles; they are not substitutes for an OAuth access token.

To check discovery without credentials:

```bash
curl -i https://your-api.example/.well-known/oauth-protected-resource/mcp
curl -i https://your-api.example/mcp
```

With OAuth configured, the first response includes `resource`,
`authorization_servers`, and `bearer_methods_supported`. The unauthenticated
MCP request returns 401 with a `WWW-Authenticate` header pointing to the metadata.
These checks do not prove a particular client's sign-in flow works. After signing
in, call `get_current_user` and verify it returns the intended account.

## Troubleshooting

| Symptom                                                | Likely next check                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 404 or “MCP is not enabled”                            | Enable `MOSAIC_MCP_ENABLED` and restart the API; use its port, not the web port.                         |
| “Missing MCP bearer token”                             | Supply authorization on every request. Web development sign-in does not apply.                           |
| “MCP OAuth is not configured”                          | Configure OAuth, or explicitly enable the local raw-token fallback.                                      |
| “Invalid MCP bearer token”                             | Verify the token exists in this database, is not revoked, and uses the same pepper.                      |
| API refuses to start after enabling MCP                | Check all required OAuth fields and either a pinned client ID or dynamic-client opt-in.                  |
| 403 “Origin is not allowed for MCP”                    | Allow the client's exact `Origin`; `CORS_ORIGINS` does not configure MCP.                                |
| OAuth account is not linked                            | Sign into the Flash Evals web app with that Clerk account first.                                         |
| OAuth token was issued for another client              | Check the configured client-ID pin and whether this client registered dynamically.                       |
| OAuth redirect or scope error                          | Check the redirect URI and scopes requested by that client against its Clerk application.                |
| “Project was not found in the authenticated workspace” | Discover IDs using this token's workspace/project tools; do not reuse another tenant's IDs.              |
| HTTP 200 but no result                                 | Check JSON-RPC `error`, `result.isError`, and tool-specific validation/status fields.                    |
| Too many requests                                      | Wait for the reported retry interval; LLM and run-creation tools share the API's configured rate limits. |
| A run never progresses                                 | Inspect the worker and queue/database logs. MCP connectivity does not verify worker health.              |

Retain the response's `x-request-id` for server-side debugging. Redact tokens,
provider keys, and private inputs before sharing diagnostics.
