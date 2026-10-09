# Configuration

Flash Evals is configured with environment variables. The two example files document
every setting an operator is expected to change:

- [`apps/api/.env.example`](../apps/api/.env.example): API, eval worker,
  storage, provider keys, limits, MCP.
- [`apps/web/.env.example`](../apps/web/.env.example): web app, Clerk browser
  keys, local auth bypass, timing logs.

For which variables belong on which deployed service, see the env tables in
[`deployment/cloudflare-railway-supabase.md`](./deployment/cloudflare-railway-supabase.md).

`pnpm run docs:env` (part of `pnpm run quality` and CI) fails when code reads a
variable that is not listed in an env example or on this page.

This page covers how the files are loaded and the variables that are not in
either example because they only matter for development, tests, or scripts.

## How env files are loaded

| Process                                                     | Loads                                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| API (`pnpm run api:dev`, `pnpm --filter @mosaic/api start`) | `apps/api/.env`                                                                                |
| Web (`pnpm --filter @mosaic/web dev`)                       | `apps/web/.env` (Next.js conventions)                                                          |
| Eval worker (`pnpm run worker`)                             | `apps/api/.env`, then `apps/web/.env`                                                          |
| `pnpm run dev`                                              | All three, plus local-only overrides from `scripts/dev.mjs` (see below)                        |
| `pnpm --filter @mosaic/api start:railway`                   | Process environment only; starts the API and the worker unless `MOSAIC_API_START_WORKER=false` |

Because the worker reads `apps/api/.env`, worker settings such as
`EVAL_CONCURRENCY`, the stale-claim timeouts, provider keys and
`MOSAIC_STORAGE_ADAPTER` live in the API example.

`pnpm run dev` sets, for local use only: `MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS=true`
and `CORS_ORIGINS` on the API, and `AUTH_DEV=true`, `AUTH_DEV_ALLOW_INSECURE=1`
and the seeded `MOSAIC_DEFAULT_TEAM_ID`/`MOSAIC_DEFAULT_USER_ID` on the web app and
worker.

## Workflow LLM writes gate

`MOSAIC_WORKFLOW_LLM_WRITES_ENABLED` is deployment configuration, not a feature
flag, so it is not in the `MOSAIC_FLAG_*` manifests that
`pnpm run quality:flags` checks. It gates route, default and capability writes
and routed Workflow run creation while a new routing revision rolls out. It
defaults to `true` outside production and `false` in production; turn it on in
production only after the API and every worker run the same revision, together
with `MOSAIC_WORKFLOW_LLM_WORKER_CONTRACT_VERSION`.

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

`NODE_ENV`, `CI` and `NEXT_PHASE` are also read, with their usual meanings.
`WORKERS_CI` is set to `1` by Cloudflare Workers Builds; the web build then
fails when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is missing (see
`apps/web/config/security-headers.mjs`).
