import type { IApiConfig } from "./config.js";
import type { IDb } from "./db.js";
import {
    observabilityStatus,
    type IObservabilityStatus,
} from "./observability/integrations.js";
import {
    runtimeMetricsSnapshot,
    type IRuntimeMetricsSnapshot,
} from "./observability/metrics.js";
import { sttModelOptions } from "./sttModels.js";
import {
    globalStoredSttProviders,
    globalSttCapabilityProbes,
} from "./routes/sttProbes.js";
import type { SttProviderId } from "@mosaic/api-contract";

export interface IHealthPayload {
    status: "ok" | "degraded";
    service: "mosaic-api";
    storage: "local" | "supabase";
    database: "supabase-postgres";
    checks: {
        database: "ok" | "error";
        storage: "ok" | "error";
    };
    railwayVolumeRequired: false;
    environment: string;
    observability: IObservabilityStatus;
    stt: ISttHealthStatus;
    featureFlags: IApiConfig["featureFlags"];
    metrics: IRuntimeMetricsSnapshot;
}

export interface ISttHealthStatus {
    providers: Array<{
        providerId: SttProviderId;
        keyConfigured: boolean;
        availableModels: number;
        missingKeyModels: number;
        unverifiedModels: number;
        providerErrorModels: number;
        unsupportedInputModels: number;
    }>;
    probesConfigured: number;
}

/** Unauthenticated `/health` response: liveness only, no config detail. */
export interface IPublicHealthPayload {
    status: IHealthPayload["status"];
}

export async function publicHealthPayload(
    config: IApiConfig,
    db: IDb,
): Promise<IPublicHealthPayload> {
    const [database, storage] = await Promise.all([
        checkDatabase(db),
        checkStorage(config),
    ]);
    return {
        status: database === "ok" && storage === "ok" ? "ok" : "degraded",
    };
}

/**
 * Detailed health for internal callers (requires the internal API token):
 * environment, storage adapter, feature flags, STT readiness, and metrics.
 */
export async function healthPayload(
    config: IApiConfig,
    db: IDb,
): Promise<IHealthPayload> {
    const [database, storage, sttProbes, storedSttProviders] =
        await Promise.all([
            checkDatabase(db),
            checkStorage(config),
            globalSttCapabilityProbes(db, config.sttCapabilityProbes).catch(
                () => config.sttCapabilityProbes,
            ),
            globalStoredSttProviders(db).catch(() => new Set<string>()),
        ]);
    const status = database === "ok" && storage === "ok" ? "ok" : "degraded";

    return {
        status,
        service: "mosaic-api",
        storage: config.storageAdapter,
        database: "supabase-postgres",
        checks: { database, storage },
        railwayVolumeRequired: false,
        environment: config.nodeEnv,
        observability: observabilityStatus(config),
        stt: sttHealthStatus(
            configWithStoredProviderKeys(config, storedSttProviders),
            sttProbes,
        ),
        featureFlags: config.featureFlags,
        metrics: runtimeMetricsSnapshot(),
    };
}

function configWithStoredProviderKeys(
    config: IApiConfig,
    providers: Set<string>,
): IApiConfig {
    return {
        ...config,
        openaiApiKey: config.openaiApiKey ?? storedKey(providers, "openai"),
        aiGatewayApiKey:
            config.aiGatewayApiKey ?? storedKey(providers, "gateway"),
        sonioxApiKey: config.sonioxApiKey ?? storedKey(providers, "soniox"),
        geminiApiKey: config.geminiApiKey ?? storedKey(providers, "gemini"),
        openrouterApiKey:
            config.openrouterApiKey ?? storedKey(providers, "openrouter"),
        bifrostApiKey: config.bifrostApiKey ?? storedKey(providers, "bifrost"),
    };
}

function storedKey(
    providers: Set<string>,
    provider: string,
): string | undefined {
    return providers.has(provider) ? "stored" : undefined;
}

function sttHealthStatus(
    config: IApiConfig,
    probes: IApiConfig["sttCapabilityProbes"],
): ISttHealthStatus {
    const providerKeys = new Map<SttProviderId, boolean>([
        ["openai", Boolean(config.openaiApiKey)],
        ["vercel-gateway", Boolean(config.aiGatewayApiKey)],
        ["soniox", Boolean(config.sonioxApiKey)],
        ["gemini", Boolean(config.geminiApiKey)],
        ["openrouter", Boolean(config.openrouterApiKey)],
        ["bifrost", Boolean(config.bifrostApiKey)],
    ]);
    const summaries = new Map<
        SttProviderId,
        {
            providerId: SttProviderId;
            keyConfigured: boolean;
            availableModels: number;
            missingKeyModels: number;
            unverifiedModels: number;
            providerErrorModels: number;
            unsupportedInputModels: number;
        }
    >();
    for (const option of sttModelOptions(config, probes)) {
        const providerId = option.providerId ?? "openai";
        const summary = summaries.get(providerId) ?? {
            providerId,
            keyConfigured: providerKeys.get(providerId) ?? false,
            availableModels: 0,
            missingKeyModels: 0,
            unverifiedModels: 0,
            providerErrorModels: 0,
            unsupportedInputModels: 0,
        };
        if (option.availabilityStatus === "available") {
            summary.availableModels += 1;
        } else if (option.availabilityStatus === "missing_key") {
            summary.missingKeyModels += 1;
        } else if (option.availabilityStatus === "provider_error") {
            summary.providerErrorModels += 1;
        } else if (option.availabilityStatus === "unsupported_input") {
            summary.unsupportedInputModels += 1;
        } else {
            summary.unverifiedModels += 1;
        }
        summaries.set(providerId, summary);
    }
    return {
        providers: [...summaries.values()],
        probesConfigured: Object.keys(probes).length,
    };
}

async function checkDatabase(db: IDb): Promise<"ok" | "error"> {
    try {
        await db.query("select 1");
        return "ok";
    } catch {
        return "error";
    }
}

async function checkStorage(config: IApiConfig): Promise<"ok" | "error"> {
    if (config.storageAdapter === "local") return "ok";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
        const bucket = encodeURIComponent(config.supabaseStorageBucket);
        const url = `${config.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/list/${bucket}`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                apikey: config.supabaseServiceRoleKey,
                Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prefix: config.supabaseStoragePrefix ?? "",
                limit: 1,
            }),
            signal: controller.signal,
        });
        return response.ok ? "ok" : "error";
    } catch {
        return "error";
    } finally {
        clearTimeout(timeout);
    }
}
