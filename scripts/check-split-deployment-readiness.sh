#!/usr/bin/env bash
set -euo pipefail

FAILED=0

fail() {
    echo "SPLIT DEPLOYMENT: $1"
    FAILED=1
}

warn() {
    echo "SPLIT DEPLOYMENT WARNING: $1"
}

has_env_key() {
    local file="$1"
    local key="$2"
    grep -Eq "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file"
}

require_env_key() {
    local file="$1"
    local key="$2"
    if ! has_env_key "$file" "$key"; then
        fail "$file is missing $key"
    fi
}

forbid_env_key() {
    local file="$1"
    local key="$2"
    if [ -f "$file" ] && has_env_key "$file" "$key"; then
        fail "$file must not contain $key"
    fi
}

require_file() {
    local file="$1"
    if [ ! -f "$file" ]; then
        fail "$file is missing"
        return 1
    fi
    return 0
}

API_ENV="${API_ENV:-apps/api/.env}"
WEB_ENV="${WEB_ENV:-apps/web/.env}"

if require_file "$API_ENV"; then
    for key in \
        DATABASE_URL \
        CLERK_SECRET_KEY \
        MOSAIC_ALLOWED_EMAIL_DOMAIN \
        CORS_ORIGINS \
        INTERNAL_API_TOKEN
    do
        require_env_key "$API_ENV" "$key"
    done

    for key in UPLOAD_DIR RAILWAY_VOLUME_ID RAILWAY_VOLUME_MOUNT_PATH RAILWAY_VOLUME_NAME
    do
        forbid_env_key "$API_ENV" "$key"
    done
fi

if require_file "$WEB_ENV"; then
    for key in \
        NEXT_PUBLIC_API_BASE_URL \
        INTERNAL_API_TOKEN \
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
        CLERK_SECRET_KEY
    do
        require_env_key "$WEB_ENV" "$key"
    done

    for key in \
        DATABASE_URL \
        OPENAI_API_KEY \
        AI_GATEWAY_API_KEY \
        UPLOAD_DIR
    do
        forbid_env_key "$WEB_ENV" "$key"
    done
fi

require_file "apps/web/wrangler.jsonc"
if [ -f "wrangler.jsonc" ]; then
    fail "root wrangler.jsonc should not exist; use apps/web/wrangler.jsonc"
fi

if [ -f "$API_ENV" ] || [ -f "$WEB_ENV" ]; then
    if ! node scripts/validate-split-storage-readiness.mjs local "$API_ENV" "$WEB_ENV"; then
        FAILED=1
    fi
fi

if ! node --input-type=module <<'NODE'
import fs from "node:fs";

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const root = read("package.json");
const api = read("apps/api/package.json");
const web = read("apps/web/package.json");
const checks = [
    [root.scripts?.["api:start:railway"], "@mosaic/api start:railway", "root API start script"],
    [root.scripts?.worker, "@mosaic/web worker", "root worker start script"],
    [api.scripts?.["start:railway"], "NODE_ENV=production", "API Railway runtime script"],
    [api.scripts?.["start:railway"], "dist/railway.js", "API Railway entrypoint"],
    [web.scripts?.worker, "scripts/worker.ts", "worker entrypoint"],
];
const failures = checks.filter(([actual, expected]) => !actual?.includes(expected));
if (failures.length) {
    for (const [, , label] of failures) console.error(`SPLIT DEPLOYMENT: ${label} is missing or changed.`);
    process.exitCode = 1;
}
NODE
then
    FAILED=1
fi

if [ -f "$API_ENV" ] && [ -f "$WEB_ENV" ]; then
    api_token_line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?INTERNAL_API_TOKEN=" "$API_ENV" | tail -n 1 || true)
    web_token_line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?INTERNAL_API_TOKEN=" "$WEB_ENV" | tail -n 1 || true)
    api_token=${api_token_line#*=}
    web_token=${web_token_line#*=}
    if [ -n "$api_token" ] && [ -n "$web_token" ] && [ "$api_token" != "$web_token" ]; then
        fail "apps/api/.env and apps/web/.env INTERNAL_API_TOKEN values do not match"
    fi
fi

if [ ! -f "$API_ENV" ] || [ ! -f "$WEB_ENV" ]; then
    warn "local .env files are absent; copy from .env.example before local smoke testing"
fi

if [ "$FAILED" -eq 0 ]; then
    echo "Split deployment readiness check passed."
    echo "Expected split topology: API uses pnpm run api:start:railway with MOSAIC_API_START_WORKER=false; worker uses pnpm run worker and has no HTTP health check. This check does not inspect Railway service settings."
    echo "This check validates repository launch scripts; it does not treat railway.json as the deployed configuration."
else
    exit 1
fi
