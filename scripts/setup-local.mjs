import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiPath = path.join(root, "apps/api/.env");
const webPath = path.join(root, "apps/web/.env");
const existing = [apiPath, webPath].filter(existsSync);
if (existing.length > 0) {
    console.error(
        "Local env files already exist. Keep them or move them aside before running setup:local. No files were changed.",
    );
    process.exit(1);
}

const token = randomBytes(32).toString("base64");
const encryptionKey = randomBytes(32).toString("base64");
writeFileSync(
    apiPath,
    `# Local development only. Never use this file for a deployment.
DATABASE_URL=postgres://flash_evals:flash_evals@localhost:54322/flash_evals
PORT=3001
FLASH_EVALS_API_PUBLIC_URL=http://localhost:3001
FLASH_EVALS_STORAGE_ADAPTER=local
FLASH_EVALS_ALLOW_INSECURE_DEV_DEFAULTS=true
CORS_ORIGINS=http://localhost:3000
INTERNAL_API_TOKEN=${token}
FLASH_EVALS_SECRETS_ENC_KEY=${encryptionKey}
FLASH_EVALS_WORKFLOW_LLM_WRITES_ENABLED=true
FLASH_EVALS_WORKFLOW_LLM_WORKER_CONTRACT_VERSION=1
# Optional. Add a key to run model calls, then restart pnpm run dev.
FLASH_EVALS_LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=
`,
    { mode: 0o600, flag: "wx" },
);
writeFileSync(
    webPath,
    `API_BASE_URL=http://localhost:3001
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
FLASH_EVALS_WEB_DATABASE_URL=postgres://flash_evals:flash_evals@localhost:54322/flash_evals
INTERNAL_API_TOKEN=${token}
`,
    { mode: 0o600, flag: "wx" },
);
console.log(`Created apps/api/.env and apps/web/.env with matching local secrets.
Next:
  docker compose up -d postgres
  pnpm run db:migrate
  pnpm run seed  # resets app tables; use only your local test database
  pnpm run dev
Open http://localhost:3000. Add OPENROUTER_API_KEY to apps/api/.env for model calls.`);
