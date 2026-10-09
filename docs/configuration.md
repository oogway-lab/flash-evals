# Configuration

[Documentation home](../README.md#documentation) · [Getting started](getting-started.md)

For a fresh local instance, use `pnpm run setup:local`. It creates a small,
working configuration without Clerk or Supabase. For other environments, use the
commented reference files to understand the available settings:

- [`apps/api/.env.example`](../apps/api/.env.example): API, worker, database,
  storage, provider keys, limits, and MCP.
- [`apps/web/.env.example`](../apps/web/.env.example): web app, browser-facing
  URLs, Clerk, and local authentication overrides.

These are references with placeholder values, not production credentials or a
complete deployment recipe. Restart affected processes after changing settings.
`NEXT_PUBLIC_*` values may be embedded in browser bundles, so changing them in a
built deployment can require a web rebuild. Never put secrets in those variables.

## How environment files are loaded

| Command                                    | Environment files                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `pnpm run api:dev` or `pnpm run api:start` | `apps/api/.env`                                                                   |
| `pnpm --filter @mosaic/web dev`            | Next.js environment loading from `apps/web`                                       |
| `pnpm run worker`                          | `apps/api/.env`, then `apps/web/.env`                                             |
| `pnpm run db:migrate` or `pnpm run seed`   | `apps/api/.env`, then `apps/web/.env`                                             |
| `pnpm run dev`                             | The files above, plus explicit local overrides                                    |
| `pnpm run api:start:railway`               | Process environment; starts API and worker unless `MOSAIC_API_START_WORKER=false` |

Existing process environment variables override values read from files. For the
worker and database commands, later env-file values override earlier file values;
avoid duplicating API settings in the web file. Next.js also recognizes its own
`.env.local` and environment-specific files, which can override `.env` values.

The combined development command supplies local API URLs, web CORS, and the
seeded user/team IDs. It enables `MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS` on the API
and `AUTH_DEV=true` plus `AUTH_DEV_ALLOW_INSECURE=1` on the web app and worker.
Separate process commands do not supply those overrides. Prefer the combined
command for the local walkthrough.

## Database and service URLs

| Setting                    | Where              | Purpose                                                                |
| -------------------------- | ------------------ | ---------------------------------------------------------------------- |
| `DATABASE_URL`             | API and worker     | PostgreSQL connection. The bundled local service uses host port 54322. |
| `INTERNAL_API_TOKEN`       | API and web server | Shared secret for privileged web-to-API requests. Values must match.   |
| `API_BASE_URL`             | Web server         | Server-side API origin.                                                |
| `NEXT_PUBLIC_API_BASE_URL` | Web                | Browser-facing API origin; not a secret.                               |
| `MOSAIC_API_PUBLIC_URL`    | API                | Public API origin used for absolute local-upload URLs.                 |
| `CORS_ORIGINS`             | API                | Comma-separated permitted web origins. MCP has a separate allowlist.   |

The worker needs database and provider access. It does not execute jobs through
the web server. An API health response alone does not verify that a worker is
running or can call a provider.

## Model providers

The local setup selects `MOSAIC_LLM_PROVIDER=openrouter` and leaves its key blank.
Add a real key only when you are ready to send inputs to that provider:

| Transport         | Main settings                                                                          |
| ----------------- | -------------------------------------------------------------------------------------- |
| OpenRouter        | `MOSAIC_LLM_PROVIDER=openrouter`, `OPENROUTER_API_KEY`; optional `OPENROUTER_BASE_URL` |
| OpenAI            | `MOSAIC_LLM_PROVIDER=openai`, `OPENAI_API_KEY`                                         |
| Vercel AI Gateway | `MOSAIC_LLM_PROVIDER=gateway`, `AI_GATEWAY_API_KEY`                                    |
| Bifrost           | `MOSAIC_LLM_PROVIDER=bifrost`, `BIFROST_API_KEY`, `BIFROST_BASE_URL`                   |

Use model IDs and supported capabilities returned by the app for the chosen
transport. A name that works with one provider may not be valid with another.
`PROMPT_OPTIMIZER_MODEL` selects the model for prompt optimization, schema
creation, and run judge generation; keep its API and web values consistent.

Workflow model routing is explicit: a provider credential makes a transport
available, while a saved route selects the model and execution settings. A node
can use a pinned route version or a project default resolved when the run starts.
`MOSAIC_LLM_PROVIDER` does not override those workflow route snapshots. See
[model-routing concepts](../CONCEPTS.md#explicit-workflow-llm-routing).

Team-managed provider keys saved through the app or MCP are encrypted with
`MOSAIC_SECRETS_ENC_KEY`, a base64-encoded 32-byte key. Every API and worker must
use the same value. Keep it with your protected backups; replacing it without a
migration prevents existing encrypted provider credentials from being read.

For audio, provider support varies by route and configuration. See
[STT evaluations](stt-evaluations.md). Capability probes make real provider
requests using synthetic non-speech audio; they check request compatibility,
not transcription quality.

## Storage

`MOSAIC_STORAGE_ADAPTER=local` stores uploaded objects on disk, normally in
`.uploads` at the repository root. `UPLOAD_DIR` overrides that directory. The API
and worker need access to the same files. Keep `MOSAIC_API_PUBLIC_URL` reachable
from your browser for uploads. Local storage is refused in production.

The Supabase adapter uses `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
`SUPABASE_STORAGE_BUCKET`; the bucket must remain private. Set
`MOSAIC_CSP_STORAGE_ORIGIN` on the web build to the relevant storage origin when
restricting browser uploads. Do not expose the service-role key to browser code.

## Authentication and tenancy

Local development bypasses web sign-in only when `AUTH_DEV=true` and
`AUTH_DEV_ALLOW_INSECURE=1`, with valid default user/team IDs. The root development
command supplies the seeded IDs. The web bypass is ignored in production, and
the API rejects `MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS=true` in production.

For authenticated deployments, configure Clerk and keep tenancy settings aligned
between API and web:

- `MOSAIC_TENANCY_MODE=single-org`: verified accounts on
  `MOSAIC_ALLOWED_EMAIL_DOMAIN` share the configured team and its data. The API
  rejects common public email domains unless `MOSAIC_ALLOW_PUBLIC_EMAIL_DOMAIN`
  explicitly permits them; allowing one means unrelated people on that domain
  could join the shared team.
- `MOSAIC_TENANCY_MODE=isolated`: each new account receives a private team.
  Invitations and sharing with other accounts are not currently supported. If
  `MOSAIC_ALLOWED_EMAIL_DOMAIN` is set, it restricts sign-in in this mode too.

For the Oogway Labs internal pilot, configure
`MOSAIC_TENANCY_MODE=single-org` and set `MOSAIC_ALLOWED_EMAIL_DOMAIN=oogwaylabs.com`
in both API and web environments. The app checks the current verified primary
email at sign-in and on each web session refresh, so a changed or unverified
address cannot keep an existing account active. MCP OAuth also checks the live
Clerk identity on every request. Email matching is case-insensitive and requires
the domain to be exactly `oogwaylabs.com`; subdomains, suffix matches, and
malformed addresses are rejected.

MCP has separate authentication. See [the MCP guide](mcp-eval-server.md) for
local tokens, production OAuth, and `MOSAIC_MCP_ALLOWED_ORIGINS`.

## Limits and worker settings

| Variable                            | Default                          | Meaning                                                                                        |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `MOSAIC_MAX_RUN_CELLS`              | 10000; maximum 16000             | Caps items × models, or items × workflow nodes, for a run.                                     |
| `MOSAIC_TEAM_DAILY_SPEND_CAP_USD`   | Off                              | Refuses new runs after recorded spend for runs started in the last 24 hours reaches the limit. |
| `MOSAIC_RATE_LIMIT_LLM_PER_MINUTE`  | 20                               | Per-user limit for cost-bearing setup tools such as prompt tests, validation, and probes.      |
| `MOSAIC_RATE_LIMIT_RUNS_PER_MINUTE` | 10                               | Per-user limit for run creation and retries, including matching MCP tools.                     |
| `EVAL_CONCURRENCY`                  | 5 for eval runs; 4 for workflows | Parallel cells within a run; minimum 1.                                                        |
| `RUN_STALE_CLAIM_MS`                | 900000                           | Reclaim timeout for interrupted eval cells; minimum 60000.                                     |
| `WORKFLOW_STALE_CLAIM_MS`           | 900000                           | Reclaim timeout for interrupted workflow cells; minimum 60000.                                 |

Set a rate limit to `0` only when you intentionally want it disabled. Spend
checks use recorded costs and do not reserve funds for in-flight work. Treat
them as safeguards, not a guarantee against exceeding a provider budget.

## Workflow model-routing rollout

`MOSAIC_WORKFLOW_LLM_WRITES_ENABLED` gates route/default/capability writes and
routed workflow-run creation. Its default is `true` outside production and
`false` in production. The local setup enables it with
`MOSAIC_WORKFLOW_LLM_WORKER_CONTRACT_VERSION=1`.

For a deployment, enable writes only after the API and every worker run a
compatible revision and the worker contract version matches. This is deployment
configuration, not a `MOSAIC_FLAG_*` feature flag checked by
`pnpm run quality:flags`.

## Before exposing an instance

The public source release does not include a complete hosted-deployment guide.
At minimum, use real authentication, disable every local bypass, choose the
intended tenancy policy, keep storage private, configure HTTPS and exact origins,
and keep secrets only in server environments. Back up the database, objects, and
encryption key together. Read the [security policy](../SECURITY.md).

## Development, test, and script variables

| Variable                                  | Read by                                   | Purpose                                                                                                                                                                                     |
| ----------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MOSAIC_DEV_API_PORT`                     | `scripts/dev.mjs`                         | API port for `pnpm run dev` (default `3001`). `PORT` is not used, because `next dev` reads it for web.                                                                                      |
| `MOSAIC_PACKAGES_BUILT`                   | `scripts/build-packages.mjs`              | Set to `1` by `pnpm run dev` after it builds the shared packages once, so the API, web and worker it starts skip rebuilding them.                                                           |
| `NODE_EXTRA_CA_CERTS`                     | `scripts/node-with-supabase-ca.mjs`       | Extra CA bundle for Node. Defaults to the bundled Supabase root CA (`apps/web/config/supabase-root-2021-ca.pem`).                                                                           |
| `MOSAIC_IMAGE_STORAGE_ADAPTER`            | API config, web storage                   | Legacy alias for `MOSAIC_STORAGE_ADAPTER`, used only when the new name is unset.                                                                                                            |
| `UPLOAD_DIR`                              | API, web storage, worker                  | Directory for the `local` storage adapter (default `.uploads` at the repo root). Local development only: the split-deploy check (`pnpm run deploy:check`) rejects it in deployed env files. |
| `STT_SMOKE_AUDIO_PATH`                    | `scripts/smoke-stt-capabilities.mjs`      | Audio file for `pnpm run smoke:stt` (default `/tmp/flash-evals-stt-smoke.wav`).                                                                                                             |
| `STT_SMOKE_PROVIDERS`                     | `scripts/smoke-stt-capabilities.mjs`      | Comma-separated providers to probe (default `openai,gateway,soniox`).                                                                                                                       |
| `STT_SMOKE_OPENAI_MODEL`                  | `scripts/smoke-stt-capabilities.mjs`      | OpenAI transcription model (default `gpt-4o-mini-transcribe`).                                                                                                                              |
| `STT_SMOKE_GATEWAY_MODELS`                | `scripts/smoke-stt-capabilities.mjs`      | Gateway models to probe (default `openai/whisper-1,openai/gpt-4o-transcribe,openai/gpt-4o-mini-transcribe`).                                                                                |
| `STT_SMOKE_SONIOX_MODEL`                  | `scripts/smoke-stt-capabilities.mjs`      | Soniox model (default `stt-async-v5`).                                                                                                                                                      |
| `MOSAIC_ROUTING_INTEGRATION_DATABASE_URL` | `routing.persistence.integration.test.ts` | Postgres URL for the routing concurrency integration test; the test is skipped when unset. It creates and drops its own schema.                                                             |
| `PLAYWRIGHT_WEB_BASE_URL`                 | `playwright.config.ts`                    | Run the e2e suite against an existing web server instead of starting one.                                                                                                                   |
| `PLAYWRIGHT_WEB_PORT`                     | `playwright.config.ts`                    | Port for the web server Playwright starts (default `3000`).                                                                                                                                 |
| `PLAYWRIGHT_FAKE_API_PORT`                | `playwright.config.ts`                    | Port for the fake API used by the e2e fixtures (default `3101`).                                                                                                                            |
| `PLAYWRIGHT_API_BASE_URL`                 | `tests/e2e/api-health.spec.ts`            | API base URL for the API health smoke test; the test is skipped when unset. Set `INTERNAL_API_TOKEN` too to check the detailed `/health` payload; without it the test checks status only.   |

`MOSAIC_TEST_DATABASE_URL` enables the real-PostgreSQL workflow-editing integration
test. Use only a disposable, migrated database: the test leaves immutable
synthetic routing history behind. See [the contributor test instructions](../CONTRIBUTING.md#real-database-workflow-concurrency-tests).

`NODE_ENV`, `CI` and `NEXT_PHASE` are also read, with their usual meanings.
`WORKERS_CI` is set to `1` by Cloudflare Workers Builds; the web build then
fails when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is missing (see
`apps/web/config/security-headers.mjs`).
