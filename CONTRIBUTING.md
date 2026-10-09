# Contributing to Flash Evals

Thanks for helping improve Flash Evals. This early-stage alpha is changing quickly; focused pull requests and clear reports are especially useful.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Do not put credentials, customer data, or personal information in public issues, pull requests, fixtures, or screenshots. Report security concerns using [SECURITY.md](SECURITY.md).

## Project layout

- `apps/web/` — Next.js UI, database schema and migrations, and the local evaluation worker.
- `apps/api/` — Node.js API for Postgres, object storage, provider calls, run queues, and MCP.
- `packages/api-contract/` — shared API types and typed client.
- `packages/llm-core/` — model provider transports and cost helpers.
- `packages/secrets/` — credential encryption helpers.

Package names, environment-variable prefixes, and database identifiers currently use the internal `mosaic` name for compatibility.

## Prerequisites and setup

- Node.js 24.21.0 LTS and pnpm 12.6.0 (`.nvmrc` and `packageManager` pin these versions).
- Docker for the local Postgres database.
- Git.

```bash
pnpm install
pnpm run setup:local
docker compose up -d postgres
pnpm run db:migrate
pnpm run seed
pnpm run dev
```

`setup:local` creates local environment files and generated development secrets without overwriting existing files. No Clerk or Supabase account is needed for local development. `pnpm run seed` resets the configured application tables, so use a disposable local database.

To run evaluations, configure a provider credential in `apps/api/.env`. Provider requests may incur charges.

## Development workflow

1. Branch from `main` with a focused name such as `fix/short-description`.
2. Keep changes focused and update the relevant documentation.
3. Add or update tests when changing behavior.
4. Prefer existing UI primitives in `apps/web/components/ui/` and semantic design tokens in `apps/web/app/globals.css`.
5. Describe behavior changes, verification, and user impact in the pull request.

## Verification

Run the checks relevant to your change:

```bash
pnpm run typecheck
pnpm run build
pnpm run test
pnpm run test:e2e
pnpm run lint
pnpm run quality
pnpm run security
```

`pnpm run test:e2e` uses a local fake API and does not require a database or provider keys. It may skip the optional live API check unless `PLAYWRIGHT_API_BASE_URL` is configured. `pnpm run security` reports if a local scanner is unavailable; GitHub Actions runs the pinned scans in CI.

## Pull requests and issues

Use conventional summaries such as `feat:`, `fix:`, `docs:`, or `test:`. Explain the reason for the change and list the checks you ran. Include screenshots only after removing secrets and personal or customer data.
