# Contributing to Flash Evals

Thanks for helping improve Flash Evals. This early-stage alpha is changing quickly; focused pull requests and clear reports are especially useful.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Do not put credentials, customer data, or personal information in public issues, pull requests, fixtures, or screenshots. For security concerns, read [SECURITY.md](SECURITY.md) before reporting. No private vulnerability-reporting channel is active yet; the planned security@oogwaylabs.com alias is inactive. Do not send reports there or post vulnerability details publicly.

## Project layout

- `apps/web/` — Next.js UI, database schema and migrations, and the local evaluation worker.
- `apps/api/` — Node.js API for Postgres, object storage, provider calls, run queues, and MCP.
- `packages/api-contract/` — shared API types and typed client.
- `packages/llm-core/` — model provider transports and cost helpers.
- `packages/secrets/` — credential encryption helpers.

Package names, environment-variable prefixes, and database identifiers currently use the internal `mosaic` name for compatibility.

## Prerequisites and setup

Follow [Getting started](docs/getting-started.md) for the complete fresh-clone
setup. Use Node.js 24.21.0, pnpm 12.6.0, and a disposable PostgreSQL database.
Docker Compose is the bundled database option; an existing PostgreSQL instance
also works. No Clerk, Supabase, or provider account is needed for synthetic data.

The seed command resets application tables. Provider requests, including prompt
validation, may incur charges. Keep all development authentication and local
storage bypasses off public networks.

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
pnpm run docs:check
pnpm run docs:env
pnpm run quality
pnpm run security
```

Install Chromium for Playwright with `pnpm exec playwright install chromium`
before running browser tests locally. The current `test:e2e` suite covers basic
health and page-rendering checks with a fake API. It does not establish full
click-through coverage of datasets, prompts, runs, or workflows. The optional API
health check is skipped unless `PLAYWRIGHT_API_BASE_URL` is set. Production Clerk
sign-in and paid-provider behavior require separate integration testing.

`pnpm run quality` combines type checks, builds, unit tests, lint, architecture,
and documentation checks; it does not run Playwright or replace the security
scans. `pnpm run security` reports if a local scanner is unavailable. GitHub
Actions runs quality and security jobs plus a browser smoke job; none deploy the
application.

For a documentation-only change, run `docs:check`, `docs:env`, and Prettier on the
changed files, and check local links and examples. The command checker verifies
that named pnpm scripts exist; it does not prove the commands ran successfully.

### Real-database workflow concurrency tests

The workflow-editing regression can also run against a disposable, migrated
PostgreSQL database. It exercises overlapping graph and node-selection writes.
Create a dedicated test database, apply the migrations, then run:

```bash
MOSAIC_TEST_DATABASE_URL=postgres://user:password@localhost:5432/flash_evals_test \
  pnpm --filter @mosaic/api exec vitest run src/routes/workflowEditing.integration.test.ts
```

Replace the URL with your test database. The test is skipped when the variable is
unset. It creates synthetic tenant, credential, route, and capability records;
immutable synthetic history remains until you discard the test database. Never
point it at a persistent development or production database.

## Pull requests and issues

Use conventional summaries such as `feat:`, `fix:`, `docs:`, or `test:`. Explain the reason for the change and list the checks you ran. Include screenshots only after removing secrets and personal or customer data.
