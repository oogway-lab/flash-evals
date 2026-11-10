import {
    evalTransportFor,
    getEvalProvider,
    type ApiKeys,
    type CompletionRequest,
    type CompletionResult,
    type IEvalCompletionProvider,
    type IEvalProviderOptions,
} from "@flash-evals/llm-core";
import { PROVIDER_TRANSPORTS } from "@flash-evals/api-contract";
import { createSemaphore } from "../lib/concurrency";
import { logWorkerEvent } from "../jobs/workerObservability";

/** Model calls in flight at once per provider, across this process's runs. */
export const DEFAULT_PROVIDER_CONCURRENCY = 5;
const MAX_PROVIDER_CONCURRENCY = 100;

export interface IProviderConcurrency {
    defaultLimit: number;
    byTransport: Record<string, number>;
}

/** A whole positive number ("10", not "10abc" or "2.5"), capped. */
function positiveLimit(raw: string | undefined): number | undefined {
    if (!/^\d+$/.test(raw ?? "")) return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value > 0
        ? Math.min(value, MAX_PROVIDER_CONCURRENCY)
        : undefined;
}

interface IConcurrencyPart {
    /** Lower-cased provider name; undefined for the every-provider number. */
    name: string | undefined;
    limit: number | undefined;
    text: string;
}

function concurrencyParts(value: string | undefined): IConcurrencyPart[] {
    return (value ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((text) => {
            const [name, raw] = text.includes("=")
                ? text.split("=", 2).map((piece) => piece.trim())
                : [undefined, text];
            return {
                name: name ? name.toLowerCase() : undefined,
                limit: positiveLimit(raw),
                text,
            };
        });
}

/**
 * Reads `FLASH_EVALS_PROVIDER_CONCURRENCY`: a number for every provider,
 * optionally followed by per-provider overrides, e.g. `5,openrouter=10`.
 * Provider names are case-insensitive. Values that are not whole positive
 * numbers are ignored (see `providerConcurrencyWarnings`).
 */
export function parseProviderConcurrency(
    value: string | undefined,
): IProviderConcurrency {
    let defaultLimit = DEFAULT_PROVIDER_CONCURRENCY;
    const byTransport: Record<string, number> = {};
    for (const { name, limit } of concurrencyParts(value)) {
        if (limit === undefined) continue;
        if (name) byTransport[name] = limit;
        else defaultLimit = limit;
    }
    return { defaultLimit, byTransport };
}

/** Parts of the setting that are ignored: bad numbers, unknown providers. */
export function providerConcurrencyWarnings(
    value: string | undefined,
): string[] {
    const known = new Set<string>(PROVIDER_TRANSPORTS);
    const warnings: string[] = [];
    for (const { name, limit, text } of concurrencyParts(value)) {
        if (limit === undefined)
            warnings.push(`"${text}" is not a whole positive number`);
        else if (name && !known.has(name))
            warnings.push(
                `"${name}" is not a known provider (${[...known].join(", ")})`,
            );
    }
    return warnings;
}

/** Logs, once at worker start, the parts of the setting that are ignored. */
export function warnAboutProviderConcurrency(
    value = process.env.FLASH_EVALS_PROVIDER_CONCURRENCY,
): void {
    for (const warning of providerConcurrencyWarnings(value))
        logWorkerEvent("warn", "provider_concurrency.ignored", {
            setting: "FLASH_EVALS_PROVIDER_CONCURRENCY",
            warning,
        });
}

const semaphores = new Map<string, ReturnType<typeof createSemaphore>>();

function semaphoreFor(transport: string) {
    let semaphore = semaphores.get(transport);
    if (!semaphore) {
        semaphore = createSemaphore(() => {
            const config = parseProviderConcurrency(
                process.env.FLASH_EVALS_PROVIDER_CONCURRENCY,
            );
            return config.byTransport[transport] ?? config.defaultLimit;
        });
        semaphores.set(transport, semaphore);
    }
    return semaphore;
}

/**
 * `getEvalProvider` with a cap on calls in flight per provider (transport),
 * shared by every run in this process. Generation and judge calls queue for
 * the same provider's slots, so a run's judges cannot add a burst on top of
 * its model calls. The provider SDKs' own retries (network errors, 429 and
 * 5xx) happen inside a slot; nothing here retries, and an answer cut off by
 * the output limit is never retried.
 */
export function getLimitedEvalProvider(
    apiKeys: ApiKeys,
    options: IEvalProviderOptions = {},
): IEvalCompletionProvider {
    const provider = getEvalProvider(apiKeys, options);
    return {
        async complete(req: CompletionRequest): Promise<CompletionResult> {
            const transport =
                evalTransportFor(req.model, apiKeys, options, req.dataPolicy) ??
                "unknown";
            const release = await semaphoreFor(transport).acquire();
            try {
                return await provider.complete(req);
            } finally {
                release();
            }
        },
    };
}
