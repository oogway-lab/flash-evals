#!/usr/bin/env bash
set -euo pipefail

if [ -z "${API_BASE_URL:-}" ]; then
    echo "SPLIT HEALTH: API_BASE_URL is required"
    exit 1
fi

node - <<'NODE'
const apiBaseUrl = process.env.API_BASE_URL;
const webBaseUrl = process.env.WEB_BASE_URL;

function endpoint(baseUrl, path) {
  return new URL(path, baseUrl.replace(/\/+$/, "") + "/").toString();
}

const internalApiToken = process.env.INTERNAL_API_TOKEN;

async function readJson(url, headers = {}) {
  const response = await fetch(url, { cache: "no-store", headers });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(`${url} returned non-JSON response`);
  }
  return { response, payload };
}

const failures = [];

const apiHealthUrl = endpoint(apiBaseUrl, "/health");
// Public /health returns only { status }. The detailed payload needs the
// internal API token, so the deployment-shape checks run only when it is set.
const { response: apiResponse, payload: apiHealth } = await readJson(
  apiHealthUrl,
  internalApiToken ? { "x-mosaic-internal-token": internalApiToken } : {},
);
if (!apiResponse.ok) {
  failures.push(`API health returned HTTP ${apiResponse.status}`);
}
if (apiHealth?.status !== "ok") {
  failures.push(`API health status is ${JSON.stringify(apiHealth?.status)}`);
}
if (internalApiToken) {
if (apiHealth?.service !== "mosaic-api") {
  failures.push("API health service is not mosaic-api");
}
if (apiHealth?.storage !== "supabase") {
  failures.push("API health storage is not supabase");
}
if (apiHealth?.database !== "supabase-postgres") {
  failures.push("API health database is not supabase-postgres");
}
if (apiHealth?.checks?.database !== "ok") {
  failures.push("API database check is not ok");
}
if (apiHealth?.checks?.storage !== "ok") {
  failures.push("API storage check is not ok");
}
if (apiHealth?.railwayVolumeRequired !== false) {
  failures.push("API health does not report railwayVolumeRequired=false");
}
} else {
  console.log("INTERNAL_API_TOKEN not set; checked public API health status only.");
}

if (webBaseUrl) {
  const webHealthUrl = endpoint(webBaseUrl, "/api/health");
  const { response: webResponse, payload: webHealth } = await readJson(webHealthUrl);
  if (!webResponse.ok) {
    failures.push(`Web health returned HTTP ${webResponse.status}`);
  }
  if (webHealth?.status !== "ok") {
    failures.push(`Web health status is ${JSON.stringify(webHealth?.status)}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.log(`SPLIT HEALTH: ${failure}`);
  process.exit(1);
}

console.log("Split health smoke passed.");
NODE
