#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

# Refuse a snapshot of the wrong database or a remote object store. Never source
# .env as shell code, and never echo credentials into the journal.
node --input-type=module <<'JS'
import { apiEnv, webEnv } from './scripts/lib/dev-env.cjs';
let url;
try { url = new URL(apiEnv.DATABASE_URL); }
catch { throw new Error('Configure the local development database before backing up.'); }
if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '54322' || url.pathname !== '/flash_evals' ||
    apiEnv.DATABASE_URL !== webEnv.FLASH_EVALS_WEB_DATABASE_URL ||
    apiEnv.FLASH_EVALS_STORAGE_ADAPTER !== 'local' ||
    (webEnv.FLASH_EVALS_STORAGE_ADAPTER && webEnv.FLASH_EVALS_STORAGE_ADAPTER !== 'local') ||
    apiEnv.UPLOAD_DIR || webEnv.UPLOAD_DIR) {
    throw new Error('This backup command requires the standard local dev database and .uploads store.');
}
JS

mkdir -p .dev.local/backups
chmod 700 .dev.local .dev.local/backups
exec 9>.dev.local/backups/.lock
flock -n 9 || { echo 'A development backup is already running.'; exit 1; }
snapshot="$(date -u +%Y%m%dT%H%M%SZ)"
staging=".dev.local/backups/.${snapshot}.partial"
archive=".dev.local/backups/${snapshot}.tar.gz"
[[ ! -e "$archive" ]] || { echo 'A snapshot with this timestamp already exists; retry in a second.'; exit 1; }
mkdir "$staging"
resume=false
cleanup() {
    local result=$?
    trap - EXIT
    if "$resume"; then
        systemctl --user start flash-evals-dev.service || result=1
    fi
    rm -rf -- "$staging"
    rm -f -- "${archive}.partial"
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

state="$(systemctl --user show flash-evals-dev.service -p ActiveState --value)"
if [[ "$state" == active || "$state" == activating || "$state" == reloading ]]; then
    resume=true
    systemctl --user stop flash-evals-dev.service
fi

docker compose exec -T postgres pg_dump --format=custom --no-owner \
    -U flash_evals -d flash_evals > "$staging/postgres.dump"
docker compose exec -T postgres pg_restore --list < "$staging/postgres.dump" > /dev/null
cp apps/api/.env "$staging/api.env"
cp apps/web/.env "$staging/web.env"
if [[ -d .uploads ]]; then cp -a .uploads "$staging/uploads"; else mkdir "$staging/uploads"; fi
{
    echo "UTC snapshot: $snapshot"
    git rev-parse HEAD
    echo "Uncommitted paths: $(git status --porcelain | wc -l)"
} > "$staging/revision.txt"
tar -czf "${archive}.partial" -C "$staging" .
mv -- "${archive}.partial" "$archive"

# Resume before rotating archives. Keep seven completed snapshots; leave all
# unrelated backups, including the pre-rename dump, alone.
if "$resume"; then
    systemctl --user start flash-evals-dev.service
    resume=false
fi
mapfile -t snapshots < <(find .dev.local/backups -maxdepth 1 -type f -name '????????T??????Z.tar.gz' | sort -r)
for ((index=7; index<${#snapshots[@]}; index++)); do rm -- "${snapshots[$index]}"; done
echo "Private backup saved: $archive (includes secrets; keep it private)."
