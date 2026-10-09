import {
    formatLabelError,
    parseGoldenLabel,
    validateLabel,
} from "./schemaForm";
import type { DatasetPurpose } from "./service";
import { resolveAnswerSchema } from "./answerSchema";
import type { ParsedLabelResult } from "./labelPolicy";

export async function parseAndValidateLabelForDataset(
    datasetId: string,
    dataset: { purpose: DatasetPurpose; pipelineId: string | null },
    rawLabel: string,
): Promise<ParsedLabelResult> {
    const resolved = await resolveAnswerSchema(datasetId, dataset);
    if (!resolved.ok) {
        return { ok: false, formError: resolved.error };
    }

    if (resolved.mode === "independent" || resolved.mode === "evaluation") {
        const parsed = parseGoldenLabel(rawLabel);
        if (!parsed.ok) {
            return { ok: false, fieldErrors: { label: [parsed.error] } };
        }
        return { ok: true, label: parsed.label };
    }

    const trimmed = rawLabel.trim();
    if (!trimmed) {
        return { ok: false, fieldErrors: { label: ["Invalid JSON in \"label\""] } };
    }

    let label: Record<string, unknown>;
    try {
        label = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
        return { ok: false, fieldErrors: { label: ["Invalid JSON in \"label\""] } };
    }

    const schema = resolved.answerSchema ?? resolved.importSchema;
    const labelErrors = validateLabel(label, schema);
    if (labelErrors.length > 0) {
        return {
            ok: false,
            fieldErrors: labelErrors.reduce<Record<string, string[]>>((acc, error) => {
                acc[error.field] = [
                    ...(acc[error.field] ?? []),
                    formatLabelError(error),
                ];
                return acc;
            }, {}),
        };
    }

    return { ok: true, label };
}