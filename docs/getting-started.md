# Getting started

[Documentation home](../README.md#documentation)

This guide starts a local Flash Evals instance with synthetic examples. It uses
PostgreSQL and local disk storage. You do not need a sign-in service, cloud storage,
or a model-provider key until you want to make real model calls.

## 1. Check the prerequisites

Install Git, Node.js 24.21.0, pnpm 12.6.0, and Docker Compose v2 with `--wait`
support. The Node version is pinned in [`.nvmrc`](../.nvmrc); pnpm is pinned in
[`package.json`](../package.json). Verify your terminal is using them:

```bash
node --version
pnpm --version
docker compose version
```

The first two commands should print `v24.21.0` and `12.6.0`. The instructions use
a Unix-like shell; on Windows, use a compatible Linux development environment.
Ports 3000 (web), 3001 (API), and 54322 (database) must be available.

## 2. Create the local configuration

```bash
git clone https://github.com/oogway-lab/flash-evals.git
cd flash-evals
pnpm install --frozen-lockfile
pnpm run setup:local
```

Run the remaining commands from this repository root. `--frozen-lockfile`
installs the dependency versions recorded in the repository without rewriting
the lockfile. If it reports a mismatch, check that you have a complete, current
checkout rather than deleting the lockfile.

The setup command creates `apps/api/.env` and `apps/web/.env`. It generates the
shared internal API token and provider-key encryption key, chooses local storage,
and points to the bundled PostgreSQL service. It refuses to change anything if
either environment file already exists. Keep those files private and out of Git.

Do not copy the complete `.env.example` files over this local setup: those files
also describe deployment settings and contain placeholders for external services.

## 3. Prepare a disposable database

**Check `DATABASE_URL` in `apps/api/.env` before seeding.** The default is
`postgres://mosaic:mosaic@localhost:54322/mosaic`. The seed script truncates
application tables and cascading references, then inserts synthetic data. Never
point it at a database you need to preserve.

```bash
docker compose up -d --wait postgres
node scripts/build-packages.mjs
pnpm run db:migrate
pnpm run seed
```

Compose binds the PostgreSQL port to loopback and preserves its data in a named
volume. `db:migrate` creates or updates the schema. `seed` adds a development user,
a workspace, example datasets, prompts, and precomputed results; it makes no
model-provider calls.

### Already have PostgreSQL?

Use a dedicated, empty PostgreSQL database and a user allowed to create its
schema and queue tables. PostgreSQL 17 is the bundled local version. Change
`DATABASE_URL` in `apps/api/.env`, skip the Docker command, and run the remaining
build, migration, and seed commands above. The API and worker must use the same
database. An exported `DATABASE_URL` in your shell takes precedence over the file.

## 4. Start the app

```bash
pnpm run dev
```

This command builds shared packages and starts three processes:

| Process | What it does                                               | Local address           |
| ------- | ---------------------------------------------------------- | ----------------------- |
| Web     | Pages, forms, and result review                            | <http://localhost:3000> |
| API     | Data access, uploads, provider calls, and MCP when enabled | <http://localhost:3001> |
| Worker  | Executes queued model and evaluation steps                 | No browser page         |

Open the web address. You should be signed into the development account and see
the seeded examples. Explore a dataset, a prompt, and a completed run. The receipt
images are flat placeholder images and the saved outputs are synthetic; use real,
consented samples before drawing conclusions about a model.

For a basic process check, in a second terminal run:

```bash
curl --fail http://localhost:3000/api/health
curl --fail http://localhost:3001/health
```

A healthy web endpoint returns `{"status":"ok"}`. Health responses confirm that
the services answer requests; they do not prove that a worker completed an
evaluation or that provider credentials are valid.

## 5. Try a small evaluation

Real provider requests may cost money. Start with one or two non-sensitive text
examples and one model.

1. Add `OPENROUTER_API_KEY` to `apps/api/.env`, then stop and restart `pnpm run dev`.
   The local setup selects OpenRouter. See [provider configuration](configuration.md#model-providers)
   if you want another transport.
2. Create a text dataset. Choose **golden** when you have reference answers to
   score against, or **evaluation** when you want to inspect outputs without them.
3. Add a few inputs. For structured comparisons, supply reference labels matching
   the fields your prompt will return.
4. Create a prompt, define its output schema, and test it on a sample. Validate
   it before saving a runnable version. Validation itself makes model calls.
5. Create a run using that dataset, prompt version, and a compatible model.
   Choose the scoring fields or judge appropriate to your task.
6. Wait for the worker to finish, then inspect individual cells as well as the
   aggregate results. A cell is one dataset item evaluated with one model
   configuration. Add notes or annotations where the scores need human context.

A model judge is another model call that grades an output against a rubric. Treat
its score as evidence to review, not ground truth. For multi-step tasks, move on
to a workflow after the basic dataset and prompt work as intended.

## Stop, restart, and update

Press Ctrl+C in the development terminal to stop the API, web app, and worker.
The database stays running. Stop it without removing its data with:

```bash
docker compose stop postgres
```

Next time, run `docker compose up -d --wait postgres` and `pnpm run dev`.
**Do not reseed on every start.** Seeding is a reset, not an incremental update.
After pulling code that changes dependencies or the schema, run
`pnpm install --frozen-lockfile` and `pnpm run db:migrate` before starting again.
Back up anything valuable before an alpha upgrade.

## Troubleshooting

| Symptom                                           | Check                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Install rejects the Node version                  | Check `node --version` in this terminal, then use the pinned version.                                                                 |
| Setup says environment files exist                | Keep and inspect the existing files. The setup command does not merge or overwrite them.                                              |
| Migration cannot connect                          | Confirm Docker is running, `docker compose ps postgres` is healthy, and `DATABASE_URL` uses host port 54322.                          |
| Database connection goes somewhere unexpected     | Check exported shell variables. They override values loaded from `.env`.                                                              |
| App asks for Clerk sign-in locally                | Start with the root `pnpm run dev`; separate process commands do not apply its development overrides.                                 |
| Seeded user or workspace is missing               | Check that the API and seed command used the same disposable database. Do not reseed a valuable database to investigate.              |
| Run stays pending                                 | Look for `[worker]` output in the development terminal and check worker/database errors. A running web app alone cannot execute jobs. |
| Provider says unauthorized, or no models work     | Check the key for the selected transport in the API environment, then restart all three processes.                                    |
| Upload fails locally                              | Keep the API public URL and browser-facing API URL consistent; review [local storage settings](configuration.md#storage).             |
| MCP returns an auth error while the web app works | MCP has separate authentication. Follow the [local MCP setup](mcp-eval-server.md#local-setup).                                        |

If you report a bug, include the commit, tool versions, exact steps, and redacted
logs. Never post `.env` contents, bearer tokens, provider keys, or private datasets.
See the [security policy](../SECURITY.md) for security-sensitive reports.
