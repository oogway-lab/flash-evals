import type { DatasetPurpose } from "./service";

export type DatasetLabelMode =
    | "evaluation"
    | "independent"
    | "pipeline"
    | "legacySchema";

export interface IDatasetLabelContext {
    purpose: DatasetPurpose;
    pipelineId: string | null;
    hasLegacySchema: boolean;
}

export function resolveLabelMode(ctx: IDatasetLabelContext): DatasetLabelMode {
    if (ctx.purpose === "evaluation") return "evaluation";
    if (ctx.pipelineId) return "pipeline";
    if (ctx.hasLegacySchema) return "legacySchema";
    return "independent";
}

export function usesFreeformLabel(mode: DatasetLabelMode): boolean {
    // Evaluation datasets have no answer schema, so expected outputs are entered
    // as freeform JSON — same as schema-free golden (independent) datasets.
    return mode === "independent" || mode === "evaluation";
}

export type ParsedLabelResult =
    | { ok: true; label: Record<string, unknown> }
    | { ok: false; fieldErrors?: Record<string, string[]>; formError?: string };