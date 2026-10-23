# Flash Evals development

- Start with `docs/getting-started.md` for first-time setup and
  `docs/development.md` for the daily edit/test loop. VM and remote access is
  covered in `docs/remote-development.md`.
- Local workstation development binds to loopback. On a remote checkout, keep
  every UI/API on the configured private Tailscale IPv4 address, or loopback
  behind an explicitly chosen SSH tunnel. Never bind development to `0.0.0.0`
  or enable Tailscale Funnel. Browser API/upload URLs must match the chosen
  private access method. PostgreSQL stays on loopback.
- Inspect listening ports and, when used, `tailscale status` before starting
  servers. Preserve existing Tailscale Serve configuration. Read host-specific
  addresses and operational notes from existing private env/local files; never
  assume a contributor uses the original maintainer's machine or tailnet.
- Development authentication grants the synthetic user's access to anyone who
  can reach the private UI. Keep that access restricted to trusted peers.
- Use `pnpm run dev` to start the complete app. It supplies the auth identity,
  CORS and browser configuration. If the optional Linux service is installed,
  use `pnpm run dev:restart` / `dev:status` / `dev:logs`. Stop it with
  `pnpm run dev:stop` before launching manually.
- Prefer the bundled Docker Compose PostgreSQL for first-time development.
  Inspect the database and pending migrations before changing them. Preserve
  existing data and make a private paired database/media/config backup before
  data migrations. Never seed, truncate, replay historical migrations, or remove
  database volumes without explicit authorization to reset data.
- Keep existing provider/encryption secrets and cost guardrails. Never print
  secrets, commit them, or make paid provider calls during routine setup/checks.
  Read-only MCP checks use `pnpm run smoke:mcp` and its `-- --stdio` option.
- API and worker code does not hot-reload. Restart the root launcher after
  backend/shared-package/env changes; it rebuilds shared packages. Web edits use
  Next.js fast refresh. Browser tests use separate ports and caches.
- Use `FLASH_EVALS_*`, `@flash-evals/*`, and `flash-evals://` for active identifiers.
  Preserve applied migration files and cryptographic compatibility contexts.
- Read `apps/web/AGENTS.md` and the installed Next.js docs before editing web
  runtime code. Do not assume the installed Next APIs match older versions.
- Setup checks must exercise generated configuration in temporary directories,
  preserve pre-existing files, and avoid the working database. Documentation
  changes need command/env checks, formatting and local-link verification.
