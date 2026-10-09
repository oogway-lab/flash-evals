#!/usr/bin/env bash
set -euo pipefail

FAILED=0
WRANGLER_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/mosaic-wrangler-whoami.XXXXXX")

cleanup() {
    rm -f "$WRANGLER_OUTPUT"
}

trap cleanup EXIT

fail() {
    echo "LIVE SPLIT DEPLOYMENT: $1"
    FAILED=1
}

require_command() {
    local command="$1"
    if ! command -v "$command" >/dev/null 2>&1; then
        fail "$command is not installed or not on PATH"
        return 1
    fi
    return 0
}

require_value() {
    local name="$1"
    local value="${!name:-}"
    if [ -z "$value" ]; then
        fail "$name is required"
        return 1
    fi
    return 0
}

RAILWAY_PROJECT_ID="${RAILWAY_PROJECT_ID:-}"
RAILWAY_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
RAILWAY_SERVICE="${RAILWAY_SERVICE:-}"
WRANGLER_BIN="${WRANGLER_BIN:-apps/web/node_modules/.bin/wrangler}"

require_value RAILWAY_PROJECT_ID
require_value RAILWAY_SERVICE

if [ -x "$WRANGLER_BIN" ]; then
    if ! "$WRANGLER_BIN" whoami >"$WRANGLER_OUTPUT" 2>&1; then
        fail "Wrangler is not authenticated; run wrangler login before Cloudflare deploy"
    elif grep -q "not authenticated" "$WRANGLER_OUTPUT"; then
        fail "Wrangler is not authenticated; run wrangler login before Cloudflare deploy"
    fi
else
    fail "$WRANGLER_BIN is missing or not executable"
fi

if require_command railway; then
    if ! variables_json=$(
        railway variable list \
            --project "$RAILWAY_PROJECT_ID" \
            --environment "$RAILWAY_ENVIRONMENT" \
            --service "$RAILWAY_SERVICE" \
            --json
    ); then
        fail "Could not read Railway variables for service $RAILWAY_SERVICE in $RAILWAY_ENVIRONMENT"
        variables_json="{}"
    fi
    missing=$(
        VARIABLES_JSON="$variables_json" node - <<'NODE'
const raw = JSON.parse(process.env.VARIABLES_JSON || "{}");
const keys = Array.isArray(raw)
  ? raw.map((entry) => entry.name || entry.key).filter(Boolean)
  : Object.keys(raw);
const required = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "CLERK_SECRET_KEY",
  "CORS_ORIGINS",
  "INTERNAL_API_TOKEN",
];
for (const key of required) {
  if (!keys.includes(key)) console.log(key);
}
NODE
    )
    if [ -n "$missing" ]; then
        while IFS= read -r key; do
            [ -n "$key" ] && fail "Railway service is missing $key"
        done <<< "$missing"
    fi

    forbidden=$(
        VARIABLES_JSON="$variables_json" node - <<'NODE'
const raw = JSON.parse(process.env.VARIABLES_JSON || "{}");
const keys = Array.isArray(raw)
  ? raw.map((entry) => entry.name || entry.key).filter(Boolean)
  : Object.keys(raw);
const forbidden = [
  "UPLOAD_DIR",
  "RAILWAY_VOLUME_ID",
  "RAILWAY_VOLUME_MOUNT_PATH",
  "RAILWAY_VOLUME_NAME",
];
for (const key of forbidden) {
  if (keys.includes(key)) console.log(key);
}
NODE
    )
    if [ -n "$forbidden" ]; then
        while IFS= read -r key; do
            [ -n "$key" ] && fail "Railway service still has legacy volume variable $key"
        done <<< "$forbidden"
    fi
fi

if [ "$FAILED" -eq 0 ]; then
    echo "Live split deployment readiness check passed."
else
    exit 1
fi
