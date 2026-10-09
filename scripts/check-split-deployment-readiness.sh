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
        SUPABASE_URL \
        SUPABASE_SERVICE_ROLE_KEY \
        SUPABASE_STORAGE_BUCKET \
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
        SUPABASE_URL \
        SUPABASE_SERVICE_ROLE_KEY \
        SUPABASE_STORAGE_BUCKET \
        OPENAI_API_KEY \
        AI_GATEWAY_API_KEY \
        UPLOAD_DIR
    do
        forbid_env_key "$WEB_ENV" "$key"
    done
fi

require_file "railway.json"
if [ -f "railway.json" ]; then
    if ! grep -q '"startCommand": "pnpm --filter @mosaic/api start:railway"' railway.json; then
        fail "railway.json must start the Railway API runtime"
    fi
    if grep -Eq 'UPLOAD_DIR|RAILWAY_VOLUME|volumeMounts|requiredMountPath' railway.json; then
        fail "railway.json must not configure Railway volume storage"
    fi
fi

require_file "apps/web/wrangler.jsonc"
if [ -f "wrangler.jsonc" ]; then
    fail "root wrangler.jsonc should not exist; use apps/web/wrangler.jsonc"
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
else
    exit 1
fi
