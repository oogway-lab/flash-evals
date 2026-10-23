# Flash Evals

Compare models and prompts on the examples that matter to your application.
Flash Evals is a self-hosted app for evaluating text, image, and speech-to-text
outputs. It keeps the inputs, outputs, scores, latency, and estimated cost together
so you can inspect why one approach works better than another.

**Early-stage alpha.** Expect rough edges and breaking changes. This source
release is for local experimentation and development; it is not a managed service
or a production-ready deployment guide.

[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-informational.svg)](LICENSE)

## What can I do with it?

- Compare several models on the same text, image, or audio dataset.
- Check structured answers against reference labels, or use a model to judge
  outputs against a rubric.
- Compare transcripts and, where supported, speaker diarization.
- Build workflows that connect model calls, prompts, and evaluation steps.
- Review individual results, add notes, and annotate cases that need attention.
- Let an MCP-compatible agent work with the same datasets, prompts, and runs.

A **dataset** holds your examples. A **prompt** describes the task and expected
output. A **run** applies selected models to the dataset and records the results.
A **workflow** connects several steps when a single prompt is not enough.

## Run locally

Flash Evals runs on macOS or Linux, and on Windows through WSL2. You need Git,
Node.js **24.21.0** (the `.nvmrc`/CI pin), pnpm **12.6.0**, and a running Docker
Engine with Compose v2. The application runs on your host; Docker runs PostgreSQL.
No Clerk, Supabase, or model-provider account is needed for the synthetic examples.

For a **new, disposable development database**:

```bash
git clone https://github.com/oogway-lab/flash-evals.git
cd flash-evals
# If you use nvm: nvm install && nvm use
pnpm install --frozen-lockfile
pnpm run setup:local
docker compose up -d --wait postgres
node scripts/build-packages.mjs
pnpm run db:migrate
# First initialization ONLY: this resets application tables.
pnpm run seed
pnpm run dev
```

Open <http://127.0.0.1:3000>. The command starts web, API, and worker together;
you should see a workspace with synthetic receipts, prompts, and saved results.
The generated configuration binds to loopback, creates private matching secrets,
and selects local disk storage. **Never seed an existing database you need to
preserve.** Keep the sign-in bypass on loopback or a restricted private network.

Use [Getting started](docs/getting-started.md) for tool installation, first-time
database checks, expected results, and troubleshooting. For a VM or remote host,
[configure private browser access](docs/remote-development.md) before starting
any UI. For code changes, tests, audio, and optional MCP, use the
[development guide](docs/development.md).

On subsequent days, run only:

```bash
docker compose up -d --wait postgres
pnpm run dev
```

Real provider calls require credentials and may incur charges. Setup and the
synthetic examples do not call models. The generated limits are 50 cells per run
and $2 in recorded daily team spend; they are guardrails, not a prepaid balance.

## Documentation

| I want to…                                            | Read                                                  |
| ----------------------------------------------------- | ----------------------------------------------------- |
| Start from a fresh clone                              | [Getting started](docs/getting-started.md)            |
| Develop locally, run tests, or enable audio/MCP       | [Development guide](docs/development.md)              |
| Work on a VM or remote server                         | [Remote development](docs/remote-development.md)      |
| Deploy the Cloudflare, Railway, and PostgreSQL stack  | [Deployment guide](docs/deployment.md)                |
| Connect an agent or call the MCP server               | [MCP guide](docs/mcp-eval-server.md)                  |
| Set provider keys, storage, authentication, or limits | [Configuration](docs/configuration.md)                |
| Evaluate audio and transcripts                        | [Speech-to-text evaluations](docs/stt-evaluations.md) |
| Understand runs, workflows, and model routing         | [Concepts](CONCEPTS.md)                               |
| Change the code and run checks                        | [Contributing](CONTRIBUTING.md)                       |
| Understand data isolation and security reporting      | [Security policy](SECURITY.md)                        |
| Work on the integrated flashevals.dev website         | [Site README](apps/site/README.md)                    |

## Before using your own data

- In `single-org` tenancy mode, accounts on the configured verified email domain
  share the instance's workspaces and data. Projects are organizational boundaries,
  not private access controls.
- `isolated` mode gives each new account a private team. Inviting or sharing with
  other accounts is not currently supported.
- Inputs, prompts, and outputs may contain sensitive information. Running an
  evaluation sends the relevant inputs to your selected model providers.
- Cost figures are estimates. Spending limits use recorded usage, not a prepaid
  balance or a guarantee against every in-flight charge.
- MCP can change and delete data. Its `confirm: true` arguments are supplied by
  the client; they do not create a human approval screen.

## How it fits together

The browser talks to a Next.js web app. The API handles database access, uploads,
provider calls, and MCP. A separate worker consumes queued evaluations from
PostgreSQL and saves their results.

| Path                    | Responsibility                                           |
| ----------------------- | -------------------------------------------------------- |
| `apps/web`              | Web app, worker, database schema, and migrations         |
| `apps/api`              | API, MCP server, storage, provider calls, and run queues |
| `apps/site`             | The flashevals.dev marketing site (static Astro)         |
| `packages/api-contract` | Shared API types and client                              |
| `packages/llm-core`     | Model-provider transports and cost helpers               |
| `packages/secrets`      | Provider-credential encryption helpers                   |

Flash Evals uses `@flash-evals/*` package names, `FLASH_EVALS_*` environment
variables, and `flash-evals://` MCP resource URIs. See the
[remote development guide](docs/remote-development.md) for Tailscale access,
private browser access and optional Linux background services. Existing
installations should follow the [update instructions](docs/development.md#update-an-existing-checkout)
without reseeding.

## Contributing and license

Focused bug reports and pull requests are welcome. Read [Contributing](CONTRIBUTING.md)
and the [Code of Conduct](CODE_OF_CONDUCT.md), and remove secrets and personal or
customer data before sharing reports publicly. To report a suspected vulnerability,
use the private reporting address in the [security policy](SECURITY.md); do not post
vulnerability details publicly.

First-party source and documentation are licensed under [AGPL-3.0-only](LICENSE).
Copyright © 2026 Oogway Labs Private Limited. See [License history](LICENSE_HISTORY.md)
for earlier MIT distributions and [Third-party notices](THIRD_PARTY_NOTICES.md)
for dependencies with their own terms.
