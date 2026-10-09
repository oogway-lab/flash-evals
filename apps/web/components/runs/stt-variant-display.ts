import {
    canonicalJsonString,
    parseSttMetricsModelId,
    sttMetricsModelId,
    type IRunAudioTranscriptSummary,
    type IRunConfigSnapshot,
    type ISttRunVariant,
} from "@mosaic/api-contract";

export interface ISttVariantDisplay {
    variantKey: string;
    label: string;
    baseModelId: string;
    diffBadges: string[];
}

export function sttVariantDisplayForTranscript(
    snapshot: IRunConfigSnapshot,
    transcript: Pick<
        IRunAudioTranscriptSummary,
        "sttModelId" | "language" | "configJson"
    >,
): ISttVariantDisplay | undefined {
    return sttVariantDisplaysForTranscript(snapshot, transcript)[0];
}

export function sttVariantDisplaysForTranscript(
    snapshot: IRunConfigSnapshot,
    transcript: Pick<
        IRunAudioTranscriptSummary,
        "sttModelId" | "language" | "configJson"
    >,
): ISttVariantDisplay[] {
    const matches = Object.values(snapshot.sttVariants ?? {}).filter(
        (variant) =>
            variant.config.modelId === transcript.sttModelId &&
            (variant.config.language?.trim().toLowerCase() ?? "") ===
                transcript.language.trim().toLowerCase() &&
            canonicalJsonString(variant.config.config ?? {}) ===
                canonicalJsonString(transcript.configJson),
    );
    return matches.flatMap((match) => {
        const display = sttVariantDisplay(
            snapshot,
            sttMetricsModelId(match.config.modelId, match.variantKey),
        );
        return display ? [display] : [];
    });
}

export function sttVariantDisplay(
    snapshot: IRunConfigSnapshot,
    syntheticModelId: string,
): ISttVariantDisplay | undefined {
    const parsed = parseSttMetricsModelId(syntheticModelId);
    if (!parsed?.variantKey) return undefined;
    const current = snapshot.sttVariants?.[parsed.variantKey];
    if (!current) return undefined;
    const siblings = Object.values(snapshot.sttVariants ?? {}).filter(
        (variant) => variant.config.modelId === current.config.modelId,
    );
    return {
        variantKey: current.variantKey,
        label: current.label,
        baseModelId: parsed.modelId,
        diffBadges: differingConfigBadges(current, siblings),
    };
}

function differingConfigBadges(
    current: ISttRunVariant,
    siblings: ISttRunVariant[],
): string[] {
    if (siblings.length < 2) return [];
    const flattened = siblings.map((variant) => flattenConfig(variant.config));
    const currentConfig = flattenConfig(current.config);
    const keys = new Set(flattened.flatMap((config) => [...config.keys()]));
    return [...keys]
        .filter((key) => {
            const values = new Set(
                flattened.map((config) => stableValue(config.get(key))),
            );
            return values.size > 1;
        })
        .sort()
        .map((key) => {
            const value = currentConfig.get(key);
            return `${formatKey(key)}: ${formatValue(value)}`;
        });
}

function flattenConfig(value: unknown, prefix = ""): Map<string, unknown> {
    const result = new Map<string, unknown>();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        if (prefix) result.set(prefix, value);
        return result;
    }
    for (const [key, child] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (child && typeof child === "object" && !Array.isArray(child)) {
            for (const [nestedKey, nestedValue] of flattenConfig(child, path)) {
                result.set(nestedKey, nestedValue);
            }
        } else {
            result.set(path, child);
        }
    }
    return result;
}

function stableValue(value: unknown): string {
    return value === undefined ? "__undefined__" : JSON.stringify(value);
}

function formatKey(key: string): string {
    return key
        .replace(/^config\./, "")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\./g, " · ")
        .toLowerCase();
}

function formatValue(value: unknown): string {
    if (value === undefined) return "default";
    if (typeof value === "boolean") return value ? "on" : "off";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "string" || typeof value === "number") {
        return String(value);
    }
    return JSON.stringify(value);
}
