import {
    resolveApiFeatureFlags,
    type ApiFeatureFlags,
} from "./featureFlags.js";
import type { EvalProviderMode } from "@mosaic/llm-core";
import type { SttCapabilityProbeResults } from "./sttModels.js";
import {
    createR2StorageConfig,
    type IR2StorageConfig,
} from "@mosaic/object-storage";

export interface IApiConfig {
    nodeEnv: string;
    port: number;
    databaseUrl: string;
    storageAdapter: "local" | "supabase" | "r2";
    // Public origin of this API (e.g. http://localhost:3001). Used to mint
    // absolute local-upload URLs the browser can PUT to under the `local`
    // storage adapter (U8). Optional; defaults to http://localhost:<port>.
    apiPublicUrl?: string;
    supabaseUrl: string;
    supabaseServiceRoleKey: string;
    supabaseStorageBucket: string;
    supabaseStoragePrefix?: string;
    r2Storage?: IR2StorageConfig;
    clerkSecretKey: string;
    mosaicTenancyMode: MosaicTenancyMode;
    mosaicAllowedEmailDomain: string;
    mosaicDefaultTeamId?: string;
    /** Hard ceiling on cells (items x models or items x workflow nodes) per run. */
    maxRunCells?: number;
    /** Optional rolling 24h spend ceiling per team; new runs are refused at or above it. */
    teamDailySpendCapUsd?: number;
    /** Per-user requests per minute to LLM-cost endpoints; 0 disables. Default 20. */
    rateLimitLlmPerMinute?: number;
    /** Per-user run creations and retries per minute; 0 disables. Default 10. */
    rateLimitRunsPerMinute?: number;
    corsOrigins: string[];
    mosaicLlmProvider: EvalProviderMode;
    openaiApiKey?: string;
    aiGatewayApiKey?: string;
    sonioxApiKey?: string;
    geminiApiKey?: string;
    openrouterApiKey?: string;
    openrouterBaseUrl?: string;
    bifrostApiKey?: string;
    bifrostBaseUrl?: string;
    sttCapabilityProbes: SttCapabilityProbeResults;
    internalApiToken?: string;
    mosaicSecretsEncKey?: string;
    errorTrackingDsn?: string;
    analyticsKey?: string;
    alertWebhookUrl?: string;
    profilingEnabled: boolean;
    workflowLlmWritesEnabled?: boolean;
    workflowLlmWorkerContractVersion?: number;
    mosaicMcpEnabled?: boolean;
    mosaicMcpAllowedOrigins?: string[];
    mosaicMcpResourceUrl?: string;
    mosaicMcpOAuthClientId?: string;
    mosaicMcpOAuthDynamicClients?: boolean;
    mosaicMcpRawTokenFallbackEnabled?: boolean;
    mosaicMcpTokenPepper?: string;
    clerkPublishableKey?: string;
    clerkIssuer?: string;
    clerkJwtKey?: string;
    clerkAuthorizedParties?: string[];
    featureFlags: ApiFeatureFlags;
}

// "single-org": one allowed email domain, one shared team — every matching
// signup joins it (today's only behavior). "isolated": any verified email is
// accepted and each new signup gets its own private team, for a public
// deployment that can't predict who's signing up.
export type MosaicTenancyMode = "single-org" | "isolated";

export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConfigError";
    }
}

type Env = Record<string, string | undefined>;

const REQUIRED_KEYS = [
    "DATABASE_URL",
    "CLERK_SECRET_KEY",
    "INTERNAL_API_TOKEN",
] as const;

export function getApiConfig(env: Env = process.env): IApiConfig {
    const localDev =
        env.NODE_ENV !== "production" &&
        parseBoolean(env.MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS, false);
    const missing = REQUIRED_KEYS.filter(
        (key) =>
            !(key === "CLERK_SECRET_KEY" && localDev) && !nonEmpty(env[key]),
    );
    if (missing.length > 0) {
        throw new ConfigError(
            `Missing required API env: ${missing.join(", ")}`,
        );
    }

    const port = parsePort(env.PORT);
    const corsOrigins = parseCsv(env.CORS_ORIGINS);
    if (env.NODE_ENV === "production" && corsOrigins.length === 0) {
        throw new ConfigError("Missing required API env: CORS_ORIGINS");
    }
    const mosaicTenancyMode = parseTenancyMode(env.MOSAIC_TENANCY_MODE);
    const mosaicAllowedEmailDomain = allowedEmailDomain(env);
    if (mosaicTenancyMode === "single-org") {
        validateSingleOrgDomain(env, mosaicAllowedEmailDomain);
    }
    const storageAdapter = parseStorageAdapter(env);
    let r2Storage: IR2StorageConfig | undefined;
    if (storageAdapter === "supabase") {
        const missingSupabase = [
            "SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "SUPABASE_STORAGE_BUCKET",
        ].filter((key) => !nonEmpty(env[key]));
        if (missingSupabase.length > 0) {
            throw new ConfigError(
                `Missing required API env: ${missingSupabase.join(", ")}`,
            );
        }
    }
    if (storageAdapter === "r2") {
        try {
            r2Storage = createR2StorageConfig(env as NodeJS.ProcessEnv);
        } catch (error) {
            throw new ConfigError(
                error instanceof Error
                    ? error.message
                    : "Invalid R2 storage configuration.",
            );
        }
    }

    const config: IApiConfig = {
        nodeEnv: env.NODE_ENV || "development",
        port,
        databaseUrl: env.DATABASE_URL!,
        storageAdapter,
        apiPublicUrl: emptyToUndefined(env.MOSAIC_API_PUBLIC_URL),
        supabaseUrl: env.SUPABASE_URL ?? "",
        supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
        supabaseStorageBucket: env.SUPABASE_STORAGE_BUCKET ?? "",
        supabaseStoragePrefix: emptyToUndefined(env.SUPABASE_STORAGE_PREFIX),
        ...(r2Storage ? { r2Storage } : {}),
        clerkSecretKey: env.CLERK_SECRET_KEY ?? "",
        mosaicTenancyMode,
        mosaicAllowedEmailDomain,
        mosaicDefaultTeamId: emptyToUndefined(env.MOSAIC_DEFAULT_TEAM_ID),
        maxRunCells: parseMaxRunCells(env.MOSAIC_MAX_RUN_CELLS),
        teamDailySpendCapUsd: parseSpendCap(
            env.MOSAIC_TEAM_DAILY_SPEND_CAP_USD,
        ),
        rateLimitLlmPerMinute: parseRateLimit(
            "MOSAIC_RATE_LIMIT_LLM_PER_MINUTE",
            env.MOSAIC_RATE_LIMIT_LLM_PER_MINUTE,
        ),
        rateLimitRunsPerMinute: parseRateLimit(
            "MOSAIC_RATE_LIMIT_RUNS_PER_MINUTE",
            env.MOSAIC_RATE_LIMIT_RUNS_PER_MINUTE,
        ),
        corsOrigins,
        mosaicLlmProvider: parseProviderMode(env.MOSAIC_LLM_PROVIDER),
        openaiApiKey: emptyToUndefined(env.OPENAI_API_KEY),
        aiGatewayApiKey: emptyToUndefined(env.AI_GATEWAY_API_KEY),
        sonioxApiKey: emptyToUndefined(env.SONIOX_API_KEY),
        geminiApiKey: emptyToUndefined(env.GEMINI_API_KEY),
        openrouterApiKey: emptyToUndefined(env.OPENROUTER_API_KEY),
        openrouterBaseUrl: emptyToUndefined(env.OPENROUTER_BASE_URL),
        bifrostApiKey: emptyToUndefined(env.BIFROST_API_KEY),
        bifrostBaseUrl: emptyToUndefined(env.BIFROST_BASE_URL),
        sttCapabilityProbes: parseSttCapabilityProbes(
            env.MOSAIC_STT_CAPABILITY_PROBES,
        ),
        internalApiToken: emptyToUndefined(env.INTERNAL_API_TOKEN),
        mosaicSecretsEncKey: emptyToUndefined(env.MOSAIC_SECRETS_ENC_KEY),
        errorTrackingDsn: emptyToUndefined(env.MOSAIC_ERROR_TRACKING_DSN),
        analyticsKey: emptyToUndefined(env.MOSAIC_ANALYTICS_KEY),
        alertWebhookUrl: emptyToUndefined(env.MOSAIC_ALERT_WEBHOOK_URL),
        profilingEnabled: parseBoolean(env.MOSAIC_PROFILING_ENABLED, false),
        workflowLlmWritesEnabled: parseBoolean(
            env.MOSAIC_WORKFLOW_LLM_WRITES_ENABLED,
            env.NODE_ENV !== "production",
        ),
        workflowLlmWorkerContractVersion: parseOptionalInteger(
            env.MOSAIC_WORKFLOW_LLM_WORKER_CONTRACT_VERSION,
        ),
        mosaicMcpEnabled: parseBoolean(env.MOSAIC_MCP_ENABLED, false),
        mosaicMcpAllowedOrigins: parseCsv(env.MOSAIC_MCP_ALLOWED_ORIGINS),
        mosaicMcpResourceUrl: emptyToUndefined(env.MOSAIC_MCP_RESOURCE_URL),
        mosaicMcpOAuthClientId: emptyToUndefined(
            env.MOSAIC_MCP_OAUTH_CLIENT_ID,
        ),
        mosaicMcpOAuthDynamicClients: parseBoolean(
            env.MOSAIC_MCP_OAUTH_DYNAMIC_CLIENTS,
            false,
        ),
        mosaicMcpRawTokenFallbackEnabled: parseBoolean(
            env.MOSAIC_MCP_RAW_TOKEN_FALLBACK_ENABLED,
            false,
        ),
        mosaicMcpTokenPepper: emptyToUndefined(env.MOSAIC_MCP_TOKEN_PEPPER),
        clerkPublishableKey: emptyToUndefined(env.CLERK_PUBLISHABLE_KEY),
        clerkIssuer: emptyToUndefined(env.CLERK_ISSUER),
        clerkJwtKey: normalizePem(emptyToUndefined(env.CLERK_JWT_KEY)),
        clerkAuthorizedParties: parseCsv(env.CLERK_AUTHORIZED_PARTIES),
        featureFlags: resolveApiFeatureFlags(env),
    };
    validateMcpConfig(config);
    return config;
}

export interface IMcpOAuthConfig {
    resourceUrl: string;
    issuer: string;
    secretKey: string;
    publishableKey: string;
    jwtKey: string;
    clientId?: string;
    dynamicClients: boolean;
    authorizedParties?: string[];
}

export function resolveMcpOAuthConfig(
    config: IApiConfig,
): IMcpOAuthConfig | undefined {
    if (!config.mosaicMcpEnabled) return undefined;
    const hasAnyOAuthInput = Boolean(
        config.mosaicMcpResourceUrl ||
        config.mosaicMcpOAuthClientId ||
        config.mosaicMcpOAuthDynamicClients ||
        config.clerkIssuer ||
        config.clerkJwtKey ||
        config.clerkPublishableKey,
    );
    if (!hasAnyOAuthInput) return undefined;

    const env = requiredMcpOAuthEnv(config);
    if (
        !config.mosaicMcpOAuthClientId &&
        !config.mosaicMcpOAuthDynamicClients
    ) {
        throw new ConfigError(
            "Missing required MCP OAuth env: MOSAIC_MCP_OAUTH_CLIENT_ID or MOSAIC_MCP_OAUTH_DYNAMIC_CLIENTS=true",
        );
    }
    let parsed: URL;
    try {
        parsed = new URL(env.resourceUrl);
    } catch {
        throw new ConfigError(
            "MOSAIC_MCP_RESOURCE_URL must be an absolute URL.",
        );
    }
    if (config.nodeEnv === "production" && parsed.protocol !== "https:") {
        throw new ConfigError(
            "MOSAIC_MCP_RESOURCE_URL must use https in production.",
        );
    }

    return {
        resourceUrl: env.resourceUrl,
        issuer: env.issuer,
        secretKey: env.secretKey,
        publishableKey: env.publishableKey,
        jwtKey: env.jwtKey,
        ...(config.mosaicMcpOAuthClientId
            ? { clientId: config.mosaicMcpOAuthClientId }
            : {}),
        dynamicClients: Boolean(config.mosaicMcpOAuthDynamicClients),
        ...(config.clerkAuthorizedParties &&
        config.clerkAuthorizedParties.length > 0
            ? { authorizedParties: config.clerkAuthorizedParties }
            : {}),
    };
}

function validateMcpConfig(config: IApiConfig): void {
    if (
        config.nodeEnv === "production" &&
        config.mosaicMcpRawTokenFallbackEnabled
    ) {
        throw new ConfigError(
            "MOSAIC_MCP_RAW_TOKEN_FALLBACK_ENABLED cannot be enabled in production.",
        );
    }
    resolveMcpOAuthConfig(config);
}

function requiredMcpOAuthEnv(config: IApiConfig): {
    resourceUrl: string;
    issuer: string;
    secretKey: string;
    publishableKey: string;
    jwtKey: string;
} {
    const entries = [
        ["MOSAIC_MCP_RESOURCE_URL", config.mosaicMcpResourceUrl],
        ["CLERK_ISSUER", config.clerkIssuer],
        ["CLERK_SECRET_KEY", config.clerkSecretKey],
        ["CLERK_PUBLISHABLE_KEY", config.clerkPublishableKey],
        ["CLERK_JWT_KEY", config.clerkJwtKey],
    ] as const;
    const missing = entries.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
        throw new ConfigError(
            `Missing required MCP OAuth env: ${missing.join(", ")}`,
        );
    }

    return {
        resourceUrl: config.mosaicMcpResourceUrl!,
        issuer: config.clerkIssuer!,
        secretKey: config.clerkSecretKey,
        publishableKey: config.clerkPublishableKey!,
        jwtKey: config.clerkJwtKey!,
    };
}

function parseSttCapabilityProbes(
    raw: string | undefined,
): SttCapabilityProbeResults {
    if (!raw?.trim()) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new ConfigError(
            "MOSAIC_STT_CAPABILITY_PROBES must be valid JSON",
        );
    }
    if (!isRecord(parsed)) {
        throw new ConfigError(
            "MOSAIC_STT_CAPABILITY_PROBES must be a JSON object",
        );
    }
    const results: SttCapabilityProbeResults = {};
    for (const [modelId, value] of Object.entries(parsed)) {
        if (!isRecord(value) || typeof value.status !== "string") {
            throw new ConfigError(
                `MOSAIC_STT_CAPABILITY_PROBES.${modelId} must include a status`,
            );
        }
        if (!isSttProbeStatus(value.status)) {
            throw new ConfigError(
                `MOSAIC_STT_CAPABILITY_PROBES.${modelId}.status is not supported`,
            );
        }
        results[modelId] = {
            status: value.status,
            ...(typeof value.reason === "string" && value.reason.trim()
                ? { reason: value.reason.trim() }
                : {}),
        };
    }
    return results;
}

function isSttProbeStatus(
    status: string,
): status is SttCapabilityProbeResults[string]["status"] {
    return [
        "available",
        "provider_error",
        "unsupported_input",
        "unverified_route",
    ].includes(status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Opt-in for dev-only defaults that are unsafe on a reachable host. Keyed on an
// explicit flag rather than NODE_ENV, which self-hosted deploys often leave unset.
function allowInsecureDevDefaults(env: Env): boolean {
    const allowed = parseBoolean(env.MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS, false);
    if (allowed && env.NODE_ENV === "production") {
        throw new ConfigError(
            "MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS cannot be enabled when NODE_ENV=production",
        );
    }
    return allowed;
}

function parseStorageAdapter(env: Env): "local" | "supabase" | "r2" {
    const insecureDefaults = allowInsecureDevDefaults(env);
    const requested = (
        env.MOSAIC_STORAGE_ADAPTER ??
        env.MOSAIC_IMAGE_STORAGE_ADAPTER ??
        ""
    )
        .trim()
        .toLowerCase();
    if (requested === "local") {
        // The local adapter accepts unauthenticated uploads to disk.
        if (!insecureDefaults) {
            throw new ConfigError(
                "MOSAIC_STORAGE_ADAPTER=local requires MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS=true",
            );
        }
        return "local";
    }
    if (requested === "supabase") return "supabase";
    if (requested === "r2") return "r2";
    if (requested) {
        throw new ConfigError(
            `Unsupported MOSAIC_STORAGE_ADAPTER value: ${requested}`,
        );
    }
    return insecureDefaults ? "local" : "supabase";
}

function parseProviderMode(raw: string | undefined): EvalProviderMode {
    const mode = raw?.trim();
    if (!mode) return "auto";
    if (
        mode === "auto" ||
        mode === "vercel-ai" ||
        mode === "openai" ||
        mode === "gateway" ||
        mode === "openrouter" ||
        mode === "bifrost"
    ) {
        return mode;
    }
    throw new ConfigError(
        `Invalid MOSAIC_LLM_PROVIDER value "${raw}". Expected one of: auto, vercel-ai, openai, gateway, openrouter, bifrost.`,
    );
}

function validateSingleOrgDomain(env: Env, domain: string): void {
    if (!domain && !allowInsecureDevDefaults(env)) {
        throw new ConfigError(
            "Missing required API env: MOSAIC_ALLOWED_EMAIL_DOMAIN (the one email domain allowed to sign in, e.g. example.com)",
        );
    }
    if (
        domain &&
        isPublicEmailDomain(domain) &&
        !parseBoolean(env.MOSAIC_ALLOW_PUBLIC_EMAIL_DOMAIN, false)
    ) {
        throw new ConfigError(
            `MOSAIC_ALLOWED_EMAIL_DOMAIN="${domain}" is a public email provider — ` +
                "every signup from it would share one team with every stranger who " +
                "also has an account there. Use your organization's own domain, or " +
                "set MOSAIC_ALLOW_PUBLIC_EMAIL_DOMAIN=true to override.",
        );
    }
}

function parseTenancyMode(raw: string | undefined): MosaicTenancyMode {
    const mode = raw?.trim().toLowerCase();
    if (!mode || mode === "single-org") return "single-org";
    if (mode === "isolated") return "isolated";
    throw new ConfigError(
        `Invalid MOSAIC_TENANCY_MODE value "${raw}". Expected "single-org" or "isolated".`,
    );
}

// Free providers where "the domain matches" says nothing about being one
// organization. Not exhaustive — an intentional override exists for the rest.
const PUBLIC_EMAIL_DOMAINS = new Set([
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "ymail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "aol.com",
    "protonmail.com",
    "proton.me",
    "gmx.com",
    "mail.com",
    "zoho.com",
    "yandex.com",
]);

function isPublicEmailDomain(domain: string): boolean {
    return PUBLIC_EMAIL_DOMAINS.has(domain);
}

function allowedEmailDomain(env: Env): string {
    // No default. getApiConfig refuses to start without it unless
    // MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS is set, in which case sign-in is
    // refused for every account.
    return (env.MOSAIC_ALLOWED_EMAIL_DOMAIN ?? "")
        .trim()
        .toLowerCase()
        .replace(/^@/, "");
}

function parsePort(raw: string | undefined): number {
    if (!raw) return 3001;
    const port = Number(raw);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
        throw new ConfigError("PORT must be an integer between 1 and 65535");
    }
    return port;
}

// Run cells are inserted in one statement with four parameters each, and
// Postgres allows at most 65535 parameters per statement.
const MAX_RUN_CELLS_CEILING = 16_000;
export const DEFAULT_MAX_RUN_CELLS = 10_000;

function parseMaxRunCells(raw: string | undefined): number {
    if (!raw?.trim()) return DEFAULT_MAX_RUN_CELLS;
    const value = Number(raw);
    if (
        !Number.isInteger(value) ||
        value < 1 ||
        value > MAX_RUN_CELLS_CEILING
    ) {
        throw new ConfigError(
            `MOSAIC_MAX_RUN_CELLS must be an integer between 1 and ${MAX_RUN_CELLS_CEILING}`,
        );
    }
    return value;
}

function parseSpendCap(raw: string | undefined): number | undefined {
    if (!raw?.trim()) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        throw new ConfigError(
            "MOSAIC_TEAM_DAILY_SPEND_CAP_USD must be a positive number",
        );
    }
    return value;
}

function parseRateLimit(
    name: string,
    raw: string | undefined,
): number | undefined {
    if (!raw?.trim()) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
        throw new ConfigError(
            `${name} must be a non-negative integer (0 disables it)`,
        );
    }
    return value;
}

function parseOptionalInteger(raw: string | undefined): number | undefined {
    if (!raw?.trim()) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0)
        throw new ConfigError(
            "MOSAIC_WORKFLOW_LLM_WORKER_CONTRACT_VERSION must be a positive integer",
        );
    return value;
}

function parseCsv(raw: string | undefined): string[] {
    return (raw ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
}

function nonEmpty(value: string | undefined): boolean {
    return Boolean(value?.trim());
}

function emptyToUndefined(value: string | undefined): string | undefined {
    return nonEmpty(value) ? value : undefined;
}

function normalizePem(value: string | undefined): string | undefined {
    return value?.replace(/\\n/g, "\n");
}

function parseBoolean(
    value: string | undefined,
    defaultValue: boolean,
): boolean {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return defaultValue;
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return defaultValue;
}
