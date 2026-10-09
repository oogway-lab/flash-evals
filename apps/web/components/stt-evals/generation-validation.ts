export interface IGenerationFieldValues {
    maxOutputTokens: string;
    timeoutMs: string;
    temperature: string;
    topP: string;
    seed: string;
    maxAttempts?: string;
}

export type GenerationField = keyof IGenerationFieldValues;

function isWholeAtLeastOne(value: string) {
    const parsed = Number(value);
    return value.trim() !== "" && Number.isInteger(parsed) && parsed >= 1;
}

function inRange(value: string, min: number, max: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max;
}

/**
 * Field errors for a node's generation settings. Empty optional fields mean
 * "provider default"; anything else must be valid rather than being silently
 * replaced by a fallback when the route is created.
 */
export function validateGenerationFields(
    values: IGenerationFieldValues,
): Partial<Record<GenerationField, string>> {
    const errors: Partial<Record<GenerationField, string>> = {};
    if (!isWholeAtLeastOne(values.maxOutputTokens)) {
        errors.maxOutputTokens = "Enter a whole number of at least 1.";
    }
    if (!isWholeAtLeastOne(values.timeoutMs)) {
        errors.timeoutMs = "Enter a timeout of at least 1 ms.";
    }
    if (values.temperature.trim() && !inRange(values.temperature, 0, 2)) {
        errors.temperature = "Temperature must be between 0 and 2.";
    }
    if (values.topP.trim() && !inRange(values.topP, 0, 1)) {
        errors.topP = "Top P must be between 0 and 1.";
    }
    if (values.seed.trim() && !Number.isInteger(Number(values.seed))) {
        errors.seed = "Seed must be a whole number.";
    }
    if (
        values.maxAttempts !== undefined &&
        !isWholeAtLeastOne(values.maxAttempts)
    ) {
        errors.maxAttempts = "Enter at least 1 attempt.";
    }
    return errors;
}
