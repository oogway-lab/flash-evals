#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
    echo "usage: $0 <base-url>   e.g. $0 https://mosaic.example.org" >&2
    exit 64
fi

BASE_URL="$1"
BASE_URL="${BASE_URL%/}"

measure() {
    local label="$1"
    local path="$2"
    local follow="$3"

    if [[ "$follow" == "follow" ]]; then
        curl -sS -L -o /dev/null \
            -w "${label} dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} code=%{http_code} redirects=%{num_redirects}\n" \
            "${BASE_URL}${path}"
        return
    fi

    curl -sS -o /dev/null \
        -w "${label} dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} code=%{http_code} redirects=%{num_redirects}\n" \
        "${BASE_URL}${path}"
}

echo "target=${BASE_URL}"
measure "health" "/api/health" "no-follow"
measure "root_follow" "/" "follow"
measure "sign_in" "/sign-in" "no-follow"
