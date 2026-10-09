import {
    getPipeline,
    pipelineFactualDescriptors,
} from "../pipelines/service";
import type { IParsedSchemaDescriptor } from "../db/jsonTypes";
import { getDatasetSchema } from "./service";
import { parseSchema } from "./schemaForm";
import type { DatasetPurpose } from "./service";
import {
    resolveLabelMode,
    usesFreeformLabel,
    type DatasetLabelMode,
} from "./labelPolicy";

const EMPTY_IMPORT_SCHEMA: IParsedSchemaDescriptor = {
    fields: [],
    additionalProperties: true,
};

export type AnswerSchemaResult =
    | {
          ok: true;
          mode: DatasetLabelMode;
          answerSchema: IParsedSchemaDescriptor | undefined;
          importSchema: IParsedSchemaDescriptor;
          freeformLabel: boolean;
      }
    | { ok: false; mode: DatasetLabelMode; error: string };

export async function resolveAnswerSchema(
    datasetId: string,
    dataset: { purpose: DatasetPurpose; pipelineId: string | null },
): Promise<AnswerSchemaResult> {
    const schemaRow = await getDatasetSchema(datasetId);
    const mode = resolveLabelMode({
        purpose: dataset.purpose,
        pipelineId: dataset.pipelineId,
        hasLegacySchema: Boolean(schemaRow),
    });

    if (mode === "evaluation" || mode === "independent") {
        return {
            ok: true,
            mode,
            answerSchema: undefined,
            importSchema: EMPTY_IMPORT_SCHEMA,
            freeformLabel: usesFreeformLabel(mode),
        };
    }

    if (mode === "pipeline") {
        const pipeline = await getPipeline(dataset.pipelineId!);
        if (!pipeline) {
            return { ok: false, mode, error: "Pipeline not found." };
        }
        const answerSchema: IParsedSchemaDescriptor = {
            fields: pipelineFactualDescriptors(
                pipeline.outputSchema,
                pipeline.fieldConfigs,
            ),
            additionalProperties: true,
        };
        return {
            ok: true,
            mode,
            answerSchema,
            importSchema: answerSchema,
            freeformLabel: false,
        };
    }

    if (!schemaRow) {
        return { ok: false, mode, error: "Dataset schema not found." };
    }
    const parsedSchema = parseSchema(schemaRow.jsonSchema);
    if (!parsedSchema.ok) {
        return { ok: false, mode, error: parsedSchema.error };
    }
    return {
        ok: true,
        mode,
        answerSchema: parsedSchema.schema,
        importSchema: parsedSchema.schema,
        freeformLabel: false,
    };
}