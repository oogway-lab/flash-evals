import type { IApiConfig } from "../config.js";
import { logApiEvent } from "./logger.js";

export type ObservabilityProviderState = "enabled" | "configured" | "disabled";

export interface IObservabilityStatus {
    errorTracking: ObservabilityProviderState;
    analytics: ObservabilityProviderState;
    alerting: "enabled" | "disabled";
    profiling: ObservabilityProviderState;
}

export interface IErrorTrackingContext {
    requestId?: string;
    route?: string;
    method?: string;
}

export function observabilityStatus(config: IApiConfig): IObservabilityStatus {
    return {
        errorTracking:
            config.featureFlags.errorTracking && config.errorTrackingDsn
                ? "configured"
                : "disabled",
        analytics:
            config.featureFlags.analyticsEvents && config.analyticsKey
                ? "configured"
                : "disabled",
        alerting: config.alertWebhookUrl ? "enabled" : "disabled",
        profiling:
            config.featureFlags.profiling && config.profilingEnabled
                ? "configured"
                : "disabled",
    };
}

export function captureApiException(
    config: IApiConfig,
    error: unknown,
    context: IErrorTrackingContext = {},
): void {
    if (!config.featureFlags.errorTracking || !config.errorTrackingDsn) return;

    logApiEvent("error", "error_tracking.capture", {
        requestId: context.requestId,
        route: context.route,
        method: context.method,
        errorName: error instanceof Error ? error.name : "UnknownError",
    });
}

export function notifyApiAlert(
    config: IApiConfig,
    message: string,
    metadata: Record<string, string | number | boolean | undefined> = {},
): void {
    if (!config.alertWebhookUrl) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    void fetch(config.alertWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            service: "mosaic-api",
            message,
            ...metadata,
        }),
        signal: controller.signal,
    })
        .then((response) => {
            logApiEvent(response.ok ? "warn" : "error", "alert.dispatch", {
                message,
                status: response.status,
                delivered: response.ok,
                ...metadata,
            });
        })
        .catch((error: unknown) => {
            logApiEvent("error", "alert.dispatch_failed", {
                message,
                errorName: error instanceof Error ? error.name : "UnknownError",
                ...metadata,
            });
        })
        .finally(() => clearTimeout(timeout));
}
