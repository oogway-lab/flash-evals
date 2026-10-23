# Development

[Documentation home](../README.md#documentation) · [First-time setup](getting-started.md) · [VM / remote access](remote-development.md) · [Contributing](../CONTRIBUTING.md)

Complete first-time setup once. This guide covers the day-to-day loop, tests,
optional integrations, and updating a checkout while preserving its data.

## The everyday loop

```bash
docker compose up -d --wait postgres
pnpm run dev
```

Web is normally <http://127.0.0.1:3000>; the API is on port 3001. On a remote
host, use your configured private addresses. Ctrl+C stops the three app processes;
the database and `.uploads` remain. Do not run setup or seed every morning.

| What changed?                | What to do                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Web UI or web server modules | Next.js fast refresh handles most edits.                                                                        |
| API or worker code           | Stop/restart `pnpm run dev`. These processes do not currently watch source changes.                             |
| Shared package source        | Restart the launcher; it rebuilds the shared `dist` outputs before starting consumers.                          |
| `.env` or browser/API URLs   | Restart the complete launcher.                                                                                  |
| Dependencies                 | Stop the app, run `pnpm install --frozen-lockfile`, restart.                                                    |
| Database schema              | Review the migration and back up data before applying it; see below.                                            |
| Marketing site source        | Use the [standalone Astro preview](../apps/site/README.md#develop), or rebuild the integrated site and restart. |

Use one app launcher per checkout. If you opted into the Linux background service,
use `pnpm run dev:restart`, `pnpm run dev:status`, and `pnpm run dev:logs` instead.
Wait for web/API readiness and the `worker.ready` log after a restart.
Stop it with `pnpm run dev:stop` before launching manually. These service commands
are optional and require the [Linux service installation](remote-development.md#optional-linux-background-service).

## Ports and browser URLs

To change only the web port:

```bash
pnpm run dev --port 4000
```

The launcher updates the web origin, API CORS, and Next.js allowed origin to
match. Open port 4000 on the configured host. The API remains on port 3001.

To move the API to 4001, edit the existing values without replacing the files:

| File            | Setting                      | Local value             |
| --------------- | ---------------------------- | ----------------------- |
| `apps/api/.env` | `PORT`                       | `4001`                  |
| `apps/api/.env` | `FLASH_EVALS_API_PUBLIC_URL` | `http://127.0.0.1:4001` |
| `apps/web/.env` | `API_BASE_URL`               | `http://127.0.0.1:4001` |
| `apps/web/.env` | `NEXT_PUBLIC_API_BASE_URL`   | `http://127.0.0.1:4001` |

For direct remote access use the private server IP in all three API URLs; for
SSH forwarding use loopback and forward the new port too. Restart the launcher.
`FLASH_EVALS_DEV_API_PORT` can override the API port in the process environment,
but you must keep the API URLs aligned. The database port is independent: change
Compose's published port and **both** database URLs if 54322 is occupied.

## Run the checks your change needs

Run commands from the repository root. Code checks use mocks/synthetic fixtures;
real database and paid-provider checks are separate.

| Command                                                             | What it checks                                                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run test:dev`                                                 | Fresh local/private configuration, preservation of existing env files, worker draining, backup failure recovery.            |
| `pnpm run test`                                                     | Package, API, site, and web unit suites; optional real-database suites skip without their explicit test URLs.               |
| `pnpm run typecheck`                                                | TypeScript and Astro checks, including generated web route types.                                                           |
| `pnpm run lint`                                                     | Repository lint rules.                                                                                                      |
| `pnpm run build`                                                    | API and web production compilation; builds the marketing assets too.                                                        |
| `pnpm run test:e2e`                                                 | Chromium application smoke/navigation tests against a synthetic API.                                                        |
| `pnpm exec playwright test --config playwright.marketing.config.ts` | Anonymous marketing and sign-in routing fixtures.                                                                           |
| `pnpm run docs:check` / `pnpm run docs:env`                         | Documented commands and environment-variable coverage.                                                                      |
| `pnpm run quality`                                                  | The broader quality gate: types, build, unit tests, lint, architecture and docs; excludes browser tests and security scans. |
| `pnpm run security`                                                 | Available Gitleaks/Semgrep scanners and dependency audit; reports unavailable scanners.                                     |

Browser suites use separate Next caches and ports **3100** (app), **3101**
(synthetic API), and **3200** (marketing), so you can keep interactive development
running on 3000/3001. They follow the configured private bind host. Keep the test
ports free and run one copy of each suite at a time. They do not prove real Clerk
sign-in or paid model execution. `PLAYWRIGHT_WEB_BASE_URL` is an explicit advanced
override for an existing fixture-compatible server, not a way to silently reuse
your interactive account/data. Optional API health checks use `PLAYWRIGHT_API_BASE_URL`.

Database integration tests require a **separate disposable database**, never the
one holding your development work. Follow the
[real-database test instructions](../CONTRIBUTING.md#real-database-workflow-concurrency-tests).
Do not export production credentials into test shells. On a small VM, run suites
separately if parallel tests exhaust memory; passing health checks is not a full
test run.

## Optional tools

### Browser tests

```bash
pnpm exec playwright install chromium
```

On Linux, missing browser system libraries can be installed with
`pnpm exec playwright install --with-deps chromium`; the system-package portion
may require administrator access. Install into the same user/environment that
runs the tests. See [Playwright browser installation](https://playwright.dev/docs/browsers).

### Audio development

Install **FFmpeg and FFprobe on the machine running the worker**. On Ubuntu:

```bash
sudo apt-get update
sudo apt-get install ffmpeg
ffmpeg -version
ffprobe -version
```

For other platforms use [FFmpeg's installation references](https://ffmpeg.org/download.html).
If installed outside `PATH`, set `FFMPEG_PATH` and `FFPROBE_PATH` to the executable
paths in `apps/api/.env`, then restart. A model/provider key does not install the
local audio tools or establish provider STT capability. See
[speech-to-text setup](stt-evaluations.md).

### MCP development

MCP is optional during first-time UI setup. Follow the
[local MCP instructions](mcp-eval-server.md#local-setup) to enable the API endpoint,
generate a pepper, and create a bearer token for the existing synthetic user.
Fresh setup selects `FLASH_EVALS_TENANCY_MODE=isolated` in both env files so
`dev@local` is not blocked by organization-domain admission. Existing setups
should check that setting without reseeding.

Save the generated token privately as `FLASH_EVALS_MCP_LOCAL_TOKEN` in
`apps/api/.env`, then run:

```bash
pnpm run smoke:mcp
pnpm run smoke:mcp -- --stdio
```

These checks discover tools/resources, verify authentication and read existing
data without paid provider calls. The HTTP check needs the running API. Both
checks need existing seeded workspace/project/dataset records; they do not seed.
The stdio command runs its own server process. Remote desktop clients use the
private API URL or a forwarded API port; the web sign-in bypass does not replace
MCP authentication.

## Make a first paid evaluation

Setup and saved examples do not prove provider access. When ready, use one model
and one or two non-sensitive examples:

1. Add `OPENROUTER_API_KEY` to `apps/api/.env` for the generated OpenRouter
   configuration, or select another [provider](configuration.md#model-providers).
   Restart the launcher.
2. Create a text dataset and add examples. Supply reference answers when you want
   scoring against known outputs.
3. Create a prompt, its output schema, and a runnable validated version. Prompt
   tests, validation, schema generation, and model judges can also make paid calls.
4. Create a run with the dataset, prompt version and a compatible model, then
   inspect the individual cells, scores, latency and cost provenance.

Explicit workflow LLM nodes also need stored provider credentials and a saved
project default or pinned route; an environment key alone does not configure
those routes. STT may require provider-specific credentials/capability probes.
Do not raise the generated 50-cell/$2 recorded-spend limits just to troubleshoot.
Recorded-spend caps cannot account for every in-flight or interrupted charge.

## Update an existing checkout

Keep your environment files, encryption key, uploads, Docker volume and migration
history. **Do not rerun seed or delete volumes as an upgrade step.**

1. Stop the app (Ctrl+C or `pnpm run dev:stop`). Review the release/change notes.
2. Back up valuable data and media before pulling/applying schema changes. Use
   the [Linux paired backup](remote-development.md#backups) when configured, or the
   manual snapshot below for the standard Compose setup.
3. Pull the intended changes and run `pnpm install --frozen-lockfile`.
4. Review new SQL under `apps/web/server/db/migrations` and the database's
   `drizzle.__drizzle_migrations` journal. Apply pending migrations once with
   `pnpm run db:migrate`; never replay historical migrations by deleting history.
5. Start PostgreSQL if needed, then `pnpm run dev` (or `pnpm run dev:restart`).
   Check UI, API, worker, and any optional MCP integration you use.

### Upgrade from an older Mosaic checkout

This release renames active packages, env keys, API headers, MCP identities and
workflow policy values. Before starting the renamed code against existing data:

1. Stop the old app/worker and make a paired database/media/config backup. Keep
   the old database volume intact as a rollback copy.
2. Rename `MOSAIC_*` env keys to their `FLASH_EVALS_*` equivalents **without
   changing secret values**. Keep the existing database URL in both API and web
   configuration until you deliberately migrate the database. Preserve the
   encryption key and MCP token pepper so saved credentials/tokens remain usable.
3. Inspect Compose's actual volume mount. The default volume and database now
   use Flash Evals names; renaming a Compose volume declaration does **not** move
   its contents. Either keep the old PostgreSQL service running with its original
   configuration/URL, or explicitly dump/restore into a separate new Flash Evals
   database and verify row counts/media before switching. Do not assume a newly
   created empty volume means the previous data is gone, and do not seed it as a
   repair. The optional service/backup helpers require the standard new Compose
   database; use foreground development while keeping a custom/legacy database.
4. Review and apply pending migration 0061 once. It changes reserved execution
   metadata and the workflow retry-owner constraint. Earlier migration files and
   journal entries remain intact; never replay 0037 on populated data.
5. Rebuild packages and restart web/API/worker together. Update external clients
   to `@flash-evals/*`, `flash-evals://`, and the new internal-header/OAuth scope
   names. Older encrypted credentials remain readable; new encryption uses the
   Flash Evals context. Renamed selection cookies can require choosing the
   workspace/project again.

Verify the original datasets, outputs, media and credential reads before retiring
the old service/volume. Existing cache fingerprints can miss older reusable
results; the rename does not reconstruct previously lost provider costs.

For a private manual snapshot while app writes are stopped:

```bash
umask 077
mkdir -p .dev.local .uploads
chmod 700 .dev.local
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T postgres pg_dump --format=custom --no-owner   -U flash_evals -d flash_evals > ".dev.local/postgres-$backup_stamp.dump"
tar -czf ".dev.local/files-$backup_stamp.tar.gz" .uploads apps/api/.env apps/web/.env
```

Keep both files together and private; they contain data and secrets. Custom
PostgreSQL/storage installations need a matching backup of their actual targets.
A dump alone does not contain uploaded media or the encryption key. Restore into
a separate database first and verify it; a same-disk backup does not protect
against losing the machine. Commit/push code changes separately from data backups.
