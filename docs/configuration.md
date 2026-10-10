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
| `pnpm run db:bootstrap-pilot-team`         | `apps/api/.env` only                                                              |
| `pnpm run dev`                             | The files above, plus explicit local overrides                                    |
| `pnpm run api:start:railway`               | Process environment; starts API and worker unless `MOSAIC_API_START_WORKER=false` |

Existing process environment variables override values read from files. For the
worker and database commands, later env-file values override earlier file values;
avoid duplicating API settings in the web file. Next.js also recognizes its own
`.env.local` and environment-specific files, which can override `.env` values.

The pilot team bootstrap deliberately loads only `apps/api/.env`, so
`MOSAIC_DEFAULT_TEAM_ID` and `MOSAIC_DEFAULT_TEAM_NAME` come from the API
environment and cannot be shadowed by blank or conflicting values in
`apps/web/.env`. Values already present in the process environment still take
precedence over the API env file.

The combined development command supplies local API URLs, web CORS, and the
seeded user/team IDs. It enables `MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS` on the API
and `AUTH_DEV=true` plus `AUTH_DEV_ALLOW_INSECURE=1` on the web app and worker.
Separate process commands do not supply those overrides. Prefer the combined
command for the local walkthrough.

## Database and service URLs

| Setting                    | Where              | Purpose                                                                                                                                                      |
| -------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`             | API and worker     | PostgreSQL connection. The bundled local service uses host port 54322.                                                                                       |
| `MOSAIC_WEB_DATABASE_URL`  | Local web server   | PostgreSQL connection for local Next.js development; may use the same local URL as `DATABASE_URL`. Deployed Cloudflare Workers use the `HYPERDRIVE` binding. |
| `MOSAIC_DEFAULT_TEAM_ID`   | Pilot bootstrap    | UUID for the single pilot team created by `pnpm run db:bootstrap-pilot-team`.                                                                                |
| `MOSAIC_DEFAULT_TEAM_NAME` | Pilot bootstrap    | Name for that team; optional, defaults to `Oogway Labs`.                                                                                                     |
| `INTERNAL_API_TOKEN`       | API and web server | Shared secret for privileged web-to-API requests. Values must match.                                                                                         |
| `API_BASE_URL`             | Web server         | Server-side API origin.                                                                                                                                      |
| `NEXT_PUBLIC_API_BASE_URL` | Web                | Browser-facing API origin; not a secret.                                                                                                                     |
| `MOSAIC_API_PUBLIC_URL`    | API                | Public API origin used for absolute local-upload URLs.                                                                                                       |
| `CORS_ORIGINS`             | API                | Comma-separated permitted web origins. MCP has a separate allowlist.                                                                                         |

The worker needs database and provider access. It does not execute jobs through
the web server. An API health response alone does not verify that a worker is
running or can call a provider. Use the private `pnpm worker:status` command and
the process supervisor; see the [worker operations runbook](worker-operations.md).

The deployed Cloudflare web Worker requires a `HYPERDRIVE` binding. Cloudflare's
Supabase guide recommends Hyperdrive's direct database endpoint because
Hyperdrive supplies the connection pool; do not stack Supabase's transaction
pooler behind it. For this project, use host
`db.lafifzbgsqtqbftyexyh.supabase.co`, port `5432`, database `postgres`, and the
Supabase database user. Use Hyperdrive TLS mode `verify-full` with the
region-specific CA in
[`apps/web/config/supabase-root-2021-ca.pem`](../apps/web/config/supabase-root-2021-ca.pem),
and disable Hyperdrive query caching because this application depends on fresh
authorization, settings, and read-after-write results. The Worker connects to
Hyperdrive's `connectionString`; Hyperdrive validates the origin certificate.
The Worker does not attempt to configure TLS on its local socket to Hyperdrive.

The repository CA file contains one certificate, subject/issuer
`Supabase Root 2021 CA`, SHA-256 fingerprint
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
A credential-free PostgreSQL STARTTLS check to the project's direct endpoint
verified this CA and the endpoint hostname. Cloudflare's Hyperdrive TLS guide
requires a region-specific CA certificate and offers `verify-full`; upload this
file as a CA certificate, then select it when creating the Hyperdrive config.
Never put the Supabase password in Wrangler config or source control. The
Hyperdrive configuration is a Cloudflare resource and its ID is needed for the
Worker binding.

For the first setup, upload the public CA certificate from the repository while
in `apps/web`:

```sh
pnpm exec wrangler cert upload certificate-authority \
  --ca-cert config/supabase-root-2021-ca.pem \
  --name flash-evals-supabase-ca
```

In the Cloudflare dashboard, create a cache-disabled Hyperdrive config named
`flash-evals-web` for the Supabase direct endpoint. Enter the database
credentials there, select the uploaded CA, set TLS mode to `verify-full`, and
disable query caching. The resource is bound only to the `flash-evals` Worker in
`apps/web/wrangler.jsonc`:

```jsonc
"hyperdrive": [
    { "binding": "HYPERDRIVE", "id": "9188f447e0c44054aee09df7465f0f6f" }
]
```

The Worker creates a request-scoped `pg` pool (`max: 1`, `maxUses: 1`);
Hyperdrive manages and pools upstream database connections. The pinned `pg`
version is 8.23.1, above Cloudflare's 8.16.3 minimum. The Node runtime keeps its
existing bounded pool and `MOSAIC_WEB_DATABASE_URL`/`DATABASE_URL` selection.
For local `next dev`, set `MOSAIC_WEB_DATABASE_URL` in `apps/web/.env`; it may
use the same local PostgreSQL URI as `DATABASE_URL`. In a Worker request,
missing `HYPERDRIVE` fails closed even if a legacy database URL remains in the
environment.

The Cloudflare Worker sets `MOSAIC_DEFAULT_TEAM_ID` to the bootstrapped pilot
team `64b8c0bb-4e39-469b-be96-00b0071251ef`, matching the API's single-org
configuration. Keep the exact Next.js `16.3.8` pin in `apps/web/package.json`
until the Cloudflare adapter supports Next.js 16.4's `preview-props.json`
manifest. Next.js 16.4 requests that manifest through
`loadManifest(/.next/server/preview-props.json)`, which currently throws
`Unexpected loadManifest(/.next/server/preview-props.json) call!` in the
Cloudflare Worker. The 16.3.8 pin avoids that unsupported manifest request.
See [upstream issue #1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355).

Hyperdrive is included in Cloudflare Workers Free and Paid plans. The Free plan
allows 100,000 database statements per day; the allowance resets daily at
00:00 UTC and requests over the limit fail. Paid Workers plans list unlimited
queries, with Hyperdrive pooling and caching included. This pilot disables
caching, but statements still count against the query allowance.

Keep the Railway API and worker on their separate `DATABASE_URL` session-pooler
URI (port 5432 for that deployment).

Before running `pnpm run db:migrate` against the pilot database, verify that it
is a newly created empty Supabase project and contains no application data.
Migration `0037_backfill_personal_workspaces.sql` runs
`TRUNCATE TABLE "teams" CASCADE`, which removes team-owned application rows. Do
not apply that migration to an existing or unverified database. The CI migration
job applies the migration set only to its fresh, disposable PostgreSQL service.

Once the database is confirmed empty and the reviewed migrations have been
applied, `pnpm run db:bootstrap-pilot-team` creates the configured
`MOSAIC_DEFAULT_TEAM_ID` team only when the `teams` table is empty. It is
idempotent for the same team ID and name and refuses a populated table with a
different team. This command does not run or reset migrations. Do not use
`pnpm run seed` on a hosted database; that command truncates application tables.

References: [Cloudflare's Hyperdrive Supabase guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/),
[Hyperdrive TLS certificate guide](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/),
[Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/),
[Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/),
[Cloudflare's `pg` guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/),
[OpenNext's database guide](https://opennext.js.org/cloudflare/howtos/db), and
[Supabase's connection and SSL guide](https://supabase.com/docs/guides/database/connecting-to-postgres#ssl).

For a split Railway topology, configure the API service with
`pnpm run api:start:railway` and `MOSAIC_API_START_WORKER=false`; configure a
separate worker service with `pnpm run worker` and no HTTP health check. The
worker's process supervisor and `worker.ready` event establish liveness. The
repository readiness scripts validate supported package commands and the API
flag, but the actual start and healthcheck settings are per-service Railway
settings and must be checked there. Railway has deprecated `railway.json` and
`railway.toml`: new services cannot opt in, and existing services can use these
files until the 2026-12-01 cutoff. See [Railway Config as Code](https://docs.railway.com/config-as-code)
for current configuration options.

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
The web server also needs those three Supabase storage variables when that
adapter is selected; the service-role key stays server-side.

The `r2` adapter uses Cloudflare R2's S3 API through the AWS SDK for JavaScript
v3. Set `MOSAIC_STORAGE_ADAPTER=r2` and provide `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` in the API and web
server environments. Set the same `R2_STORAGE_PREFIX` in both when using an
application namespace. The web server and Railway job worker use these settings
to read/write media; the API uses them to sign uploads, verify objects, serve
tenant-checked images, and delete media. Do not put R2 credentials in
`NEXT_PUBLIC_*` variables. Keep the bucket private; the browser receives only a
10-minute, object-specific upload URL signed for the declared content type and
byte length.

Browser PUTs also need `MOSAIC_CSP_STORAGE_ORIGIN` set at web build time to the
exact signed URL origin, `https://<bucket>.<account-id>.r2.cloudflarestorage.com`.
The R2 bucket's later CORS policy must allow the exact deployed web origin, the
`PUT` method, and the `Content-Type` and `If-None-Match` request headers. The
upload URL requires `If-None-Match: *`, which makes the random object key
create-only while the short-lived bearer URL remains valid. Its signed
`Content-Length` must match the browser file size, and the API verifies the
stored size and media signature before linking it. Treat signed URLs as
credentials and keep them out of logs. R2 requests time out after 15 seconds
(5 seconds for the API health check). The app does not need public bucket
access for downloads; image reads pass through the API's team/project
authorization check. `R2_ENDPOINT` is reserved for loopback
S3-compatible tests and is rejected outside `localhost`, `127.0.0.1`, or `::1`
and in production.

`pnpm run deploy:check` validates the selected storage adapter in
`apps/api/.env` and `apps/web/.env`, requires that adapter's credentials, and
checks that adapters, bucket/project, and storage prefixes match. It verifies
that `MOSAIC_CSP_STORAGE_ORIGIN` matches the selected endpoint. R2 deployments
do not need Supabase storage variables. Local storage, local-only R2 endpoints,
and insecure development bypass settings fail this deployment check.

`pnpm run deploy:check:live` reads variables for separate Railway API and worker
services with `railway variable list`. Set `RAILWAY_PROJECT_ID`,
`RAILWAY_API_SERVICE`, and `RAILWAY_WORKER_SERVICE`; the service names must be
distinct. Set `CLOUDFLARE_WEB_ENV` to a private, ignored dotenv file containing
the current Cloudflare web build/runtime settings used for the check, including
`MOSAIC_STORAGE_ADAPTER`, the selected backend's values, and
`MOSAIC_CSP_STORAGE_ORIGIN`. The script checks those values but does not fetch
Cloudflare variable values or inspect Railway's per-service start commands or
healthchecks. Railway output and diagnostics do not print credential values.
Never commit the Cloudflare env file.

An upload that reaches R2 but is abandoned or rejected before its database row
is created can remain as an unreferenced object. There is no automatic orphan
deletion. For manual cleanup, pause new uploads, wait for upload URLs and
in-flight imports to expire, take a paired database/object snapshot, and
compare exact candidate keys under the app prefix against `dataset_items`.
Review a dry-run manifest before deleting only individually confirmed
unreferenced keys. Do not apply lifecycle expiration to the live dataset prefix
or use recursive bucket/prefix deletion.

For object and PostgreSQL backup/restore operations, see
[storage recovery](storage-backup-restore.md). The documented procedure is an
operational plan; no hosted backup schedule or restore drill is configured by
this change.

## Authentication and tenancy

Clerk remains the application identity provider and MCP OAuth issuer. The
hosted Supabase baseline validation is complete; Supabase provides Postgres and
optional object storage in this setup. Supabase Auth and a separate OAuth
client are not prerequisites for the current Clerk-based configuration.

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
| `MOSAIC_WORKER_DRAIN_TIMEOUT_MS`    | 20000                            | Bounded SIGTERM/SIGINT drain window in ms; minimum 1000, maximum 300000.                       |

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
| `R2_ENDPOINT`                             | shared object-storage package             | Local S3-compatible test endpoint only; rejected when `NODE_ENV=production`.                                                                                                                |
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
