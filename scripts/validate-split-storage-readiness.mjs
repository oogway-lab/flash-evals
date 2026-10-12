#!/usr/bin/env node
import fs from "node:fs";
import {
    parseRailwayVariables,
    readEnvFile,
    validateSplitStorage,
} from "./lib/split-deployment-readiness.mjs";

const [mode, ...args] = process.argv.slice(2);
const errors = [];

function requireValues(env, label, keys) {
    for (const key of keys) {
        if (!env[key]?.trim()) errors.push(`${label} is missing ${key}.`);
    }
}

function rejectLegacyVolumes(env, label) {
    for (const key of [
        "UPLOAD_DIR",
        "RAILWAY_VOLUME_ID",
        "RAILWAY_VOLUME_MOUNT_PATH",
        "RAILWAY_VOLUME_NAME",
    ]) {
        if (env[key] !== undefined) errors.push(`${label} must not set ${key}.`);
    }
}

function readRailwayFile(filePath, label) {
    try {
        return parseRailwayVariables(fs.readFileSync(filePath, "utf8"), label);
    } catch (error) {
        errors.push(error instanceof Error ? error.message : `${label} is unreadable.`);
        return undefined;
    }
}

function readEnvOptional(filePath, label) {
    try {
        return readEnvFile(filePath);
    } catch {
        errors.push(`${label} cannot be read.`);
        return undefined;
    }
}

if (mode === "local") {
    const [apiPath, webPath] = args;
    const services = [];
    if (apiPath && fs.existsSync(apiPath)) {
        const env = readEnvOptional(apiPath, "API environment");
        if (env) {
            services.push({ label: "API environment", kind: "api", env });
            requireValues(env, "API environment", [
                "DATABASE_URL",
                "CLERK_SECRET_KEY",
                "MOSAIC_ALLOWED_EMAIL_DOMAIN",
                "CORS_ORIGINS",
                "INTERNAL_API_TOKEN",
            ]);
            if (env.MOSAIC_API_START_WORKER !== "false") {
                errors.push(
                    "API environment must set MOSAIC_API_START_WORKER=false when the worker is a separate service.",
                );
            }
            rejectLegacyVolumes(env, "API environment");
        }
    }
    if (webPath && fs.existsSync(webPath)) {
        const env = readEnvOptional(webPath, "Web environment");
        if (env) {
            services.push({ label: "Web environment", kind: "web", env });
            requireValues(env, "Web environment", [
                "NEXT_PUBLIC_API_BASE_URL",
                "INTERNAL_API_TOKEN",
                "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
                "CLERK_SECRET_KEY",
            ]);
            rejectLegacyVolumes(env, "Web environment");
        }
    }
    errors.push(...validateSplitStorage(services));
} else if (mode === "live") {
    const [apiVariablesPath, workerVariablesPath, webPath] = args;
    const api = apiVariablesPath
        ? readRailwayFile(apiVariablesPath, "Railway API service")
        : undefined;
    const worker = workerVariablesPath
        ? readRailwayFile(workerVariablesPath, "Railway worker service")
        : undefined;
    const web = webPath ? readEnvOptional(webPath, "Cloudflare web environment") : undefined;

    if (api) {
        requireValues(api, "Railway API service", [
            "DATABASE_URL",
            "CLERK_SECRET_KEY",
            "CORS_ORIGINS",
            "INTERNAL_API_TOKEN",
        ]);
        if (api.MOSAIC_API_START_WORKER !== "false") {
            errors.push(
                "Railway API service must set MOSAIC_API_START_WORKER=false for the separate worker service.",
            );
        }
        rejectLegacyVolumes(api, "Railway API service");
    }
    if (worker) {
        requireValues(worker, "Railway worker service", ["DATABASE_URL"]);
        rejectLegacyVolumes(worker, "Railway worker service");
    }
    if (web) {
        requireValues(web, "Cloudflare web environment", [
            "NEXT_PUBLIC_API_BASE_URL",
            "INTERNAL_API_TOKEN",
            "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
            "CLERK_SECRET_KEY",
        ]);
        rejectLegacyVolumes(web, "Cloudflare web environment");
    }
    if (
        api?.INTERNAL_API_TOKEN?.trim() &&
        web?.INTERNAL_API_TOKEN?.trim() &&
        api.INTERNAL_API_TOKEN !== web.INTERNAL_API_TOKEN
    ) {
        errors.push(
            "Railway API service and Cloudflare web environment INTERNAL_API_TOKEN values do not match.",
        );
    }

    const services = [];
    if (api) services.push({ label: "Railway API service", kind: "api", env: api });
    if (worker) services.push({ label: "Railway worker service", kind: "worker", env: worker });
    if (web) services.push({ label: "Cloudflare web environment", kind: "web", env: web });
    errors.push(...validateSplitStorage(services));
} else {
    errors.push("Usage: validate-split-storage-readiness.mjs <local|live> ...");
}

if (errors.length > 0) {
    for (const message of [...new Set(errors)]) console.error(`SPLIT STORAGE: ${message}`);
    process.exitCode = 1;
}
