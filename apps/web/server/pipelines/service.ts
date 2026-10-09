import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { datasets, pipelines } from "../db/schema";
import type {
    FieldMatcherSpec,
    FieldRule,
    IPipelineFieldConfig,
    ISchemaFieldDescriptor,
    JsonSchemaObject,
} from "../db/jsonTypes";
import { parseSchema } from "../datasets/schemaForm";
import { isRecord } from "../lib/objects";
import { extractSchemaPaths } from "../prompts/schemaValidation";

export function specFromRule(rule: FieldRule): FieldMatcherSpec {
    if (rule.matcher === "numeric_tolerance") {
        return {
            matcher: "numeric_tolerance",
            tolerance: rule.tolerance,
            relative: rule.relative,
        };
    }
    if (rule.matcher === "set_overlap") return { matcher: "set_overlap" };
    return { matcher: "exact" };
}

export function ruleFromConfig(config: IPipelineFieldConfig): FieldRule | undefined {
    if (config.kind !== "factual" || !config.spec) return undefined;
    const spec = config.spec;
    if (spec.matcher === "numeric_tolerance") {
        return {
            field: config.field,
            matcher: "numeric_tolerance",
            tolerance: spec.tolerance,
            relative: spec.relative,
        };
    }
    if (spec.matcher === "set_overlap") {
        return { field: config.field, matcher: "set_overlap" };
    }
    return { field: config.field, matcher: "exact" };
}

export function fieldConfigsFromSchema(
    jsonSchema: JsonSchemaObject,
    fieldRules: FieldRule[],
): IPipelineFieldConfig[] {
    const props = isRecord(jsonSchema.properties)
        ? Object.keys(jsonSchema.properties)
        : [];
    const ruleByField = new Map(fieldRules.map((rule) => [rule.field, rule]));
    return props.map((field) => {
        const rule = ruleByField.get(field);
        return rule
            ? { field, kind: "factual", spec: specFromRule(rule) }
            : { field, kind: "factual" };
    });
}

export interface ISplitFields {
    factual: IPipelineFieldConfig[];
    generative: IPipelineFieldConfig[];
}

export function splitPipelineFields(
    fieldConfigs: IPipelineFieldConfig[],
): ISplitFields {
    return {
        factual: fieldConfigs.filter((c) => c.kind === "factual"),
        generative: fieldConfigs.filter((c) => c.kind === "generative"),
    };
}

export function filterFieldConfigsForGoldenLabel(
    fieldConfigs: IPipelineFieldConfig[],
    goldenKeys: Set<string>,
): IPipelineFieldConfig[] {
    const expandedKeys = new Set(goldenKeys);
    for (const key of goldenKeys) expandedKeys.add(`$.${key}`);
    return fieldConfigs.filter(
        (config) =>
            config.kind === "generative" || expandedKeys.has(config.field),
    );
}

export function pipelineFactualDescriptors(
    jsonSchema: JsonSchemaObject,
    fieldConfigs: IPipelineFieldConfig[],
): ISchemaFieldDescriptor[] {
    const parsed = parseSchema(jsonSchema);
    if (!parsed.ok) return [];
    const factual = new Set(
        fieldConfigs.filter((c) => c.kind === "factual").map((c) => c.field),
    );
    return parsed.schema.fields.filter((f) => factual.has(f.name));
}

export type PipelineFieldValidation =
    | { ok: true }
    | { ok: false; error: string };

const MAX_RUBRIC_LENGTH = 4000;
const MAX_MODEL_ID_LENGTH = 100;

function isValidMatcherSpec(spec: unknown): boolean {
    if (spec === undefined) return true;
    if (!isRecord(spec)) return false;
    if (spec.matcher === "exact" || spec.matcher === "set_overlap") return true;
    if (spec.matcher === "numeric_tolerance") {
        return (
            typeof spec.tolerance === "number" &&
            Number.isFinite(spec.tolerance) &&
            (spec.relative === undefined || typeof spec.relative === "boolean")
        );
    }
    return false;
}

export function mergeRunFieldConfigs(
    pipelineConfigs: IPipelineFieldConfig[],
    submittedConfigs: IPipelineFieldConfig[],
): { ok: true; fieldConfigs: IPipelineFieldConfig[] } | { ok: false; error: string } {
    if (submittedConfigs.length !== pipelineConfigs.length) {
        return {
            ok: false,
            error: "Field configs must match the prompt bundle.",
        };
    }

    const submittedByField = new Map(
        submittedConfigs.map((config) => [config.field, config]),
    );

    const fieldConfigs: IPipelineFieldConfig[] = [];

    for (const base of pipelineConfigs) {
        const submitted = submittedByField.get(base.field);
        if (!submitted) {
            return {
                ok: false,
                error: `Unknown field config "${base.field}".`,
            };
        }
        if (submitted.kind !== base.kind) {
            return {
                ok: false,
                error: `Field "${base.field}" kind cannot be changed at run time.`,
            };
        }
        if (base.kind === "factual") {
            if (submitted.kind !== "factual") {
                return {
                    ok: false,
                    error: `Field "${base.field}" has an invalid config.`,
                };
            }
            if (!isValidMatcherSpec(submitted.spec)) {
                return {
                    ok: false,
                    error: `Field "${base.field}" has an invalid matcher.`,
                };
            }
            fieldConfigs.push({
                field: base.field,
                kind: "factual",
                spec: submitted.spec,
            });
            continue;
        }
        if (submitted.kind !== "generative") {
            return {
                ok: false,
                error: `Field "${base.field}" has an invalid config.`,
            };
        }
        if (
            typeof submitted.rubric !== "string" ||
            submitted.rubric.length > MAX_RUBRIC_LENGTH ||
            typeof submitted.modelId !== "string" ||
            submitted.modelId.trim().length === 0 ||
            submitted.modelId.length > MAX_MODEL_ID_LENGTH
        ) {
            return {
                ok: false,
                error: `Field "${base.field}" has an invalid judge rubric or model.`,
            };
        }
        fieldConfigs.push({
            field: base.field,
            kind: "generative",
            rubric: submitted.rubric,
            modelId: submitted.modelId,
        });
    }

    return { ok: true, fieldConfigs };
}

export function validatePipelineFields(
    jsonSchema: JsonSchemaObject,
    fieldConfigs: IPipelineFieldConfig[],
): PipelineFieldValidation {
    const props = new Set<string>();
    if (isRecord(jsonSchema.properties)) {
        for (const key of Object.keys(jsonSchema.properties)) {
            props.add(key);
            props.add(`$.${key}`);
        }
    }
    for (const descriptor of extractSchemaPaths(jsonSchema)) {
        props.add(descriptor.path);
        props.add(descriptor.path.replace(/^\$\./, ""));
    }
    for (const config of fieldConfigs) {
        if (!config.field || typeof config.field !== "string") {
            return { ok: false, error: "Each field config must name a field." };
        }
        if (!props.has(config.field)) {
            return {
                ok: false,
                error: `Field config "${config.field}" is not defined in the output structure.`,
            };
        }
    }
    return { ok: true };
}

export async function createPipeline(input: {
    teamId: string;
    name: string;
    outputSchema: JsonSchemaObject;
    fieldConfigs: IPipelineFieldConfig[];
    promptId?: string;
}) {
    const validation = validatePipelineFields(
        input.outputSchema,
        input.fieldConfigs,
    );
    if (!validation.ok) throw new Error(validation.error);

    const [row] = await db
        .insert(pipelines)
        .values({
            teamId: input.teamId,
            projectId: sql`(select id from projects where team_id = ${input.teamId} order by created_at limit 1)`,
            name: input.name,
            outputSchema: input.outputSchema,
            fieldConfigs: input.fieldConfigs,
            promptId: input.promptId,
        })
        .returning();
    return row;
}

export async function getPipeline(pipelineId: string) {
    const [row] = await db
        .select()
        .from(pipelines)
        .where(eq(pipelines.id, pipelineId))
        .limit(1);
    return row;
}

export async function getPipelineForDataset(datasetId: string) {
    const [row] = await db
        .select({ pipeline: pipelines })
        .from(datasets)
        .innerJoin(pipelines, eq(datasets.pipelineId, pipelines.id))
        .where(eq(datasets.id, datasetId))
        .limit(1);
    return row?.pipeline;
}

export async function setDatasetPipeline(datasetId: string, pipelineId: string) {
    await db
        .update(datasets)
        .set({ pipelineId })
        .where(eq(datasets.id, datasetId));
}

export async function listPipelines(teamId: string) {
    return db.select().from(pipelines).where(eq(pipelines.teamId, teamId));
}
