export function canonicalJsonObject(
    value: Record<string, unknown>,
): Record<string, unknown> {
    return Object.keys(value)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
            result[key] = canonicalJsonValue(value[key]);
            return result;
        }, {});
}

export function canonicalJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalJsonValue);
    if (!isRecord(value)) return value;
    return canonicalJsonObject(value);
}

export function canonicalJsonString(value: unknown): string {
    return JSON.stringify(canonicalJsonValue(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
