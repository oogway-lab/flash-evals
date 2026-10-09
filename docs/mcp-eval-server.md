# Flash Evals MCP Eval Server

Flash Evals exposes a Streamable HTTP MCP endpoint at `/mcp` when `MOSAIC_MCP_ENABLED=true`.
The deployed endpoint uses Clerk OAuth access tokens: Clerk proves identity, and Flash Evals maps the Clerk subject to `users.clerk_user_id` to recover the `userId` and `teamId` used by the existing eval APIs.
Raw `mcp_...` bearer tokens are local/dev fallback only and must not be the normal teammate onboarding path.

## Endpoints

| Environment                                     | URL                           |
| ----------------------------------------------- | ----------------------------- |
| Deployed API                                    | `https://<your-api-host>/mcp` |
| Local API (`pnpm run dev` / `pnpm run api:dev`) | `http://127.0.0.1:3001/mcp`   |

The sections below use `<your-api-host>` for your deployed API host and
`<your-clerk-host>` for your Clerk frontend API host (for a Clerk production
instance, usually `clerk.<your-web-host>`).

## Connect an agent

Authentication is standard MCP OAuth discovery, so a compliant client
negotiates the whole flow from the URL alone — there is no token to paste.

Claude Code (add `-s user` to make it available in every project, or
`-s project` to write it into a checked-in `.mcp.json` for teammates):

```bash
claude mcp add --transport http flash-evals https://<your-api-host>/mcp
```

Then run `/mcp` in the session and complete the Clerk sign-in in the browser.

Against a local stack, point at the API's own origin and supply a raw token —
`AUTH_DEV` does **not** apply to this endpoint. `resolveMcpPrincipal` always
requires a bearer token: it uses Clerk when OAuth is configured, otherwise the
raw-token fallback, and rejects the request with `MCP OAuth is not configured.`
when neither is set up. Enable the fallback and mint a token as described in
[Local Raw Token Fallback](#local-raw-token-fallback), then:

```bash
claude mcp add --transport http flash-evals-local http://127.0.0.1:3001/mcp \
  --header "Authorization: Bearer mcp_..."
```

For local Codex work prefer the stdio entrypoint instead (see the same
section) — it skips localhost networking entirely.

Other clients (MCP Inspector, Codex, Cursor) take the same URL with transport
type `http` and register themselves — see
[Connecting an MCP client](#connecting-an-mcp-client-claude-connector-codex-cursor-inspector)
for the server-side requirements.

## Connecting an MCP client (Claude connector, Codex, Cursor, Inspector)

Flash Evals accepts **any** MCP client that completes Clerk OAuth. Clients register
themselves through RFC 7591 dynamic client registration, so there is no per-client
setup: add the URL `https://<your-api-host>/mcp` and sign in.

```bash
# Claude Code
claude mcp add --transport http flash-evals https://<your-api-host>/mcp

# Codex CLI
codex mcp add flash-evals --url https://<your-api-host>/mcp
codex mcp login flash-evals
```

For the Claude desktop/web connector, add it under **Settings → Connectors → Add
custom connector** with that URL and leave **OAuth Client ID** and **Client
Secret** empty.

Three things must be true on the server side for that to work. This list exists
so a new Clerk instance can be set up in one pass rather than discovered one
failure at a time.

**1. Dynamic client registration enabled, and no client id pinned.**

Enable DCR on the Clerk instance (confirm with `curl -s
https://<your-clerk-host>/.well-known/oauth-authorization-server | grep
registration_endpoint`), and on the API service set:

```bash
MOSAIC_MCP_OAUTH_DYNAMIC_CLIENTS=true
# and leave MOSAIC_MCP_OAUTH_CLIENT_ID unset
```

Both halves are required. `resolveMcpOAuthConfig` throws
`Missing required MCP OAuth env: MOSAIC_MCP_OAUTH_CLIENT_ID or
MOSAIC_MCP_OAUTH_DYNAMIC_CLIENTS=true` at boot if neither is present, so the API
would crash-loop. And `MOSAIC_MCP_OAUTH_DYNAMIC_CLIENTS` alone does nothing at
the auth layer — it only relaxes that startup validation. What actually admits
dynamic clients is the **absence** of `MOSAIC_MCP_OAUTH_CLIENT_ID`: both client
guards in `resolveClerkOAuthSubject` are conditional on it, so leaving it unset
skips them rather than failing them.

If a client id _is_ pinned, every other client is rejected with
`OAuth token was not issued for this Flash Evals MCP client.` — even one that
completed Clerk sign-in successfully, because DCR mints a fresh client id per
registration. This is the trade-off: pinning supports exactly one client, and
there is no allowlist of several (the equality check is scalar).

**Security note.** With no pin, any client registered against the Clerk instance
is accepted once a user consents. The bound on that is
`routes/auth.ts`, which provisions Flash Evals accounts only for verified
addresses on `MOSAIC_ALLOWED_EMAIL_DOMAIN`, so an attacker must phish a team member's consent
screen rather than any internet user. Treat "only approve Flash Evals consent screens
you initiated" as the operating rule, and revoke authorised applications per user
in Clerk if anything looks wrong. Note that destructive tools' `confirm: true`
requirement is a tool argument an agent supplies itself, not a human gate.

**Static client id (only when DCR is unavailable).** Set
`MOSAIC_MCP_OAUTH_CLIENT_ID` to the Clerk application's id, put the same value
in the client's _OAuth Client ID_ field, and register that client's redirect URI
(next section). A client id is a public identifier — it travels in every
authorize URL — so it is not a secret, but the client _secret_ is; leave it
empty, since the Clerk application is a public client using PKCE and a supplied
secret is ignored. Clients with no client-id field at all (Codex) cannot be used
this way.

**2. Redirect URI registered in Clerk — static client ids only.**

In **Clerk Dashboard → Configure → OAuth Applications → (this app) → Redirect
URLs**, add exactly:

```text
https://claude.ai/api/mcp/auth_callback
```

No trailing slash. Missing it fails at Clerk's authorize endpoint with
`The 'redirect_uri' parameter does not match any of the OAuth 2.0 Client's
pre-registered redirect urls.` Dynamically registered clients supply their own
redirect URI at registration time, so this step does not apply to them — Codex,
for instance, uses an ephemeral `http://127.0.0.1:<port>/callback/<nonce>` that
could never be pre-registered.

**3. Scopes enabled on the Clerk application.**

Clients request all six of `openid`, `profile`, `email`, `public_metadata`,
`private_metadata`, `offline_access`. Every one must be enabled — this applies to
dynamically registered clients too, which is why it is worth checking on a fresh
Clerk instance.

This is the failure that looks least like its cause: Clerk's
`/oauth/authorize` still returns a clean `302`, and the scope is only validated
one hop later at `/oauth/authorize/continue`, which redirects back to the client
with `error=invalid_scope`. The connector surfaces that as the generic
_"Authorization with Flash Evals failed. You can check your credentials and
permissions."_ — so it reads like a credential problem when nothing is wrong
with the credentials.

Check which scopes an application actually permits without touching the
dashboard. `client_id` here is any OAuth application registered on the instance
together with one of its registered redirect URIs — the pair only has to be valid
enough to reach scope validation, and neither needs to be the client you are
debugging:

```bash
for s in openid profile email public_metadata private_metadata offline_access; do
  printf '%s -> ' "$s"
  curl -s -o /dev/null -D - "https://<your-clerk-host>/oauth/authorize/continue?client_id=<CLERK_OAUTH_CLIENT_ID>&code_challenge=x&code_challenge_method=S256&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&response_type=code&scope=$s&state=p" \
    | grep -i '^location' | grep -q invalid_scope && echo "NOT ALLOWED" || echo "allowed"
done
```

**4. `MOSAIC_MCP_ALLOWED_ORIGINS` must include the client's origin.**

```bash
MOSAIC_MCP_ALLOWED_ORIGINS=https://claude.ai,https://claude.com
```

`assertMcpOrigin` in `apps/api/src/mcp/http.ts` returns early when a request
sends no `Origin` header, but rejects any origin not on the list — and an unset
variable parses to an empty list, so **every** browser-originated request is
refused with `403 Origin is not allowed for MCP.` before authentication runs.
A `curl` without an `Origin` header will not reproduce it.

### Verifying

```bash
# 403 => the origin allowlist is wrong; 401 => allowlist fine, token rejected as expected
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<your-api-host>/mcp \
  -H 'Origin: https://claude.ai' -H 'Authorization: Bearer bogus' \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

A working connection shows `POST /mcp 200` in the API's HTTP request logs. On
Railway that is `railway logs --http`; plain `railway logs` shows build and
deploy output only. Finally, ask the agent to call `get_current_user`: a connected
connector whose Clerk identity has never signed in to the Flash Evals web app returns
`Flash Evals account is not linked for this Clerk user.`, because the MCP path only
reads `users.clerk_user_id` and never provisions it.

## Deployed Clerk OAuth Setup

1. Configure a Clerk OAuth application for the MCP client.
   Register the redirect URI required by the client you are testing, for example MCP Inspector commonly uses:

```text
http://localhost:6274/oauth/callback
http://localhost:6274/oauth/callback/debug
```

2. Set API service env vars:

```bash
MOSAIC_MCP_ENABLED=true
MOSAIC_MCP_RESOURCE_URL=https://<your-api-host>/mcp
MOSAIC_MCP_ALLOWED_ORIGINS=https://your-mcp-client.example
MOSAIC_MCP_OAUTH_CLIENT_ID=<clerk-oauth-client-id>
CLERK_ISSUER=https://<clerk-instance>.clerk.accounts.dev
CLERK_SECRET_KEY=<clerk-secret-key>
CLERK_PUBLISHABLE_KEY=<clerk-publishable-key>
CLERK_JWT_KEY=<clerk-jwt-public-key>
```

Use `MOSAIC_MCP_OAUTH_DYNAMIC_CLIENTS=true` only if the target MCP client requires dynamic client IDs.
In production, `MOSAIC_MCP_RESOURCE_URL` must use `https`.

3. Smoke discovery:

```bash
curl -i https://<your-api-host>/.well-known/oauth-protected-resource/mcp
curl -i https://<your-api-host>/mcp
```

Expected results:

- The metadata endpoint returns `resource`, `authorization_servers`, and `bearer_methods_supported`.
- Unauthenticated `/mcp` returns `401` with `WWW-Authenticate: Bearer resource_metadata="..."`.
- After the MCP client completes Clerk OAuth, `initialize` and `tools/list` succeed.

## Local Raw Token Fallback

Use this only for local development or emergency operator testing.
Enable it explicitly:

```bash
MOSAIC_MCP_ENABLED=true
MOSAIC_MCP_RAW_TOKEN_FALLBACK_ENABLED=true
MOSAIC_MCP_TOKEN_PEPPER=<secret-pepper>
```

Create a token:

```bash
pnpm --filter @mosaic/api mcp:token:create -- --email teammate@example.com --name "Local MCP"
```

Revoke a token:

```bash
pnpm --filter @mosaic/api mcp:token:revoke -- --token mcp_...
```

For local Codex testing, prefer the stdio entrypoint so Codex launches the MCP
server directly instead of reaching through localhost networking:

```bash
MOSAIC_MCP_LOCAL_TOKEN=mcp_... pnpm --filter @mosaic/api mcp:stdio
```

The stdio entrypoint uses the same raw-token principal resolution as local HTTP
fallback and requires `MOSAIC_MCP_RAW_TOKEN_FALLBACK_ENABLED=true`.

## Tools

The server exposes 62 tools — datasets (21), prompts (12), workflows (12), runs
(8), context and projects (5), and settings (4) — plus 4 resources and 1 prompt.
The registry snapshot test is the executable inventory check; a separate
live smoke script is intentionally not duplicated because HTTP authentication
and `tools/list` transport behavior are already covered by the MCP HTTP tests.

Context and projects:

- `get_current_user` returns the authenticated Flash Evals user/team.
- `list_eval_context` returns datasets, runnable prompt versions, judge prompts, and available model options.
- `list_projects` and `create_project` inspect and create projects in the authenticated workspace.
- `get_dashboard` returns project statistics and recent runs.

Datasets:

- `list_datasets` and `get_dataset` inspect datasets.
- `create_dataset` creates a golden or evaluation audio, image, or text dataset.
- `add_dataset_item` and `update_dataset_item` manage individual items; add accepts base64 image or audio content.
- `delete_dataset_item` and `delete_dataset_label` remove items or labels.
- `rename_dataset`, `update_dataset_description`, `set_dataset_archived`, `duplicate_dataset`, and `delete_dataset` manage the dataset lifecycle.
- `import_dataset_images` uploads base64 image files into an image dataset.
- `import_dataset_audio` uploads base64 audio files into an audio dataset.
- `import_dataset_text_items` imports CSV or JSONL text rows.
- `import_dataset_image_answers` uploads image files plus CSV or JSONL answer rows for freeform golden image datasets.
- `import_dataset_audio_answers` uploads audio files plus CSV or JSONL golden transcripts.
- `import_dataset_golden_answers` attaches answers to existing golden dataset items.
- `import_dataset_paired_items` imports images plus CSV rows where each row names an image file and provides structured golden-answer fields. This is the spreadsheet-plus-image workflow for image datasets with an answer schema.

Prompts and research:

- `list_prompts` and `get_prompt` inspect prompts.
- `generate_schema_from_prompt` proposes a structured JSON schema from a prompt draft.
- `test_prompt_draft` runs a draft prompt on samples.
- `validate_runnable_prompt` validates schema and sample behavior before saving.
- `create_runnable_prompt` validates the supplied prompt samples server-side, then creates or updates a runnable eval prompt version only when validation passes.
- `optimize_prompt` researches and proposes a better prompt draft.
- `test_judge_draft` tests a judge prompt against candidate output.
- `create_judge_prompt` creates a runnable judge prompt directly.
- `generate_judge_for_run` creates a run-level judge rubric from a runnable prompt version and dataset.
- `duplicate_prompt_version` creates a new prompt from an existing structured version.
- `delete_prompt` permanently removes an unused prompt.

Runs and review:

- `create_eval_run` creates and queues an eval run.
- `list_runs`, `get_run`, and `get_run_progress` inspect runs and progress.
- `retry_run` retries failed work and queues the run again.
- `delete_run` permanently removes a run and its results.
- `save_run_note` saves the run note.
- `annotate_run_cell` saves cell-level review verdicts and comments.

Provider settings:

- `list_provider_keys` reports configured/unconfigured status without key material.
- `set_provider_key` configures a provider secret without returning or logging it.
- `clear_provider_key` removes a provider secret.

Workflows:

- `list_workflows` and `get_workflow` inspect workflow graphs.
- `create_workflow`, `update_workflow`, and `delete_workflow` manage validated workflow DAGs.
- `create_workflow_run` creates and queues a workflow run.
- `list_workflow_runs`, `get_workflow_run`, and `get_workflow_run_progress` inspect workflow runs.

### Destructive-tool confirmation

Deletion, archive, and provider-key removal tools require an explicit
`confirm: true` input and advertise MCP `destructiveHint` annotations. Inspect
the target with its corresponding `get_*` or `list_*` tool before confirming.

## Resources

- `mosaic://datasets/{id}`
- `mosaic://prompts/{id}`
- `mosaic://runs/{id}`
- `mosaic://models`

## MCP Prompt

`create_eval_happy_path` gives MCP clients the intended end-to-end sequence:

1. Call `get_current_user` and `list_eval_context`.
2. Create or select a dataset.
3. Import text, images, audio, golden answers/transcripts, or paired image/spreadsheet rows.
4. Generate or provide a prompt schema.
5. Test and validate the prompt draft.
6. Create a runnable prompt.
7. Create an eval run.
8. Poll progress and inspect results.
9. Save notes and annotate cells during review.

For multi-step prompt graphs, create or select a workflow, call
`create_workflow_run`, then poll `get_workflow_run_progress` and inspect
`get_workflow_run`. Destructive cleanup requires `confirm: true`.
