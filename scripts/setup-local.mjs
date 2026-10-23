import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isPrivateDevHost } from "./lib/dev-host.cjs";

const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: {
        host: { type: "string", default: "127.0.0.1" },
        help: { type: "boolean", short: "h" },
    },
});
if (values.help) {
    console.info(
        "Usage: pnpm run setup:local [--host <Tailscale IPv4>]\nCreates private env files only; never starts, migrates, or seeds a database.",
    );
    process.exit(0);
}
const host = values.host;
if (!isPrivateDevHost(host)) {
    throw new Error(
        "Use 127.0.0.1 for local/SSH access or a private Tailscale IPv4 address for remote access.",
    );
}
const webOrigin = `http://${host}:3000`;
const apiOrigin = `http://${host}:3001`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiPath = path.join(root, "apps/api/.env");
const webPath = path.join(root, "apps/web/.env");
const existing = [apiPath, webPath].filter(existsSync);
if (existing.length > 0) {
    console.error(
        "Local env files already exist. Keep them and follow docs/development.md#update-an-existing-checkout. No files were changed.",
    );
    process.exit(1);
}

const token = randomBytes(32).toString("base64");
const encryptionKey = randomBytes(32).toString("base64");
writeFileSync(
    apiPath,
    `# Local development only. Never use this file for a deployment.
DATABASE_URL=postgres://flash_evals:flash_evals@127.0.0.1:54322/flash_evals
PORT=3001
FLASH_EVALS_API_BIND_HOST=${host}
FLASH_EVALS_API_PUBLIC_URL=${apiOrigin}
FLASH_EVALS_STORAGE_ADAPTER=local
FLASH_EVALS_ALLOW_INSECURE_DEV_DEFAULTS=true
CORS_ORIGINS=${webOrigin}
FLASH_EVALS_TENANCY_MODE=isolated
INTERNAL_API_TOKEN=${token}
FLASH_EVALS_SECRETS_ENC_KEY=${encryptionKey}
FLASH_EVALS_WORKFLOW_LLM_WRITES_ENABLED=true
FLASH_EVALS_WORKFLOW_LLM_WORKER_CONTRACT_VERSION=1
FLASH_EVALS_MAX_RUN_CELLS=50
FLASH_EVALS_TEAM_DAILY_SPEND_CAP_USD=2
# Optional. Add a key to run model calls, then restart pnpm run dev.
FLASH_EVALS_LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=
`,
    { mode: 0o600, flag: "wx" },
);
writeFileSync(
    webPath,
    `API_BASE_URL=${apiOrigin}
NEXT_PUBLIC_API_BASE_URL=${apiOrigin}
FLASH_EVALS_DEV_BIND_HOST=${host}
FLASH_EVALS_DEV_WEB_ORIGIN=${webOrigin}
FLASH_EVALS_TENANCY_MODE=isolated
FLASH_EVALS_WEB_DATABASE_URL=postgres://flash_evals:flash_evals@127.0.0.1:54322/flash_evals
INTERNAL_API_TOKEN=${token}
`,
    { mode: 0o600, flag: "wx" },
);
console.log(`Created apps/api/.env and apps/web/.env with matching local secrets.
Next:
  docker compose up -d --wait postgres
  node scripts/build-packages.mjs
  # Inspect the database first; preserve existing data and migration history.
  pnpm run db:migrate
  pnpm run seed  # NEW disposable database ONLY; resets application tables
  pnpm run dev
Open ${webOrigin}. No provider key is needed for the synthetic examples.
See docs/getting-started.md before migrations/seeding or adding provider keys.`);
