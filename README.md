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

You need Git, Node.js **24.21.0**, pnpm **12.6.0**, and Docker Compose v2 with
`--wait` support. Use a disposable database: **the seed command resets application
tables, including existing datasets and runs.**

Run these commands in a terminal on your development machine:

```bash
git clone https://github.com/oogway-lab/flash-evals.git
cd flash-evals
pnpm install --frozen-lockfile
pnpm run setup:local
docker compose up -d --wait postgres
node scripts/build-packages.mjs
pnpm run db:migrate
pnpm run seed
pnpm run dev
```

Open <http://localhost:3000>. You should see the seeded workspace with synthetic
receipt examples and saved results. The images are placeholders and the stored
outputs are fixtures, not a benchmark of model quality.

No Clerk, Supabase, or provider account is needed to explore those examples.
`setup:local` creates two local environment files with matching generated secrets;
`dev` starts the web app, API, and background worker. Keep this development stack
on a trusted machine, without public exposure: it bypasses web sign-in and allows
local uploads without authentication.

To make real model calls, add a provider key to `apps/api/.env` and restart the
stack. The generated configuration uses `OPENROUTER_API_KEY`. Tests, prompt
validation, judges, and evaluations can all incur provider charges.

See the [getting-started guide](docs/getting-started.md) for the first evaluation,
a non-Docker database, stopping and restarting, and setup troubleshooting.

## Documentation

| I want to…                                            | Read                                                  |
| ----------------------------------------------------- | ----------------------------------------------------- |
| Start from a fresh clone                              | [Getting started](docs/getting-started.md)            |
| Connect an agent or call the MCP server               | [MCP guide](docs/mcp-eval-server.md)                  |
| Set provider keys, storage, authentication, or limits | [Configuration](docs/configuration.md)                |
| Evaluate audio and transcripts                        | [Speech-to-text evaluations](docs/stt-evaluations.md) |
| Understand runs, workflows, and model routing         | [Concepts](CONCEPTS.md)                               |
| Change the code and run checks                        | [Contributing](CONTRIBUTING.md)                       |
| Understand data isolation and security reporting      | [Security policy](SECURITY.md)                        |
| Work on or deploy the flashevals.dev website          | [Site README](apps/site/README.md)                    |

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

The product is called Flash Evals. Existing `@mosaic/*` package names,
`MOSAIC_*` variables, and `mosaic://` resource URIs remain unchanged for
compatibility. Use those identifiers exactly as documented.

## Contributing and license

Focused bug reports and pull requests are welcome. Read [Contributing](CONTRIBUTING.md)
and the [Code of Conduct](CODE_OF_CONDUCT.md), and remove secrets and personal or
customer data before sharing reports publicly. There is no active private
vulnerability-reporting channel yet; read the [security policy](SECURITY.md)
before reporting a security concern, and do not post vulnerability details publicly.

First-party source and documentation are licensed under [AGPL-3.0-only](LICENSE).
Copyright © 2026 Oogway Labs Private Limited. See [License history](LICENSE_HISTORY.md)
for earlier MIT distributions and [Third-party notices](THIRD_PARTY_NOTICES.md)
for dependencies with their own terms.
