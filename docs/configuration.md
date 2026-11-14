# Configuration

[Documentation home](../README.md#documentation) · [Getting started](getting-started.md) · [Deployment guide](deployment.md)

For a fresh local instance, use `bun run setup:local`. It creates a small,
working configuration without Clerk or Supabase. It binds to loopback, selects
`isolated` tenancy for the synthetic account, and sets development guardrails of
50 cells per run and $2 in recorded daily team spend. It never changes existing
env files or initializes a database. `bun run setup:local -- --host <Tailscale IPv4>`
generates matching private remote URLs on a fresh checkout. Follow
[Getting started](getting-started.md) or [VM/remote access](remote-development.md).
For other environments, use the
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

| Command                                  | Environment files                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `bun run api:dev` or `bun run api:start` | `apps/api/.env`                                                                        |
| `bun run --filter @flash-evals/web dev`  | Next.js environment loading from `apps/web`                                            |
| `bun run worker`                         | `apps/api/.env`, then `apps/web/.env`                                                  |
| `bun run db:migrate` or `bun run seed`   | `apps/api/.env`, then `apps/web/.env`                                                  |
| `bun run db:bootstrap-pilot-team`        | `apps/api/.env` only                                                                   |
| `bun run dev`                            | The files above, plus explicit local overrides                                         |
| `bun run api:start:railway`              | Process environment; starts API and worker unless `FLASH_EVALS_API_START_WORKER=false` |

Existing process environment variables override values read from files. For the
worker and database commands, later env-file values override earlier file values;
avoid duplicating API settings in the web file. Next.js also recognizes its own
`.env.local` and environment-specific files, which can override `.env` values.

The pilot team bootstrap deliberately loads only `apps/api/.env`, so
`FLASH_EVALS_DEFAULT_TEAM_ID` and `FLASH_EVALS_DEFAULT_TEAM_NAME` come from the API
environment and cannot be shadowed by blank or conflicting values in
`apps/web/.env`. Values already present in the process environment still take
precedence over the API env file.

The combined development command supplies local API URLs, web CORS, and the
seeded user/team IDs. It enables `FLASH_EVALS_ALLOW_INSECURE_DEV_DEFAULTS` on the API
and `AUTH_DEV=true` plus `AUTH_DEV_ALLOW_INSECURE=1` on the web app and worker.
Separate process commands do not supply those overrides. Prefer the combined
command for the local walkthrough.

## Database and service URLs

| Setting                         | Where              | Purpose                                                                                                                                                      |
| ------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                  | API and worker     | PostgreSQL connection. The bundled local service uses host port 54322.                                                                                       |
| `FLASH_EVALS_WEB_DATABASE_URL`  | Local web server   | PostgreSQL connection for local Next.js development; may use the same local URL as `DATABASE_URL`. Deployed Cloudflare Workers use the `HYPERDRIVE` binding. |
| `FLASH_EVALS_DEFAULT_TEAM_ID`   | Pilot bootstrap    | UUID for the single pilot team created by `bun run db:bootstrap-pilot-team`.                                                                                 |
| `FLASH_EVALS_DEFAULT_TEAM_NAME` | Pilot bootstrap    | Name for that team; optional, defaults to `Oogway Labs`.                                                                                                     |
| `INTERNAL_API_TOKEN`            | API and web server | Shared secret for privileged web-to-API requests. Values must match.                                                                                         |
| `API_BASE_URL`                  | Web server         | Server-side API origin.                                                                                                                                      |
| `NEXT_PUBLIC_API_BASE_URL`      | Web                | Browser-facing API origin; not a secret.                                                                                                                     |
| `FLASH_EVALS_API_PUBLIC_URL`    | API                | Public API origin used for absolute local-upload URLs.                                                                                                       |
| `CORS_ORIGINS`                  | API                | Comma-separated permitted web origins. MCP has a separate allowlist.                                                                                         |

The worker needs database and provider access. It does not execute jobs through
the web server. An API health response alone does not verify that a worker is
running or can call a provider. Use the private `bun run worker:status` command and
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
bunx wrangler cert upload certificate-authority \
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
existing bounded pool and `FLASH_EVALS_WEB_DATABASE_URL`/`DATABASE_URL` selection.
For local `next dev`, set `FLASH_EVALS_WEB_DATABASE_URL` in `apps/web/.env`; it may
use the same local PostgreSQL URI as `DATABASE_URL`. In a Worker request,
missing `HYPERDRIVE` fails closed even if a legacy database URL remains in the
environment.

The Cloudflare Worker sets `FLASH_EVALS_DEFAULT_TEAM_ID` to the bootstrapped pilot
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

Before running `bun run db:migrate` against the pilot database, verify that it
is a newly created empty Supabase project and contains no application data.
Migration `0037_backfill_personal_workspaces.sql` runs
`TRUNCATE TABLE "teams" CASCADE`, which removes team-owned application rows. Do
not apply that migration to an existing or unverified database. The CI migration
job applies the migration set only to its fresh, disposable PostgreSQL service.

Once the database is confirmed empty and the reviewed migrations have been
applied, `bun run db:bootstrap-pilot-team` creates the configured
`FLASH_EVALS_DEFAULT_TEAM_ID` team only when the `teams` table is empty. It is
idempotent for the same team ID and name and refuses a populated table with a
different team. This command does not run or reset migrations. Do not use
`bun run seed` on a hosted database; that command truncates application tables.

References: [Cloudflare's Hyperdrive Supabase guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/),
[Hyperdrive TLS certificate guide](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/),
[Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/),
[Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/),
[Cloudflare's `pg` guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/),
[OpenNext's database guide](https://opennext.js.org/cloudflare/howtos/db), and
[Supabase's connection and SSL guide](https://supabase.com/docs/guides/database/connecting-to-postgres#ssl).

`.railway/railway.ts` (Railway Infrastructure as Code) selects Railpack for both
services and keeps the `@flash-evals/api` workspace build command. Keep the root
`packageManager` pin aligned with `bun.lock`; Railpack reads that field to select Bun
([Node package-manager detection](https://railpack.com/languages/node#package-managers)).
`railpack.json` also pins Node, because the API and worker run on Node and
Railpack may otherwise install only Bun for a Bun project.

The file declares the split Railway topology. The API starts with
`cd apps/api && NODE_ENV=production exec node ../../scripts/node-with-supabase-ca.mjs dist/railway.js`,
runs `bun run db:migrate && bun run db:bootstrap-pilot-team` before each deploy,
checks `/health` and needs `FLASH_EVALS_API_START_WORKER=false`. The separate
worker starts with
`cd apps/web && exec node ../../scripts/node-with-supabase-ca.mjs --import tsx scripts/worker.ts`
and has no HTTP health check. Both build from the repository root. The worker
runs the queue consumer through the Node TLS wrapper directly, with `exec`
replacing the launch shell. It avoids package-manager processes between Railway
and the worker; the wrapper isolates the child's process group so a group signal
is not delivered twice, forwards termination signals and waits for the worker to
drain. Shared packages are built during the image build, so this launch does not
rebuild them at startup. Both services allow 30 seconds for shutdown. If you
increase `FLASH_EVALS_WORKER_DRAIN_TIMEOUT_MS`, also increase the worker's
`drainingSeconds` above that window plus five seconds. The worker has no
migration or bootstrap command; those remain on the API. Keep the worker private
with no public domain. The worker's process supervisor and `worker.ready` event
establish liveness.

Railway does not read `.railway/` during deploys. Change these settings by
editing the file, reviewing `railway config plan --environment production`, and
then running `railway config apply --environment production`. Variables are
unmanaged, so plan and apply never touch service variables. A clean plan
("already up to date") confirms the services match the file; any other output
is drift or a pending change. The repository readiness scripts validate
supported package commands and the API flag, not Railway service settings. See
[Railway Infrastructure as Code](https://docs.railway.com/infrastructure-as-code)
and the [deployment guide](deployment.md#9-railway-api-and-separate-private-worker).

## Model providers

Provider keys come from `apps/api/.env` and `apps/web/.env`, or from keys saved
in Settings. `bun run dev` drops provider key variables exported in your own
shell (for example in `~/.zshrc`) before it starts the API, web app and
worker, so a personal key on your machine is never used or billed; it prints
which ones it dropped.

`OPENAI_CUSTOM_HEADERS` is never used by the app. The OpenAI SDK reads it from
the environment on its own and no client option turns that off, so llm-core
deletes it from the process environment before building an OpenAI client.

`FLASH_EVALS_LLM_PROVIDER` picks the provider each model starts on in the run
form; it can still be switched per model there. The local setup selects
`vercel-ai-gateway` (Vercel AI Gateway; `gateway` is the old name and still works) and leaves its key blank. Add a real key only
when you are ready to send inputs to that provider. Settings > Model
providers shows which providers have a key and whether it comes from `.env`
or Settings (a key saved in Settings wins); the Models page compares Vercel
and OpenRouter prices, and every run result names the provider that ran each
model.

| Transport         | Main settings                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------- |
| OpenRouter        | `FLASH_EVALS_LLM_PROVIDER=openrouter`, `OPENROUTER_API_KEY`; optional `OPENROUTER_BASE_URL` |
| OpenAI            | `FLASH_EVALS_LLM_PROVIDER=openai`, `OPENAI_API_KEY`                                         |
| Vercel AI Gateway | `FLASH_EVALS_LLM_PROVIDER=vercel-ai-gateway`, `AI_GATEWAY_API_KEY`                          |
| Bifrost           | `FLASH_EVALS_LLM_PROVIDER=bifrost`, `BIFROST_API_KEY`, `BIFROST_BASE_URL`                   |
| Anthropic         | Anthropic key saved in Settings only                                                        |
| Gemini API        | Gemini key saved in Settings only                                                           |

**Pipeline steps and `.env` keys.** Eval runs use every key above from
`.env`. A pipeline step uses a `.env` key only for **Vercel AI Gateway**
(`AI_GATEWAY_API_KEY`) and **Bifrost** (`BIFROST_API_KEY` and
`BIFROST_BASE_URL`), when no key for that provider is saved in Settings (a
saved key wins). OpenAI and OpenRouter steps need the key saved in Settings
(`WORKFLOW_ENV_KEYS` in `packages/api-contract/src/workflows.ts`). A step that
runs with a `.env` key records no key id (its routing details say "key from
the server's .env") and uses the `.env` key current when it runs; if it is no
longer set, the step fails and names the variable to set again. Saved routes
(Settings → LLM routing) record the Settings key they were checked with, so
they need a key saved in Settings.

Anthropic and the Gemini API are direct routes to the model's maker. Their keys
are read only from Settings, never from `.env` or your shell: a `GEMINI_API_KEY`
in `.env` still serves Gemini speech-to-text but not model runs. With a key
saved, the run form offers the maker's own API for the models whose direct IDs
the registry lists (`DIRECT_MAKER_MODELS` in
`packages/llm-core/src/models/registry.ts`):

| Model                 | Direct ID                | Route      |
| --------------------- | ------------------------ | ---------- |
| Claude Opus 5.5       | `claude-opus-5-5`        | Anthropic  |
| Claude Sonnet 5.5     | `claude-sonnet-5-5`      | Anthropic  |
| Claude Haiku 5.5      | `claude-haiku-5-5`       | Anthropic  |
| Claude Sonnet 4.6     | `claude-sonnet-4-6`      | Anthropic  |
| Gemini 3 Flash        | `gemini-3-flash-preview` | Gemini API |
| Gemini 3.5 Flash Lite | `gemini-3.5-flash-lite`  | Gemini API |
| Gemma 4 31B IT        | `gemma-4-31b-it`         | Gemini API |

Run cost uses the maker's list prices kept in the same table. Gemma on the
Gemini API has no paid price and is recorded at $0. A run's reasoning effort is
passed as Anthropic's `effort` (with adaptive thinking) or Gemini's thinking
level. Each answer records the maker ("anthropic" or "google") as the host that
served it. Data rules can't be checked on a direct call beyond who serves it:
a direct model runs under data rules only when the allowed hosts include its
maker and zero data retention and no-training are off.

Use model IDs and supported capabilities returned by the app for the chosen
transport. A name that works with one provider may not be valid with another.
`PROMPT_OPTIMIZER_MODEL` selects the model for prompt optimization, schema
creation, and run judge generation; keep its API and web values consistent.

Workflow model routing is explicit: a provider credential makes a transport
available, while a saved route selects the model and execution settings. A node
can use a pinned route version or a project default resolved when the run starts.
`FLASH_EVALS_LLM_PROVIDER` does not override those workflow route snapshots. See
[model-routing concepts](../CONCEPTS.md#explicit-workflow-llm-routing).

Pipeline (workflow) steps can use the same direct routes. Choose **Anthropic**
or **Gemini API** as a step's provider, in Simple mode or in a saved route,
once the key is saved in Settings; the Gemini API uses the saved Gemini key.
Their model list (capability discovery) comes from the table above, with no
request to the maker, and a step sends the direct ID with the Settings key.
The data-rule check is the same as for eval runs: such a step runs under data
rules only when the allowed hosts include its maker and retention and training
rules are off. See [Pipelines](pipelines.md#choose-a-steps-provider).

### Bifrost

Bifrost is an OpenAI-compatible gateway you run yourself. Save its key and
address in Settings (or `BIFROST_API_KEY` and `BIFROST_BASE_URL`). The
address works with or without a trailing `/v1` (`https://gateway.example.test`
and `https://gateway.example.test/v1` are the same); calls go to its `/v1`
API.

**Model IDs.** Bifrost names models by the provider it sends them to, for
example `openrouter/google/gemini-2.5-flash` or `gemini/gemini-2.5-flash`.
In a pipeline step's Simple mode, choosing **Bifrost** lists the models from
Bifrost's own `/models` list, one entry per Bifrost ID, shown as
"label · Bifrost ID". The step saves that exact ID and sends it as is. For
its label, list prices, thinking levels, structured output and vision, here
and in eval runs, the app looks up the registry model behind it: the ID is
lower-cased, `gemini/` and `vertex/` read as `google/`, OpenRouter's maker
names read as the registry's (`z-ai` as `zai`, `meta-llama` as `meta`,
`mistralai` as `mistral`, `x-ai` as `xai`, `qwen` as `alibaba`), a
`:variant` suffix (such as `:free`) is dropped, a dot or dash between version
digits reads the same (`claude-sonnet-4-6` is `claude-sonnet-4.6`), and it
matches a registry model whose Bifrost, gateway, OpenRouter or maker ID it
equals or ends with (`openrouter/openai/gpt-4o` → GPT-4o,
`openrouter/anthropic/claude-sonnet-4.6` → Claude Sonnet 4.6). Failing that,
a trailing release date (`-20250929`, `@20250929`) is dropped and the match
tried again. An ID with no match is still callable, but may have no list
price or thinking levels.
Steps saved earlier with a registry ID keep working and send the registry's
Bifrost ID.

**Bifrost in the run form, Compare setups and Settings.** Set
`BIFROST_API_KEY` and `BIFROST_BASE_URL` in `apps/api/.env` (and
`FLASH_EVALS_LLM_PROVIDER=bifrost` to start new runs, judges and pipeline steps
on it), or save the key and address under Provider keys in Settings.
A key saved in Settings wins; with none saved, the `.env` key is used
everywhere, pipeline steps included: a Bifrost step lists Bifrost's models
and runs with it (see
[Pipeline steps and `.env` keys](#model-providers)). A key saved in
Settings is sent only to the address saved with it (OpenRouter without one
uses its public `https://openrouter.ai/api/v1`); `BIFROST_BASE_URL` and
`OPENROUTER_BASE_URL` are used only with the `.env` key. A saved Bifrost key
without an address can't be used: save its address in Settings.
**Settings → Model providers** shows Bifrost with where its key comes from,
the host of its address, how many models it lists, and "Runs start here" when
it is the default provider. The run form and **Compare setups** fetch
Bifrost's `/v1/models` list once (it is reused for ten minutes) and offer a
model on Bifrost only when Bifrost lists it, under the ID Bifrost gives it:
the registry's Bifrost ID when listed, else an `openrouter/…` ID (it can follow
data rules), else the first listed ID for that model. Labels, list prices (also
in the cost estimate) and thinking levels come from the registry model behind
the ID, and the run sends that exact ID. When Bifrost is configured but its
list can't be fetched, those pages and Settings say so ("Bifrost is set up
(host) but its model list couldn't be fetched …") and no model is offered on
Bifrost until it can be; a failed fetch is retried after a minute.

**Data rules.** When a run has data rules, a Bifrost step whose ID starts
with `openrouter/` sends OpenRouter's provider settings in the request body,
the same ones an OpenRouter route sends: `provider.only` with the allowed
hosts and `allow_fallbacks: false`, `zdr: true` for zero data retention and
`data_collection: "deny"` for no training. It also sends the header
`x-bf-passthrough-extra-params: true`, which asks Bifrost to pass these extra
fields on to OpenRouter; your Bifrost must allow it. A Bifrost step on any
other upstream can't follow the rules, so the run is refused and names the
step and its ID.

**Eval runs, judges and other calls.** Everything above applies to eval
runs too, not only pipeline steps: a model or judge run through Bifrost
follows the run's data rules when its Bifrost ID starts with `openrouter/`,
and the run is refused, with the model and the ID it would be sent as, when
it doesn't. Every call through Bifrost (models, judges, rubric and
head-to-head judging, prompt checks and optimization, schema and judge
generation, transliteration, and every call when `FLASH_EVALS_LLM_PROVIDER`
is `bifrost`) sends a registry model's Bifrost ID (`gpt-4o` is sent as
`openai/gpt-4o`) and any other ID, such as one from Bifrost's list, as it is.
A run whose models all go through Bifrost sends its judges through Bifrost
too, unless a judge's provider was chosen. Thinking levels are sent as in
[Thinking settings](#thinking-settings). Speech-to-text, and the script repair
inside OpenRouter's audio transcription, still go to their own providers.

**Who served the call.** OpenRouter says which host served a call in a
`provider` field of its answer. When Bifrost passes it through, the step
records it ("bifrost, served by …"); when it doesn't (or only names Bifrost's
own upstream, such as `openrouter`), the run page shows "bifrost, host not
reported".

**Cost.** A call's cost is OpenRouter's reported cost (`usage.cost`) when
Bifrost passes it through. Otherwise it is priced for the tokens used at the
price Bifrost's `/v1/models` list gives the ID it was sent as (its `pricing`
object: OpenRouter's USD per token for `prompt`, `completion`,
`input_cache_read`, `input_cache_write` and `internal_reasoning`; a negative
price counts as none), and without one at the registry model's list price.
A pipeline step's cost is marked "Bifrost list price" or "registry list
price" on the run page (and in its routing details, next to "Provider
reported"); an eval run cell keeps which it was in its provider metadata
(`costBasis`: `reported`, `bifrost_list_price` or `registry_list_price`).
The run form, Compare setups and their pipeline estimates price a Bifrost
offer at the list's price too, so models the registry doesn't price (such as
GLM 5.2 and MiniMax M3 under their `openrouter/` IDs) get one. An ID with no
price in either list has no cost.

### Thinking settings

A run or pipeline step can ask for a thinking (reasoning) level. Which levels a
model takes comes from the model registry (`reasoningEffort.supportedLevels`
in the [model catalog](model-catalog.md)), not from its name. Each route sends
the level in the field its provider documents:

| Route                          | Maker                                                                                     | Request field sent                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Vercel AI Gateway              | OpenAI (including `gpt-6-luna`)                                                           | `providerOptions.openai.reasoningEffort`                                                             |
| Vercel AI Gateway              | Anthropic (Claude 4.6 and later)                                                          | `providerOptions.anthropic.thinking: { type: "adaptive" }` and `effort` (`minimal` is sent as `low`) |
| Vercel AI Gateway              | Anthropic (older Claude)                                                                  | `providerOptions.anthropic.thinking: { type: "enabled", budgetTokens }` (1,024 to 32,768)            |
| Vercel AI Gateway              | Anthropic, level `none`                                                                   | `providerOptions.anthropic.thinking: { type: "disabled" }`                                           |
| Vercel AI Gateway              | Google Gemini 3 and later                                                                 | `providerOptions.google.thinkingConfig.thinkingLevel` (no `none`, no `xhigh`)                        |
| Vercel AI Gateway              | Google Gemini 2.5                                                                         | `providerOptions.google.thinkingConfig.thinkingBudget` (`none` is 0)                                 |
| Vercel AI Gateway              | xAI, DeepSeek, Moonshot AI, Alibaba, Mistral, Cohere, Perplexity, Fireworks, Groq, Amazon | the AI SDK's top-level `reasoning`                                                                   |
| Vercel AI Gateway              | Gemma, Z.ai, MiniMax, Meta and others                                                     | nothing: not sent                                                                                    |
| OpenRouter                     | any                                                                                       | `reasoning: { effort }` (`none` turns thinking off)                                                  |
| Bifrost, ID `openrouter/…`     | any                                                                                       | `reasoning: { effort }` with `x-bf-passthrough-extra-params: true`                                   |
| Bifrost, ID `openai/…`         | OpenAI                                                                                    | `reasoning_effort`                                                                                   |
| Bifrost, other IDs             | any                                                                                       | nothing: not sent                                                                                    |
| OpenAI                         | OpenAI                                                                                    | `reasoning_effort`                                                                                   |
| Anthropic, Gemini API (direct) | the maker                                                                                 | the AI SDK's top-level `reasoning` (mapped to `effort` or the thinking level)                        |
| Gemini API (direct)            | Gemma                                                                                     | nothing: not sent                                                                                    |

**Bifrost's model list.** For a Bifrost ID starting with `openrouter/`,
Bifrost's `/v1/models` list carries OpenRouter's own metadata, and Flash Evals
follows it when it is there (the list is fetched at most every ten minutes, by
the API and by the worker): no `reasoning` in `supported_parameters` means no
thinking level is sent (the answer says why); `reasoning` means one is, at the
registry's levels or, for a model the registry doesn't know, OpenRouter's
(`none` to `xhigh` when `reasoning_effort` is listed too, else `none`, `low`,
`medium`, `high`). `structured_outputs` or `response_format` mark the ID as
taking structured output in pipeline step choices. When a step asks for more
output tokens than the list's `max_output_tokens`, its result shows a warning.
When the list can't be fetched, or doesn't describe the ID, the registry
decides.

A level is never dropped without saying so. Starting an eval run is refused,
with the reason, when a level chosen for a model isn't one the model takes, or
when a level other than the model's default, chosen for a model on a chosen
provider, can't be sent on that route. Every other call is checked as it is
made: a model's default level filled in by the run form, a model on the
provider picked automatically, and pipeline steps (so saved pipelines keep
running). When the level can't be sent the call goes without it and the answer
records why; so does a level a run stored that the worker finds the model
doesn't take. An eval answer keeps this in its provider metadata (`thinking`:
the level asked, whether it was sent and how, or why not; `reasoningTokens`:
the thinking tokens reported). A run made with Bifrost IDs stores each
model's level, or its default, as for registry IDs (see Model IDs under
Bifrost). The run page shows per model "Thinking high · 1,234 thinking
tokens", a warning such as "Thinking high not sent on 3 answers: …", and each
answer's thinking tokens and whether the level was sent; pipeline step results
show the same per step. Thinking tokens are part of the output tokens. Models
that refuse temperature (OpenAI reasoning models, per the registry) are sent
none.

### Eval run temperature

An eval run can give each model a temperature from 0 to 2: the "Temperature"
field next to reasoning effort in the run form, `temperatureAssignments:
[{ modelId, temperature }]` on `POST /api/runs/from-selection`,
`POST /api/setup-comparisons` and the MCP tools `create_eval_run` and
`create_setup_comparison`, or `temperature` on a model of `POST /api/runs`.
A model left out runs at its provider's default. The temperature is stored with
the run's model, sent on every route (Vercel AI Gateway, OpenRouter, Bifrost,
OpenAI, Anthropic and the Gemini API), shown per model on the run page, and
part of the answer cache key, so an answer is reused only at the same
temperature.

A temperature a model can't take is refused when the run starts, naming the
model and why, instead of being dropped:

- OpenAI reasoning models (such as `gpt-6-luna`) take no temperature.
- Claude with thinking on (any level but `none`, including the default level
  the run fills in) takes only 1. Set thinking to `none`, set the temperature
  to 1, or remove it.

Team-managed provider keys saved through the app or MCP are encrypted with
`FLASH_EVALS_SECRETS_ENC_KEY`, a base64-encoded 32-byte key. Every API and worker must
use the same value. Keep it with your protected backups; replacing it without a
migration prevents existing encrypted provider credentials from being read.

For audio, provider support varies by route and configuration. See
[STT evaluations](stt-evaluations.md). Capability probes make real provider
requests using synthetic non-speech audio; they check request compatibility,
not transcription quality.

## Storage

`FLASH_EVALS_STORAGE_ADAPTER=local` stores uploaded objects on disk, normally in
`.uploads` at the repository root. `UPLOAD_DIR` overrides that directory. The API
and worker need access to the same files. Keep `FLASH_EVALS_API_PUBLIC_URL` reachable
from your browser for uploads. Local storage is refused in production.

The Supabase adapter uses `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
`SUPABASE_STORAGE_BUCKET`; the bucket must remain private. Set
`FLASH_EVALS_CSP_STORAGE_ORIGIN` on the web build to the relevant storage origin when
restricting browser uploads. Do not expose the service-role key to browser code.
The web server also needs those three Supabase storage variables when that
adapter is selected; the service-role key stays server-side.

The `r2` adapter uses Cloudflare R2's S3 API through the AWS SDK for JavaScript
v3. Set `FLASH_EVALS_STORAGE_ADAPTER=r2` and provide `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` in the API and web
server environments. Set the same `R2_STORAGE_PREFIX` in both when using an
application namespace. The web server and Railway job worker use these settings
to read/write media; the API uses them to sign uploads, verify objects, serve
tenant-checked images, and delete media. Do not put R2 credentials in
`NEXT_PUBLIC_*` variables. Keep the bucket private; the browser receives only a
10-minute, object-specific upload URL signed for the declared content type and
byte length.

Browser PUTs also need `FLASH_EVALS_CSP_STORAGE_ORIGIN` set at web build time to the
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

`bun run deploy:check` validates the selected storage adapter in
`apps/api/.env` and `apps/web/.env`, requires that adapter's credentials, and
checks that adapters, bucket/project, and storage prefixes match. It verifies
that `FLASH_EVALS_CSP_STORAGE_ORIGIN` matches the selected endpoint. R2 deployments
do not need Supabase storage variables. Local storage, local-only R2 endpoints,
and insecure development bypass settings fail this deployment check.

`bun run deploy:check:live` reads variables for separate Railway API and worker
services with `railway variable list`. Set `RAILWAY_PROJECT_ID`,
`RAILWAY_API_SERVICE`, and `RAILWAY_WORKER_SERVICE`; the service names must be
distinct. Set `CLOUDFLARE_WEB_ENV` to a private, ignored dotenv file containing
the current Cloudflare web build/runtime settings used for the check, including
`FLASH_EVALS_STORAGE_ADAPTER`, the selected backend's values, and
`FLASH_EVALS_CSP_STORAGE_ORIGIN`. The script checks those values but does not fetch
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
the API rejects `FLASH_EVALS_ALLOW_INSECURE_DEV_DEFAULTS=true` in production.

For authenticated deployments, configure Clerk and keep tenancy settings aligned
between API and web:

- `FLASH_EVALS_TENANCY_MODE=single-org`: verified accounts on
  `FLASH_EVALS_ALLOWED_EMAIL_DOMAIN` share the configured team and its data. The API
  rejects common public email domains unless `FLASH_EVALS_ALLOW_PUBLIC_EMAIL_DOMAIN`
  explicitly permits them; allowing one means unrelated people on that domain
  could join the shared team.
- `FLASH_EVALS_TENANCY_MODE=isolated`: each new account receives a private team.
  Invitations and sharing with other accounts are not currently supported. If
  `FLASH_EVALS_ALLOWED_EMAIL_DOMAIN` is set, it restricts sign-in in this mode too.

For the Oogway Labs internal pilot, configure
`FLASH_EVALS_TENANCY_MODE=single-org` and set `FLASH_EVALS_ALLOWED_EMAIL_DOMAIN=oogwaylabs.com`
in both API and web environments. The app checks the current verified primary
email at sign-in and on each web session refresh, so a changed or unverified
address cannot keep an existing account active. MCP OAuth also checks the live
Clerk identity on every request. Email matching is case-insensitive and requires
the domain to be exactly `oogwaylabs.com`; subdomains, suffix matches, and
malformed addresses are rejected.

MCP has separate authentication. See [the MCP guide](mcp-eval-server.md) for
local tokens, production OAuth, and `FLASH_EVALS_MCP_ALLOWED_ORIGINS`.

## Limits and worker settings

| Variable                                 | Default                          | Meaning                                                                                                                                                                                                                                  |
| ---------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FLASH_EVALS_MAX_RUN_CELLS`              | 10000; maximum 16000             | Caps items × models, or items × workflow nodes, for a run.                                                                                                                                                                               |
| `FLASH_EVALS_TEAM_DAILY_SPEND_CAP_USD`   | Off                              | Refuses new runs and retries once spend recorded in the last 24 hours (eval cells by when paid, pipeline runs by start) reaches the limit.                                                                                               |
| `FLASH_EVALS_RATE_LIMIT_LLM_PER_MINUTE`  | 20                               | Per-user limit for cost-bearing setup tools such as prompt tests, validation, and probes.                                                                                                                                                |
| `FLASH_EVALS_RATE_LIMIT_RUNS_PER_MINUTE` | 10                               | Per-user limit for run creation and retries, including matching MCP tools.                                                                                                                                                               |
| `EVAL_CONCURRENCY`                       | 5 for eval runs; 4 for workflows | Parallel cells within a run; minimum 1.                                                                                                                                                                                                  |
| `FLASH_EVALS_PROVIDER_CONCURRENCY`       | 5 per provider                   | Eval model and judge calls, and pipeline step and judge calls, in flight at once per provider (transport), shared by all runs in a worker. A number, optionally with per-provider overrides: `5,openrouter=10,anthropic=3`. Maximum 100. |
| `FLASH_EVALS_RUN_SLOTS`                  | 1                                | Runs (and pipeline runs) one worker takes at once; provider slots still cap model calls. `bun run dev` sets 100.                                                                                                                         |
| `FLASH_EVALS_INNER_CONCURRENCY`          | 4 (field judges), 3 (pieces)     | Calls one task fans out at once (field judges of one answer, pieces of one transliteration). `bun run dev` sets 100.                                                                                                                     |
| `FLASH_EVALS_DB_POOL_MAX`                | 4                                | Shared app Postgres pool size for the web and worker processes. `bun run dev` sets 25.                                                                                                                                                   |
| `RUN_STALE_CLAIM_MS`                     | 900000                           | Reclaim timeout for interrupted eval cells; minimum 60000.                                                                                                                                                                               |
| `WORKFLOW_STALE_CLAIM_MS`                | 900000                           | Reclaim timeout for interrupted workflow cells; minimum 60000.                                                                                                                                                                           |
| `STT_REQUEST_TIMEOUT_MS`                 | 180000                           | Per-request timeout for OpenRouter transcription; 10000–600000. Other STT providers keep their defaults.                                                                                                                                 |
| `STT_MAX_ATTEMPTS`                       | 3                                | Attempts per OpenRouter transcription request (or chunk) for timeouts, rate limits, and 5xx errors; 1–5. Permanent errors fail at once.                                                                                                  |
| `STT_OPENROUTER_AUDIO_MAX_BYTES`         | 14680064                         | Largest raw audio payload sent to Gemini on OpenRouter. Larger recordings are compressed and, if needed, split.                                                                                                                          |
| `STT_AUDIO_MAX_CHUNK_MS`                 | 600000                           | Longest audio per Gemini-on-OpenRouter request; longer recordings are split near silences; 60000–3600000. Also capped so a 48 kbps chunk fits `STT_OPENROUTER_AUDIO_MAX_BYTES`.                                                          |
| `STT_AUDIO_PREP_TIMEOUT_MS`              | 120000                           | Time limit for each FFmpeg/FFprobe step that prepares audio; minimum 5000. Volume levelling gets a fifth of the recording length when that is longer.                                                                                    |
| `STT_AUDIO_PREP_CONCURRENCY`             | 1                                | Silence detection and encoding jobs run at once per worker process, bounding CPU. Measuring a recording is not limited, so small files do not wait behind a long conversion.                                                             |
| `FFMPEG_PATH`                            | `ffmpeg`                         | FFmpeg binary used for audio preparation.                                                                                                                                                                                                |
| `FFPROBE_PATH`                           | `ffprobe`                        | FFprobe binary used to measure recordings.                                                                                                                                                                                               |
| `FLASH_EVALS_WORKER_DRAIN_TIMEOUT_MS`    | 20000                            | Bounded SIGTERM/SIGINT drain window in ms; minimum 1000, maximum 300000.                                                                                                                                                                 |

Set a rate limit to `0` only when you intentionally want it disabled. Spend
checks use recorded costs and do not reserve funds for in-flight work. Treat
them as safeguards, not a guarantee against exceeding a provider budget.

## Workflow model-routing rollout

`FLASH_EVALS_WORKFLOW_LLM_WRITES_ENABLED` gates route/default/capability writes and
routed workflow-run creation. Its default is `true` outside production and
`false` in production. The local setup enables it with
`FLASH_EVALS_WORKFLOW_LLM_WORKER_CONTRACT_VERSION=1`.

For a deployment, enable writes only after the API and every worker run a
compatible revision and the worker contract version matches. This is deployment
configuration, not a `FLASH_EVALS_FLAG_*` feature flag checked by
`bun run quality:flags`.

## Before exposing an instance

Follow the [deployment guide](deployment.md) for the Cloudflare web, Railway API
and worker, Clerk, private R2, and PostgreSQL topology. Complete its
[Supabase Data API exposure gate](deployment.md#data-api-exposure-gate--before-migrations-or-admitting-data)
before migrations or admitting data. At minimum, use real authentication,
disable every local bypass, choose the intended tenancy policy, keep storage
private, configure HTTPS and exact origins,
and keep secrets only in server environments. Back up the database, objects, and
encryption key together. Read the [security policy](../SECURITY.md).

### Speech-to-text keys

Speech-to-text providers use their own keys, set in `apps/api/.env` or saved
in Settings > Provider keys (a saved key wins). Like the model provider keys,
`bun run dev` drops them when they come only from your shell.

| Provider   | `.env` variable      | Settings slot |
| ---------- | -------------------- | ------------- |
| OpenAI     | `OPENAI_API_KEY`     | OpenAI        |
| Soniox     | `SONIOX_API_KEY`     | Soniox        |
| ElevenLabs | `ELEVENLABS_API_KEY` | ElevenLabs    |
| Gemini     | `GEMINI_API_KEY`     | Gemini        |

ElevenLabs Scribe starts as an unverified route; see
[STT evaluations](stt-evaluations.md#elevenlabs-scribe).

## Development, test, and script variables

| Variable                                       | Read by                                       | Purpose                                                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FLASH_EVALS_DEV_API_PORT`                     | `scripts/dev.mjs`                             | API port override for `bun run dev`; otherwise API `.env` `PORT`, then `3001`. Exported shell `PORT` controls the web port.                                                                |
| `FLASH_EVALS_PACKAGES_BUILT`                   | `scripts/build-packages.mjs`                  | Set to `1` by `bun run dev` after it builds the shared packages once, so the API, web and worker it starts skip rebuilding them.                                                           |
| `NODE_EXTRA_CA_CERTS`                          | `scripts/node-with-supabase-ca.mjs`           | Extra CA bundle for Node. Defaults to the bundled Supabase root CA (`apps/web/config/supabase-root-2021-ca.pem`).                                                                          |
| `FLASH_EVALS_WORKER_TEST_FIXTURES`             | `scripts/fixtures/railway-worker-preload.mjs` | Temporary stub-module directory set and cleaned up by the Railway worker launch regression test. Test-only; do not configure it on deployed services.                                      |
| `FLASH_EVALS_IMAGE_STORAGE_ADAPTER`            | API config, web storage                       | Legacy alias for `FLASH_EVALS_STORAGE_ADAPTER`, used only when the new name is unset.                                                                                                      |
| `R2_ENDPOINT`                                  | shared object-storage package                 | Local S3-compatible test endpoint only; rejected when `NODE_ENV=production`.                                                                                                               |
| `UPLOAD_DIR`                                   | API, web storage, worker                      | Directory for the `local` storage adapter (default `.uploads` at the repo root). Local development only: the split-deploy check (`bun run deploy:check`) rejects it in deployed env files. |
| `STT_SMOKE_AUDIO_PATH`                         | `scripts/smoke-stt-capabilities.mjs`          | Audio file for `bun run smoke:stt` (default `/tmp/flash-evals-stt-smoke.wav`).                                                                                                             |
| `STT_SMOKE_PROVIDERS`                          | `scripts/smoke-stt-capabilities.mjs`          | Comma-separated providers to probe (default `openai,gateway,soniox`).                                                                                                                      |
| `STT_SMOKE_OPENAI_MODEL`                       | `scripts/smoke-stt-capabilities.mjs`          | OpenAI transcription model (default `gpt-4o-mini-transcribe`).                                                                                                                             |
| `STT_SMOKE_GATEWAY_MODELS`                     | `scripts/smoke-stt-capabilities.mjs`          | Gateway models to probe (default `openai/whisper-1,openai/gpt-4o-transcribe,openai/gpt-4o-mini-transcribe`).                                                                               |
| `STT_SMOKE_SONIOX_MODEL`                       | `scripts/smoke-stt-capabilities.mjs`          | Soniox model (default `stt-async-v5`).                                                                                                                                                     |
| `STT_SMOKE_ELEVENLABS_MODEL`                   | `scripts/smoke-stt-capabilities.mjs`          | ElevenLabs model (default `scribe_v2`). ElevenLabs runs only when `STT_SMOKE_PROVIDERS` names `elevenlabs`.                                                                                |
| `FLASH_EVALS_ROUTING_INTEGRATION_DATABASE_URL` | `routing.persistence.integration.test.ts`     | Postgres URL for the routing concurrency integration test; the test is skipped when unset. It creates and drops its own schema.                                                            |
| `FLASH_EVALS_DEV_BIND_HOST`                    | Development launcher, browser tests           | Private interface for development UIs and synthetic test API; loopback when unset.                                                                                                         |
| `FLASH_EVALS_DEV_WEB_ORIGIN`                   | Next.js and development launcher              | Browser origin used for development CORS and allowed origins. Browser tests supply their own origin.                                                                                       |
| `FLASH_EVALS_PLAYWRIGHT`                       | Next.js config                                | Set by browser suites to `app` or `marketing` to isolate development caches and TypeScript configuration.                                                                                  |
| `PLAYWRIGHT_FAKE_API_HOST`                     | Browser-test fixture                          | Set automatically from the development host by the Playwright config.                                                                                                                      |
| `PLAYWRIGHT_WEB_BASE_URL`                      | `playwright.config.ts`                        | Run the e2e suite against an existing web server instead of starting one.                                                                                                                  |
| `PLAYWRIGHT_WEB_PORT`                          | `playwright.config.ts`                        | Port for the web server Playwright starts (default `3100`, separate from interactive development).                                                                                         |
| `PLAYWRIGHT_FAKE_API_PORT`                     | `playwright.config.ts`                        | Port for the fake API used by the e2e fixtures (default `3101`).                                                                                                                           |
| `PLAYWRIGHT_API_BASE_URL`                      | `tests/e2e/api-health.spec.ts`                | API base URL for the API health smoke test; the test is skipped when unset. Set `INTERNAL_API_TOKEN` too to check the detailed `/health` payload; without it the test checks status only.  |

`FLASH_EVALS_TEST_DATABASE_URL` enables the real-PostgreSQL workflow-editing integration
test. Use only a disposable, migrated database: the test leaves immutable
synthetic routing history behind. See [the contributor test instructions](../CONTRIBUTING.md#real-database-workflow-concurrency-tests).

`NODE_ENV`, `CI` and `NEXT_PHASE` are also read, with their usual meanings.
`WORKERS_CI` is set to `1` by Cloudflare Workers Builds; the web build then
fails when `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is missing (see
`apps/web/config/security-headers.mjs`).
