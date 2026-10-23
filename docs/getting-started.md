# Getting started

[Documentation home](../README.md#documentation) · [Development](development.md) · [VM / remote access](remote-development.md)

This is the first-time setup for contributors and people exploring Flash Evals.
It runs web, API, and worker on your development machine, PostgreSQL in Docker,
and media on local disk. Synthetic examples work without cloud accounts or paid
model calls. Hosted deployment has [separate instructions](deployment.md).

## Choose where to run

| Environment                     | Use this guide with…                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| macOS or Linux laptop           | A local terminal and loopback browser URLs.                                                                                        |
| Windows                         | A WSL2 Linux terminal; keep the checkout and Node/pnpm inside that environment.                                                    |
| Linux VM or remote server       | The same setup, plus [private browser access](remote-development.md) before starting a UI.                                         |
| Existing installation with data | [Update an existing checkout](development.md#update-an-existing-checkout); keep its environment, keys, data and migration history. |

A new clone can still find an old Docker volume. Check the database before
initializing examples; cloning does not make an existing database disposable.

## 1. Install the tools

| Tool             | Version / purpose                                       | Installation reference                                                                      |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Git              | Clone and contribute                                    | Your operating system's Git package.                                                        |
| Node.js          | **24.21.0**, pinned in [`.nvmrc`](../.nvmrc) and CI     | [Node downloads](https://nodejs.org/en/download); an existing Node version manager is fine. |
| pnpm             | **12.6.0**, pinned in [`package.json`](../package.json) | [pnpm installation](https://pnpm.io/installation).                                          |
| Docker + Compose | Running Engine and Compose v2 with `--wait` support     | [Docker installation options](https://docs.docker.com/compose/install/).                    |

Docker Desktop includes Engine and Compose on macOS/Windows. Linux can use
Docker Engine plus the Compose plugin. On Windows, enable
[Docker Desktop's WSL2 integration](https://docs.docker.com/desktop/features/wsl/)
for your distribution. Native PowerShell/cmd instructions are not provided: the
repository's development scripts use a Unix shell.

Clone first so a Node version manager can read the repository pin:

```bash
git clone https://github.com/oogway-lab/flash-evals.git
cd flash-evals
# With nvm already installed:
nvm install
nvm use
```

If you use another Node manager or the official installer, select the version
from `.nvmrc` and skip the two `nvm` commands. The package engine range permits
other versions, but the pin gives the closest match to CI.

If pnpm is absent, the official POSIX installer supports a pinned version:

```bash
curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=12.6.0 sh -
```

Follow its shell/PATH instructions and reopen your terminal if requested. An
existing Corepack-managed pnpm installation is also fine; check the version in
the same terminal you will use for development:

```bash
node --version
pnpm --version
docker compose version
docker info
```

Expect the Node/pnpm pins above and a reachable Docker daemon. Start Docker
Desktop or the Linux Docker service if `docker info` cannot connect. FFmpeg and
Playwright Chromium are optional until you need audio or browser tests; see
[development tools](development.md#optional-tools).

## 2. Install dependencies and create configuration

Run all following commands from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run setup:local
```

The setup command only creates `apps/api/.env` and `apps/web/.env`. It does not
start services or touch a database. It generates matching internal API tokens,
a provider-key encryption key, loopback URLs, local storage, isolated tenancy
for the synthetic user, and modest cost guardrails. Files have private permissions
and are ignored by Git. MCP and paid providers remain optional.

If either file exists, setup refuses to overwrite either file. Keep those files
and follow the [existing-installation instructions](development.md#update-an-existing-checkout).
Do not replace them with `.env.example`: the example files also contain hosted
service settings and placeholders. Preserve encryption keys whenever you preserve
data. Exported shell variables and Next.js `.env.local` files can override `.env`;
see [configuration loading](configuration.md#how-environment-files-are-loaded).

For direct private access on a remote host, use the
[remote setup option](remote-development.md#direct-access-over-tailscale) **instead
of** generating loopback configuration and guessing browser URLs.

## 3. Initialize a new development database once

Start the bundled database:

```bash
docker compose up -d --wait postgres
docker compose ps postgres
docker compose exec -T postgres psql -U flash_evals -d flash_evals -c '\dt'
```

A new database reports no relations. If it already has application tables or
valuable data, stop here and use the update instructions. Verify both database
settings point at the intended instance:

| File            | Setting                        | Generated value                                                  |
| --------------- | ------------------------------ | ---------------------------------------------------------------- |
| `apps/api/.env` | `DATABASE_URL`                 | `postgres://flash_evals:flash_evals@127.0.0.1:54322/flash_evals` |
| `apps/web/.env` | `FLASH_EVALS_WEB_DATABASE_URL` | The exact same URL.                                              |

Compose publishes PostgreSQL on loopback port **54322**, not its container port 5432. Data persists in the `flash-evals-postgres` named volume, scoped by the
Compose project. Keep ports 3000 (web), 3001 (API), and 54322 free.

For this confirmed new, disposable database:

```bash
node scripts/build-packages.mjs
pnpm run db:migrate
# First initialization ONLY: resets application tables and cascading references.
pnpm run seed
```

Migrations create the schema; seed creates the synthetic `dev@local` user, team,
workspace, dataset, prompts, and completed results. It makes no provider calls.
Historical migration 0037 truncates team-owned tables: it is acceptable on a new
empty database, but must not be replayed on an existing installation. Never
reseed as a troubleshooting step for data you need to keep.

### Use your own PostgreSQL instead

PostgreSQL **17** is the bundled/tested development version. Create a dedicated,
empty database with a role allowed to create application schemas and pg-boss
queue tables. Set **both** database URLs in the table above to the same database,
skip Compose, then run the build/migration/seed steps only for that new database.
No Supabase project is needed. If you change Docker's published port, update both
URLs too. The optional Linux service/backup helpers assume the standard Compose
database and storage paths; use foreground development for a custom database.

## 4. Start and verify

```bash
pnpm run dev
```

| Process | Address                        | Expected behavior                                              |
| ------- | ------------------------------ | -------------------------------------------------------------- |
| Web     | <http://127.0.0.1:3000>        | Signs in as the synthetic user through the development bypass. |
| API     | <http://127.0.0.1:3001/health> | Returns `{"status":"ok"}` when its checks pass.                |
| Worker  | No HTTP port                   | Logs `worker.ready` and consumes evaluation queues.            |

Open the web URL, then inspect **Datasets**, **Prompts**, and a completed **Run**.
The sample receipt images are placeholders and the saved outputs are fixtures,
not a benchmark. In another terminal:

```bash
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3001/health
pnpm run worker:status
```

The web health endpoint checks that Next responds; the API checks its backend.
The worker-status command checks the database/queues, so also confirm the running
worker's `worker.ready` log. None of these establish provider authentication or
paid execution. For remote access, substitute your configured private URLs.

`pnpm run dev` supplies the sign-in bypass and seeded identity, builds shared
packages, and starts all three processes. Starting Next directly does not supply
those settings. Never expose this development account or local-upload bypass on
a public interface.

## 5. Stop and come back tomorrow

Press **Ctrl+C** to stop web, API, and worker gracefully. PostgreSQL keeps running.
You can stop it without deleting data:

```bash
docker compose stop postgres
```

On subsequent starts:

```bash
docker compose up -d --wait postgres
pnpm run dev
```

There is no need to rerun setup, migrations, or seed for an ordinary restart.
For code changes, tests, provider calls, MCP, or updates, continue with the
[development guide](development.md).

## Troubleshooting

| Symptom                                | What to check                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Node/pnpm missing or wrong version     | Use the same shell/environment as your checkout; activate `.nvmrc` and pnpm 12.6.0. Reopen the shell after installing tools.                |
| Dependency installation fails          | Keep the lockfile; use `--frozen-lockfile`, check network access and the pinned tools. Avoid running installation as root.                  |
| Docker daemon or socket inaccessible   | Start Docker; on Linux configure Docker access for your user and reconnect. In WSL2 enable integration for that distribution.               |
| Compose does not recognize `--wait`    | Install/update the Compose v2 plugin; the command is `docker compose`, not legacy `docker-compose`.                                         |
| Configuration already exists           | Preserve it. Setup never merges or overwrites environment files.                                                                            |
| Database connection fails              | Check the Compose health, loopback host port 54322, both database URLs, and shell/`.env.local` overrides.                                   |
| `EADDRINUSE` / port occupied           | Stop another copy or choose [different ports](development.md#ports-and-browser-urls). Do not delete database volumes.                       |
| UI asks for Clerk or has no workspace  | Use the root launcher and confirm seed, API, web, and worker use the same intended database. Preserve existing data while investigating.    |
| API cannot be reached from the browser | Browser `localhost` means the browser's machine. Follow the [VM access guide](remote-development.md).                                       |
| Changes do not take effect             | Web uses fast refresh; restart the root launcher after API, worker, shared-package, or environment edits.                                   |
| Run stays pending                      | Confirm the worker process/log, then run `pnpm run worker:status`. Health alone does not prove execution.                                   |
| Audio preparation fails                | Install FFmpeg/FFprobe where the worker runs.                                                                                               |
| MCP rejects a working UI's user        | MCP needs its own token/configuration; fresh development tenancy should be `isolated`. See the [MCP guide](mcp-eval-server.md#local-setup). |

When reporting a setup issue, include OS/architecture, Node/pnpm/Compose versions,
the failing command, and redacted error output. Omit `.env` contents, tokens,
provider keys, private data, and database dumps.
