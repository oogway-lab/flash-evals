import fs from "node:fs";
import { URL } from "node:url";
import { contentSecurityPolicy } from "../../apps/web/config/security-headers.mjs";

const R2_KEYS = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
];
const SUPABASE_KEYS = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_STORAGE_BUCKET",
];

/** Parse dotenv-style values without evaluating shell syntax or expanding variables. */
export function parseEnvFile(contents) {
    const env = Object.create(null);
    for (const originalLine of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const line = originalLine.trim();
        if (!line || line.startsWith("#")) continue;
        const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
            line,
        );
        if (!match) continue;
        env[match[1]] = parseEnvValue(match[2]);
    }
    return env;
}

function parseEnvValue(raw) {
    if (raw.startsWith("\"") || raw.startsWith("'")) {
        const quote = raw[0];
        const end = raw.lastIndexOf(quote);
        if (end > 0) return raw.slice(1, end);
    }
    return raw.replace(/\s+#.*$/, "").trim();
}

export function readEnvFile(filePath) {
    return parseEnvFile(fs.readFileSync(filePath, "utf8"));
}

/** Read `railway variable list --json` without printing any variable values. */
export function parseRailwayVariables(contents, serviceLabel = "Railway service") {
    let raw;
    try {
        raw = JSON.parse(contents);
    } catch {
        throw new Error(`${serviceLabel} returned malformed variable JSON.`);
    }

    const entries = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object"
          ? Object.entries(raw).map(([name, value]) => ({ name, value }))
          : null;
    if (!entries) {
        throw new Error(`${serviceLabel} returned an unsupported variable JSON shape.`);
    }

    const env = Object.create(null);
    for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const name = entry.name || entry.key;
        if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            continue;
        }
        if (Object.hasOwn(entry, "value")) {
            env[name] = entry.value == null ? "" : String(entry.value);
        }
    }
    return env;
}

/**
 * Validate effective production storage settings for API, worker, and web.
 * Diagnostics intentionally identify keys and services only, never values.
 */
export function validateSplitStorage(services, { requireCspOrigin = true } = {}) {
    const errors = [];
    const resolved = [];

    for (const service of services) {
        const result = validateServiceStorage(service, errors);
        if (result) resolved.push(result);
    }

    if (resolved.length > 1) {
        const expectedAdapter = resolved[0].adapter;
        for (const service of resolved.slice(1)) {
            if (service.adapter !== expectedAdapter) {
                errors.push(
                    `${service.label} storage adapter does not match ${resolved[0].label}.`,
                );
            }
        }
    }

    const comparable = resolved.filter(
        (service) => service.adapter === resolved[0]?.adapter,
    );
    if (comparable.length > 1) {
        const adapter = comparable[0].adapter;
        const prefixKey =
            adapter === "r2" ? "R2_STORAGE_PREFIX" : "SUPABASE_STORAGE_PREFIX";
        const expectedPrefix = prefixValue(comparable[0].env[prefixKey], adapter);
        for (const service of comparable.slice(1)) {
            if (prefixValue(service.env[prefixKey], adapter) !== expectedPrefix) {
                errors.push(
                    `${service.label} ${prefixKey} does not match ${comparable[0].label}.`,
                );
            }
        }

        const identityKeys =
            adapter === "r2"
                ? ["R2_ACCOUNT_ID", "R2_BUCKET"]
                : ["SUPABASE_URL", "SUPABASE_STORAGE_BUCKET"];
        for (const key of identityKeys) {
            const expected = storageIdentity(comparable[0], key);
            for (const service of comparable.slice(1)) {
                if (storageIdentity(service, key) !== expected) {
                    errors.push(
                        `${service.label} ${key} does not match ${comparable[0].label}.`,
                    );
                }
            }
        }
    }

    const web = resolved.find((service) => service.kind === "web");
    if (web) {
        const expectedOrigin = storageOrigin(web);
        if (expectedOrigin && requireCspOrigin) {
            const configuredOrigin = web.env.MOSAIC_CSP_STORAGE_ORIGIN?.trim();
            if (!configuredOrigin) {
                errors.push(
                    `${web.label} is missing MOSAIC_CSP_STORAGE_ORIGIN for the Cloudflare build CSP.`,
                );
            } else if (!isOrigin(configuredOrigin) || configuredOrigin !== expectedOrigin) {
                errors.push(
                    `${web.label} MOSAIC_CSP_STORAGE_ORIGIN does not match the selected storage endpoint.`,
                );
            } else {
                const connectSrc = contentSecurityPolicy(web.env)
                    .split(";")
                    .find((directive) => directive.trim().startsWith("connect-src "));
                if (!connectSrc?.split(/\s+/).includes(expectedOrigin)) {
                    errors.push(
                        `${web.label} generated CSP connect-src does not allow the selected storage endpoint.`,
                    );
                }
            }
        }
    }

    return [...new Set(errors)];
}

function validateServiceStorage(service, errors) {
    const { env, label, kind } = service;
    if (!env) return undefined;

    if (env.NODE_ENV?.trim() && env.NODE_ENV.trim() !== "production") {
        errors.push(`${label} NODE_ENV must be production for split deployment.`);
    }
    if (isTruthy(env.MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS)) {
        errors.push(`${label} must not enable MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS.`);
    }
    if (kind === "web" && (isTruthy(env.AUTH_DEV) || isTruthy(env.AUTH_DEV_ALLOW_INSECURE))) {
        errors.push(`${label} must not enable local AUTH_DEV bypass settings.`);
    }
    if (nonEmpty(env.R2_ENDPOINT)) {
        errors.push(`${label} must not set local-test-only R2_ENDPOINT.`);
    }

    const requestedValue =
        env.MOSAIC_STORAGE_ADAPTER ?? env.MOSAIC_IMAGE_STORAGE_ADAPTER ?? "";
    const requested = requestedValue.trim().toLowerCase();
    const hasR2Settings = R2_KEYS.some((key) => nonEmpty(env[key]));
    let adapter = requested;
    if (!adapter) {
        if (hasR2Settings) {
            errors.push(
                `${label} has R2 settings but no explicit MOSAIC_STORAGE_ADAPTER=r2.`,
            );
            return undefined;
        }
        if (kind === "worker" && env.NODE_ENV?.trim() !== "production") {
            errors.push(
                `${label} must set MOSAIC_STORAGE_ADAPTER explicitly or set NODE_ENV=production to avoid the local storage default.`,
            );
            return undefined;
        }
        // API start:railway and the Cloudflare production build use the
        // production defaults in config.ts and objects.ts, respectively.
        adapter = "supabase";
    }

    if (adapter === "local") {
        errors.push(`${label} must not use the local storage adapter in split deployment.`);
        return { ...service, adapter };
    }
    if (adapter !== "r2" && adapter !== "supabase") {
        errors.push(`${label} has an unsupported MOSAIC_STORAGE_ADAPTER value.`);
        return undefined;
    }

    const keys = adapter === "r2" ? R2_KEYS : SUPABASE_KEYS;
    for (const key of keys) {
        if (!nonEmpty(env[key])) errors.push(`${label} is missing ${key}.`);
    }

    if (adapter === "r2" && nonEmpty(env.R2_ACCOUNT_ID)) {
        if (!/^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID.trim())) {
            errors.push(`${label} R2_ACCOUNT_ID must be a 32-character Cloudflare account ID.`);
        }
        const prefix = normalizePrefix(env.R2_STORAGE_PREFIX);
        if (
            prefix &&
            prefix.split("/").some((part) => !/^[A-Za-z0-9_-]{1,128}$/.test(part))
        ) {
            errors.push(`${label} R2_STORAGE_PREFIX contains an invalid path segment.`);
        }
    }

    if (adapter === "supabase" && nonEmpty(env.SUPABASE_STORAGE_PREFIX)) {
        const rawPrefix = env.SUPABASE_STORAGE_PREFIX;
        const normalizedPrefix = normalizePrefix(rawPrefix);
        const segments = normalizedPrefix.split("/");
        if (
            rawPrefix !== normalizedPrefix ||
            segments.some(
                (segment) =>
                    !segment ||
                    segment === "." ||
                    segment === ".." ||
                    segment.includes("\\"),
            )
        ) {
            errors.push(
                `${label} SUPABASE_STORAGE_PREFIX must be canonical, with no leading/trailing slash, empty, dot, or backslash path segments.`,
            );
        }
    }

    if (adapter === "supabase" && nonEmpty(env.SUPABASE_URL)) {
        let parsed;
        try {
            parsed = new URL(env.SUPABASE_URL.trim());
        } catch {
            errors.push(`${label} SUPABASE_URL must be an HTTPS project origin.`);
        }
        if (parsed && (parsed.protocol !== "https:" || isLoopback(parsed.hostname))) {
            errors.push(`${label} SUPABASE_URL must use HTTPS and a non-loopback host.`);
        }
        if (
            parsed &&
            (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash)
        ) {
            errors.push(`${label} SUPABASE_URL must be a project origin without credentials, path, query, or fragment.`);
        }
    }

    return { ...service, adapter };
}

function storageOrigin(service) {
    if (service.adapter === "r2") {
        const account = service.env.R2_ACCOUNT_ID?.trim();
        const bucket = service.env.R2_BUCKET?.trim();
        return account && bucket
            ? `https://${bucket}.${account}.r2.cloudflarestorage.com`
            : undefined;
    }
    if (service.adapter === "supabase") {
        try {
            return new URL(service.env.SUPABASE_URL.trim()).origin;
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function normalizePrefix(value) {
    return value?.trim().replace(/^\/+|\/+$/g, "") || "";
}

function prefixValue(value, adapter) {
    return adapter === "r2" ? normalizePrefix(value) : value?.trim() || "";
}

function storageIdentity(service, key) {
    const value = service.env[key]?.trim();
    if (!value) return value;
    if (key === "R2_ACCOUNT_ID") return value.toLowerCase();
    if (key === "SUPABASE_URL") {
        try {
            return new URL(value).origin;
        } catch {
            return value;
        }
    }
    return value;
}

function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function isTruthy(value) {
    return ["true", "1", "yes", "on"].includes(value?.trim().toLowerCase());
}

function isOrigin(value) {
    try {
        const parsed = new URL(value);
        return (
            parsed.protocol === "https:" &&
            parsed.origin === value &&
            !parsed.username &&
            !parsed.password
        );
    } catch {
        return false;
    }
}

function isLoopback(hostname) {
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase());
}
