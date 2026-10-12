#!/usr/bin/env bash
set -euo pipefail

umask 077
FAILED=0
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/mosaic-live-readiness.XXXXXX")

cleanup() {
    rm -rf "$TMP_DIR"
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
    if [ -z "${!name:-}" ]; then
        fail "$name is required"
        return 1
    fi
    return 0
}

RAILWAY_PROJECT_ID="${RAILWAY_PROJECT_ID:-}"
RAILWAY_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
RAILWAY_API_SERVICE="${RAILWAY_API_SERVICE:-${RAILWAY_SERVICE:-}}"
RAILWAY_WORKER_SERVICE="${RAILWAY_WORKER_SERVICE:-}"
CLOUDFLARE_WEB_ENV="${CLOUDFLARE_WEB_ENV:-}"
WRANGLER_BIN="${WRANGLER_BIN:-apps/web/node_modules/.bin/wrangler}"

require_value RAILWAY_PROJECT_ID
require_value RAILWAY_API_SERVICE
require_value RAILWAY_WORKER_SERVICE
require_value CLOUDFLARE_WEB_ENV

if [ -n "$RAILWAY_API_SERVICE" ] && [ "$RAILWAY_API_SERVICE" = "$RAILWAY_WORKER_SERVICE" ]; then
    fail "RAILWAY_API_SERVICE and RAILWAY_WORKER_SERVICE must identify separate services"
fi

if [ -n "$CLOUDFLARE_WEB_ENV" ] && [ ! -f "$CLOUDFLARE_WEB_ENV" ]; then
    fail "CLOUDFLARE_WEB_ENV must point to a private file of current Cloudflare build/runtime variables"
fi

if [ -x "$WRANGLER_BIN" ]; then
    if ! "$WRANGLER_BIN" whoami >"$TMP_DIR/wrangler-whoami.out" 2>&1; then
        fail "Wrangler is not authenticated; run wrangler login before Cloudflare deploy"
    elif grep -qi "not authenticated" "$TMP_DIR/wrangler-whoami.out"; then
        fail "Wrangler is not authenticated; run wrangler login before Cloudflare deploy"
    fi
else
    fail "$WRANGLER_BIN is missing or not executable"
fi

if require_command railway &&
    [ -n "$RAILWAY_PROJECT_ID" ] &&
    [ -n "$RAILWAY_API_SERVICE" ] &&
    [ -n "$RAILWAY_WORKER_SERVICE" ] &&
    [ "$RAILWAY_API_SERVICE" != "$RAILWAY_WORKER_SERVICE" ]; then
    for role in api worker; do
        if [ "$role" = "api" ]; then
            service="$RAILWAY_API_SERVICE"
        else
            service="$RAILWAY_WORKER_SERVICE"
        fi
        variables_path="$TMP_DIR/railway-$role.json"
        if ! railway variable list \
            --project "$RAILWAY_PROJECT_ID" \
            --environment "$RAILWAY_ENVIRONMENT" \
            --service "$service" \
            --json >"$variables_path" 2>"$TMP_DIR/railway-$role.stderr"; then
            fail "Could not read Railway variables for the $role service in $RAILWAY_ENVIRONMENT"
            rm -f "$variables_path"
        fi
    done
fi

if [ -f "$TMP_DIR/railway-api.json" ] &&
    [ -f "$TMP_DIR/railway-worker.json" ] &&
    [ -f "$CLOUDFLARE_WEB_ENV" ]; then
    if ! node scripts/validate-split-storage-readiness.mjs live \
        "$TMP_DIR/railway-api.json" \
        "$TMP_DIR/railway-worker.json" \
        "$CLOUDFLARE_WEB_ENV"; then
        FAILED=1
    fi
fi

if [ "$FAILED" -eq 0 ]; then
    echo "Live split deployment readiness check passed."
    echo "This check reads API and worker variables from Railway and web build/runtime variables from CLOUDFLARE_WEB_ENV. It does not inspect per-service Railway start or healthcheck settings."
    echo "Expected topology: API uses pnpm run api:start:railway with MOSAIC_API_START_WORKER=false; worker uses pnpm run worker with no HTTP health check. This check does not inspect those Railway service settings."
else
    exit 1
fi
