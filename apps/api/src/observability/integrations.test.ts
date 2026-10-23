import { describe, expect, it } from "vitest";
import type { IApiConfig } from "../config.js";
import { resolveApiFeatureFlags } from "../featureFlags.js";
import { observabilityStatus } from "./integrations.js";

const baseConfig: IApiConfig = {
    nodeEnv: "test",
    port: 3001,
    databaseUrl: "postgres://user:pass@example.supabase.co:5432/postgres",
    storageAdapter: "supabase",
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role",
    supabaseStorageBucket: "flash-evals-images",
    clerkSecretKey: "sk_test",
    flashEvalsTenancyMode: "single-org",
    flashEvalsAllowedEmailDomain: "example.com",
    corsOrigins: ["https://web.example.com"],
    flashEvalsLlmProvider: "openai",
    internalApiToken: "internal-secret",
    sttCapabilityProbes: {},
    profilingEnabled: false,
    featureFlags: resolveApiFeatureFlags({}),
};

describe("observabilityStatus", () => {
    it("marks provider shells as configured instead of fully enabled", () => {
        expect(
            observabilityStatus({
                ...baseConfig,
                errorTrackingDsn: "https://errors.example",
                analyticsKey: "analytics-key",
                alertWebhookUrl: "https://alerts.example",
                profilingEnabled: true,
                featureFlags: resolveApiFeatureFlags({
                    FLASH_EVALS_FLAG_ANALYTICS_EVENTS: "true",
                    FLASH_EVALS_FLAG_ERROR_TRACKING: "true",
                    FLASH_EVALS_FLAG_PROFILING: "true",
                }),
            }),
        ).toEqual({
            errorTracking: "configured",
            analytics: "configured",
            alerting: "enabled",
            profiling: "configured",
        });
    });
});
