# Flash Evals

**Early-stage alpha:** Flash Evals is self-hosted evaluation software under active development. Expect rough edges and breaking changes; it is not a production-ready managed service.

Flash Evals compares language, image, and speech-to-text models on your own datasets. It records structured-output accuracy, latency, cost, field-level differences against labels, and LLM-as-judge scores. Prompt workflows can compose multiple model and evaluation steps.

[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-informational.svg)](LICENSE)

## Quick start

**Requirements:** Node.js 24.21.0 LTS, pnpm 12.6.0, and Docker for the bundled local Postgres setup.

```bash
pnpm install
pnpm run setup:local
docker compose up -d postgres
pnpm run db:migrate
pnpm run seed
pnpm run dev
```

`setup:local` creates local-only environment files and generated development secrets without overwriting existing files. This setup does not require Clerk or Supabase. The development command starts the API on port 3001, web app on port 3000, and worker with the local authentication bypass enabled.

The seed command **resets application tables** in the configured database and loads synthetic example data with placeholder images. It does not call an LLM provider. Use it only with a disposable local database. To run model evaluations, add a provider key such as `OPENROUTER_API_KEY` to `apps/api/.env`.

Open <http://localhost:3000>. For separate processes, use `pnpm run api:dev`, `pnpm run worker`, and `pnpm --filter @mosaic/web dev`.

See [configuration](docs/configuration.md) for environment variables and [STT evaluations](docs/stt-evaluations.md) for speech-to-text inputs and metrics.

## What it does

- Compare model outputs side by side on text, image, and audio datasets.
- Score structured output, field-level matches, transcripts, diarization, and custom criteria.
- Track latency, token use, and estimated provider cost for each run.
- Compose prompts, model calls, and evaluators into multi-step workflows.
- Use the Streamable HTTP MCP endpoint to work with datasets, prompts, runs, workflows, and settings.

## Architecture

Flash Evals is organized as a pnpm workspace:

| Path                    | Purpose                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| `apps/web`              | Next.js web app, local development worker, and database schema/migrations.      |
| `apps/api`              | Node.js API for Postgres, object storage, provider calls, queued runs, and MCP. |
| `packages/api-contract` | Shared API types and typed client.                                              |
| `packages/llm-core`     | Provider transports and cost helpers.                                           |
| `packages/secrets`      | Helpers for encrypting provider credentials at rest.                            |

The web tier calls the API for privileged work. Do not expose provider credentials, database credentials, or the internal API token to browser code.

## Authentication and data access

Local development uses `AUTH_DEV=true` and `AUTH_DEV_ALLOW_INSECURE=1`; this bypass is rejected in production.

`MOSAIC_TENANCY_MODE` controls account isolation. In `single-org` mode, every verified account on the configured email domain shares the instance's workspaces and data. In `isolated` mode, each signup receives a private team, but inviting or sharing with other accounts is not currently supported. Review [SECURITY.md](SECURITY.md) before exposing an instance to other people.

## Known limitations

- This is an early-stage alpha and interfaces, schemas, and configuration can change.
- A single-org instance has no per-project privacy; everyone in its shared team can see everyone else's data.
- Provider calls and speech-to-text probes may incur charges. Review the selected model and provider terms before running them.
- Public hosted deployment instructions and a managed service are not part of this source release.
- The local seed data is synthetic; user-provided datasets and model outputs may contain sensitive information and should be handled accordingly.

## MCP server

The API exposes a Streamable HTTP MCP endpoint at `/mcp` when `MOSAIC_MCP_ENABLED=true`. See [MCP server setup](docs/mcp-eval-server.md) for client configuration. `AUTH_DEV` does not bypass MCP authentication.

## Development and checks

```bash
pnpm run typecheck
pnpm run build
pnpm run test
pnpm run test:e2e
pnpm run lint
pnpm run quality
pnpm run security
```

GitHub Actions runs the quality and security gates on pull requests and pushes to `main`. It uses GitHub-hosted `ubuntu-latest` runners and does not deploy the application.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [Code of Conduct](CODE_OF_CONDUCT.md), and [Security Policy](SECURITY.md). Do not include credentials, customer data, or personal information in public issues or pull requests.

## License

Current first-party source and documentation are licensed under [AGPL-3.0-only](LICENSE). Copyright © 2026 Oogway Labs Private Limited. See [LICENSE_HISTORY.md](LICENSE_HISTORY.md) for the note on earlier MIT distributions. Third-party components retain their own notices and license terms.
