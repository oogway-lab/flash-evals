/**
 * Local dev fixture seed.
 *
 * Resets the app tables and loads a small synthetic dataset (a "receipts"
 * image eval with a field extractor, a completeness scorer, and a line-item
 * counter) so a fresh clone has something to explore immediately. All
 * content here is generated, not real usage data, and the images are flat
 * placeholder PNGs rendered in-process — nothing is read from disk.
 */
import { randomUUID, createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "../server/db/schema";
import { putImage } from "../server/images/source";
import type {
    IPipelineFieldConfig,
    IPromptSampleInput,
    IPromptValidationEvidence,
    IRunModelPromptSnapshot,
    JsonSchemaObject,
    OutputJson,
    RunConfigSnapshot,
} from "../server/db/jsonTypes";

// Fixed so `scripts/dev.mjs` can point AUTH_DEV at a known team/user without
// re-reading this file.
const SEED_TEAM_ID = "f3b1a534-d8ef-4146-aead-96301d99d496";
const SEED_USER_ID = "5b7ecdb4-ac4b-4219-89ea-f5f50aeae7bd";
const SEED_USER_EMAIL = "dev@local";

const APP_TABLES = [
    "public.run_cell_annotations",
    "public.run_notes",
    "public.cell_scores",
    "public.run_cells",
    "public.run_models",
    "public.runs",
    "public.judge_configs",
    "public.prompt_version_fit_tags",
    "public.prompt_schema_generation_attempts",
    "public.prompt_optimization_attempts",
    "public.prompt_validation_attempts",
    "public.prompt_drafts",
    "public.prompt_versions",
    "public.prompt_schema_versions",
    "public.prompts",
    "public.labels",
    "public.dataset_items",
    "public.dataset_schemas",
    "public.datasets",
    "public.pipelines",
    "public.projects",
    "public.workspaces",
    "public.users",
    "public.teams",
] as const;

// TRUNCATE ... CASCADE also clears every other table with a foreign key into
// this list (llm routes, workflows, audio transcripts, ...), which is the
// point: this script resets the whole local database to the fixture below.
const RESET_SQL = sql.raw(
    `TRUNCATE TABLE ${APP_TABLES.join(", ")} RESTART IDENTITY CASCADE;`,
);

function schemaHashOf(jsonSchema: JsonSchemaObject): string {
    return createHash("sha256")
        .update(JSON.stringify(jsonSchema))
        .digest("hex");
}

function passingEvidence(output: OutputJson): IPromptValidationEvidence {
    return {
        staticChecks: [],
        schemaValidation: {
            localValid: true,
            openaiCompatible: true,
            errors: [],
        },
        sampleResults: [
            {
                sampleName: "Sample receipt",
                status: "passed",
                rawOutput: JSON.stringify(output),
                parsedOutput: output,
                errors: [],
            },
        ],
    };
}

/** A flat-color PNG, built by hand so the fixture needs no image library and
 * no binary files in git. Visual content doesn't matter: run_cells below
 * store pre-baked "model output" rather than calling a real provider. */
function placeholderPng(
    width: number,
    height: number,
    rgb: [number, number, number],
): Buffer {
    function chunk(type: string, data: Buffer): Buffer {
        const typeBuf = Buffer.from(type, "ascii");
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length, 0);
        const crcInput = Buffer.concat([typeBuf, data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(crcInput), 0);
        return Buffer.concat([length, typeBuf, data, crc]);
    }

    function crc32(buf: Buffer): number {
        let crc = ~0;
        for (const byte of buf) {
            crc ^= byte;
            for (let i = 0; i < 8; i += 1) {
                crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
            }
        }
        return ~crc >>> 0;
    }

    const signature = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.writeUInt8(8, 8); // bit depth
    ihdr.writeUInt8(2, 9); // color type: RGB
    ihdr.writeUInt8(0, 10); // compression
    ihdr.writeUInt8(0, 11); // filter
    ihdr.writeUInt8(0, 12); // interlace

    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
        row.writeUInt8(rgb[0], 1 + x * 3);
        row.writeUInt8(rgb[1], 1 + x * 3 + 1);
        row.writeUInt8(rgb[2], 1 + x * 3 + 2);
    }
    const raw = Buffer.concat(Array.from({ length: height }, () => row));
    const idatData = deflateSync(raw);

    return Buffer.concat([
        signature,
        chunk("IHDR", ihdr),
        chunk("IDAT", idatData),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

const RECEIPT_PALETTE: Array<[number, number, number]> = [
    [219, 112, 87],
    [87, 143, 219],
    [120, 189, 110],
    [219, 183, 61],
    [148, 110, 219],
    [219, 110, 168],
];

async function main() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error("DATABASE_URL is not set");
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const db = drizzle(pool, { schema });

    const imagesToStore: Array<{
        storageKey: string;
        mimeType: string;
        bytes: Buffer;
    }> = [];

    try {
        await db.transaction(async (tx) => {
            await tx.execute(RESET_SQL);

            await tx.insert(schema.teams).values({
                id: SEED_TEAM_ID,
                name: "Dev Team",
            });
            await tx.insert(schema.users).values({
                id: SEED_USER_ID,
                teamId: SEED_TEAM_ID,
                email: SEED_USER_EMAIL,
                name: "Dev",
            });

            const workspaceId = randomUUID();
            await tx.insert(schema.workspaces).values({
                id: workspaceId,
                teamId: SEED_TEAM_ID,
                name: "Default",
                ownerUserId: SEED_USER_ID,
            });
            const projectId = randomUUID();
            await tx.insert(schema.projects).values({
                id: projectId,
                teamId: SEED_TEAM_ID,
                workspaceId,
                name: "Default",
                createdBy: SEED_USER_ID,
            });
            await tx
                .update(schema.users)
                .set({ defaultWorkspaceId: workspaceId })
                .where(sql`${schema.users.id} = ${SEED_USER_ID}`);

            const datasetId = randomUUID();
            await tx.insert(schema.datasets).values({
                id: datasetId,
                teamId: SEED_TEAM_ID,
                projectId,
                name: "Sample receipts",
                purpose: "evaluation",
                modality: "image",
                description:
                    "Synthetic receipt photos used to exercise image evals end to end.",
                createdBy: SEED_USER_ID,
            });

            const items = RECEIPT_PALETTE.map((rgb, index) => {
                const id = randomUUID();
                const storageKey = randomUUID();
                imagesToStore.push({
                    storageKey,
                    mimeType: "image/png",
                    bytes: placeholderPng(64, 64, rgb),
                });
                return {
                    id,
                    storageKey,
                    sourceName: `sample-receipt-${String(index + 1).padStart(2, "0")}.png`,
                    merchant: [
                        "Corner Market",
                        "Daily Grind Coffee",
                        "Hardware Plus",
                    ][index % 3],
                    lineItemCount: 2 + (index % 4),
                };
            });
            for (const item of items) {
                await tx.insert(schema.datasetItems).values({
                    id: item.id,
                    datasetId,
                    type: "image",
                    sourceName: item.sourceName,
                    storageKey: item.storageKey,
                    mimeType: "image/png",
                });
            }

            // Prompt 1: structured field extraction from a receipt photo.
            const extractorSchema: JsonSchemaObject = {
                type: "object",
                required: ["merchant", "date", "total", "line_items", "error"],
                properties: {
                    merchant: { type: "string" },
                    date: { type: "string", description: "ISO 8601 date." },
                    total: { type: "number" },
                    line_items: { type: "array", items: { type: "string" } },
                    error: {
                        type: "string",
                        description:
                            "SCREAMING_SNAKE_CASE error code, or empty string on success.",
                    },
                },
                additionalProperties: false,
            };
            const extractorFieldConfigs: IPipelineFieldConfig[] = [
                { field: "merchant", kind: "factual" },
                {
                    field: "total",
                    kind: "factual",
                    spec: {
                        matcher: "numeric_tolerance",
                        tolerance: 0.01,
                        relative: true,
                    },
                },
            ];

            const promptExtractorId = randomUUID();
            await tx.insert(schema.prompts).values({
                id: promptExtractorId,
                teamId: SEED_TEAM_ID,
                projectId,
                name: "Receipt Field Extractor",
                description:
                    "Given a receipt photo, extracts the merchant, date, total, and line items as structured JSON.",
                kind: "eval",
                targetModelId: "gpt-4o",
            });
            const extractorSchemaVersionId = randomUUID();
            const extractorSchemaHash = schemaHashOf(extractorSchema);
            await tx.insert(schema.promptSchemaVersions).values({
                id: extractorSchemaVersionId,
                promptId: promptExtractorId,
                version: 1,
                jsonSchema: extractorSchema,
                fieldConfigs: extractorFieldConfigs,
                schemaHash: extractorSchemaHash,
                openaiCompatible: true,
                createdBy: SEED_USER_ID,
            });

            const extractorContent =
                "You are an expert at reading receipt photos. Identify the merchant " +
                "name, the date, the total amount, and a list of line items. Respond " +
                "only with JSON matching the schema. Set error to a SCREAMING_SNAKE_CASE " +
                "code on failure, or an empty string on success.";
            const extractorVersionId = randomUUID();
            await tx.insert(schema.promptVersions).values({
                id: extractorVersionId,
                promptId: promptExtractorId,
                version: 1,
                content: extractorContent,
                schemaVersionId: extractorSchemaVersionId,
                createdBy: SEED_USER_ID,
            });
            const extractorSample: IPromptSampleInput = {
                name: "Sample receipt",
                imageStorageKey: items[0].storageKey,
                imageMimeType: "image/png",
            };
            const extractorOutput: OutputJson = {
                merchant: items[0].merchant,
                date: "2026-04-02",
                total: 18.42,
                line_items: ["Item A", "Item B", "Item C"],
                error: "",
            };
            const extractorEvidence = passingEvidence(extractorOutput);
            const extractorValidationId = randomUUID();
            await tx.insert(schema.promptValidationAttempts).values({
                id: extractorValidationId,
                teamId: SEED_TEAM_ID,
                projectId,
                promptId: promptExtractorId,
                promptVersionId: extractorVersionId,
                schemaVersionId: extractorSchemaVersionId,
                targetModelId: "gpt-4o",
                status: "passed",
                schemaHash: extractorSchemaHash,
                evidence: extractorEvidence,
                rawOutput: JSON.stringify(extractorOutput),
                parsedOutput: extractorOutput,
                latencyMs: 842,
                createdBy: SEED_USER_ID,
            });
            await tx
                .update(schema.promptVersions)
                .set({
                    validationAttemptId: extractorValidationId,
                    status: "runnable",
                })
                .where(
                    sql`${schema.promptVersions.id} = ${extractorVersionId}`,
                );
            await tx.insert(schema.promptVersionFitTags).values([
                {
                    id: randomUUID(),
                    promptVersionId: extractorVersionId,
                    tag: "vision",
                },
                {
                    id: randomUUID(),
                    promptVersionId: extractorVersionId,
                    tag: "json-output",
                },
                {
                    id: randomUUID(),
                    promptVersionId: extractorVersionId,
                    tag: "receipt-extraction",
                },
            ]);
            await tx.insert(schema.promptDrafts).values({
                id: randomUUID(),
                teamId: SEED_TEAM_ID,
                projectId,
                promptId: promptExtractorId,
                content: extractorContent,
                jsonSchema: extractorSchema,
                fieldConfigs: extractorFieldConfigs,
                sampleInputs: [extractorSample],
                sourcePromptVersionId: extractorVersionId,
                sourceSchemaVersionId: extractorSchemaVersionId,
                validationEvidenceStale: true,
                createdBy: SEED_USER_ID,
            });

            // Prompt 2: judge-style completeness score over the extracted fields.
            const completenessSchema: JsonSchemaObject = {
                type: "object",
                required: ["completeness_score", "missing_fields", "error"],
                properties: {
                    completeness_score: { type: "number" },
                    missing_fields: {
                        type: "array",
                        items: { type: "string" },
                    },
                    error: { type: "string" },
                },
                additionalProperties: false,
            };
            const promptCompletenessId = randomUUID();
            await tx.insert(schema.prompts).values({
                id: promptCompletenessId,
                teamId: SEED_TEAM_ID,
                projectId,
                name: "Receipt Completeness Checker",
                description:
                    "Scores an extracted receipt against a completeness rubric and lists missing fields.",
                kind: "eval",
                targetModelId: "gpt-4o",
            });
            const completenessSchemaVersionId = randomUUID();
            const completenessSchemaHash = schemaHashOf(completenessSchema);
            await tx.insert(schema.promptSchemaVersions).values({
                id: completenessSchemaVersionId,
                promptId: promptCompletenessId,
                version: 1,
                jsonSchema: completenessSchema,
                fieldConfigs: [
                    {
                        field: "completeness_score",
                        kind: "generative",
                        rubric: "Score 0 to 1 on how complete the extracted fields are.",
                        modelId: "gpt-5.4-mini",
                    },
                ] satisfies IPipelineFieldConfig[],
                schemaHash: completenessSchemaHash,
                openaiCompatible: true,
                createdBy: SEED_USER_ID,
            });
            const completenessContent =
                "Given the extracted receipt fields, score completeness from 0 to 1 " +
                "and list any fields that look missing or implausible.";
            const completenessVersionId = randomUUID();
            await tx.insert(schema.promptVersions).values({
                id: completenessVersionId,
                promptId: promptCompletenessId,
                version: 1,
                content: completenessContent,
                schemaVersionId: completenessSchemaVersionId,
                createdBy: SEED_USER_ID,
            });
            const completenessOutput: OutputJson = {
                completeness_score: 0.92,
                missing_fields: [],
                error: "",
            };
            const completenessValidationId = randomUUID();
            await tx.insert(schema.promptValidationAttempts).values({
                id: completenessValidationId,
                teamId: SEED_TEAM_ID,
                projectId,
                promptId: promptCompletenessId,
                promptVersionId: completenessVersionId,
                schemaVersionId: completenessSchemaVersionId,
                targetModelId: "gpt-4o",
                status: "passed",
                schemaHash: completenessSchemaHash,
                evidence: passingEvidence(completenessOutput),
                rawOutput: JSON.stringify(completenessOutput),
                parsedOutput: completenessOutput,
                latencyMs: 611,
                createdBy: SEED_USER_ID,
            });
            await tx
                .update(schema.promptVersions)
                .set({
                    validationAttemptId: completenessValidationId,
                    status: "runnable",
                })
                .where(
                    sql`${schema.promptVersions.id} = ${completenessVersionId}`,
                );

            // Prompt 3: numeric estimation, with one optimization pass to exercise
            // the optimizer tables and a second prompt version.
            const counterSchema: JsonSchemaObject = {
                type: "object",
                required: ["line_item_count", "error"],
                properties: {
                    line_item_count: { type: "number" },
                    error: { type: "string" },
                },
                additionalProperties: false,
            };
            const promptCounterId = randomUUID();
            await tx.insert(schema.prompts).values({
                id: promptCounterId,
                teamId: SEED_TEAM_ID,
                projectId,
                name: "Receipt Line-Item Counter",
                description:
                    "Estimates the number of line items visible in a receipt photo.",
                kind: "eval",
                targetModelId: "gpt-4.1",
            });
            const counterSchemaVersionId = randomUUID();
            const counterSchemaHash = schemaHashOf(counterSchema);
            await tx.insert(schema.promptSchemaVersions).values({
                id: counterSchemaVersionId,
                promptId: promptCounterId,
                version: 1,
                jsonSchema: counterSchema,
                fieldConfigs: [
                    {
                        field: "line_item_count",
                        kind: "factual",
                        spec: { matcher: "numeric_tolerance", tolerance: 1 },
                    },
                ] satisfies IPipelineFieldConfig[],
                schemaHash: counterSchemaHash,
                openaiCompatible: true,
                createdBy: SEED_USER_ID,
            });

            const counterV1Content =
                "Count the line items visible on this receipt and return the count.";
            const counterV1Id = randomUUID();
            await tx.insert(schema.promptVersions).values({
                id: counterV1Id,
                promptId: promptCounterId,
                version: 1,
                content: counterV1Content,
                schemaVersionId: counterSchemaVersionId,
                createdBy: SEED_USER_ID,
            });
            const counterV1Output: OutputJson = {
                line_item_count: 3,
                error: "",
            };
            const counterV1ValidationId = randomUUID();
            await tx.insert(schema.promptValidationAttempts).values({
                id: counterV1ValidationId,
                teamId: SEED_TEAM_ID,
                projectId,
                promptId: promptCounterId,
                promptVersionId: counterV1Id,
                schemaVersionId: counterSchemaVersionId,
                targetModelId: "gpt-4.1",
                status: "passed",
                schemaHash: counterSchemaHash,
                evidence: passingEvidence(counterV1Output),
                rawOutput: JSON.stringify(counterV1Output),
                parsedOutput: counterV1Output,
                latencyMs: 530,
                createdBy: SEED_USER_ID,
            });
            await tx
                .update(schema.promptVersions)
                .set({
                    validationAttemptId: counterV1ValidationId,
                    status: "runnable",
                })
                .where(sql`${schema.promptVersions.id} = ${counterV1Id}`);

            const counterV2Content =
                "Count only distinct line items on this receipt (ignore subtotal, tax, " +
                "and total lines) and return an integer count.";
            const counterV2Id = randomUUID();
            await tx.insert(schema.promptVersions).values({
                id: counterV2Id,
                promptId: promptCounterId,
                version: 2,
                content: counterV2Content,
                schemaVersionId: counterSchemaVersionId,
                createdBy: SEED_USER_ID,
            });
            const optimizationId = randomUUID();
            const counterV2Output: OutputJson = {
                line_item_count: 3,
                error: "",
            };
            const counterV2ValidationId = randomUUID();
            await tx.insert(schema.promptValidationAttempts).values({
                id: counterV2ValidationId,
                teamId: SEED_TEAM_ID,
                projectId,
                promptId: promptCounterId,
                promptVersionId: counterV2Id,
                schemaVersionId: counterSchemaVersionId,
                targetModelId: "gpt-4.1",
                status: "passed",
                schemaHash: counterSchemaHash,
                evidence: passingEvidence(counterV2Output),
                rawOutput: JSON.stringify(counterV2Output),
                parsedOutput: counterV2Output,
                latencyMs: 498,
                createdBy: SEED_USER_ID,
            });
            await tx.insert(schema.promptOptimizationAttempts).values({
                id: optimizationId,
                teamId: SEED_TEAM_ID,
                projectId,
                promptId: promptCounterId,
                sourcePromptVersionId: counterV1Id,
                targetModelId: "gpt-4.1",
                optimizerModelId: "gpt-5.4-mini",
                status: "proposed",
                guidanceSource: {
                    title: "OpenAI structured outputs guide",
                    url: "https://platform.openai.com/docs/guides/structured-outputs",
                    retrievedAt: new Date().toISOString(),
                },
                originalPrompt: counterV1Content,
                proposedPrompt: counterV2Content,
                rationale:
                    "Excluding subtotal/tax/total lines reduced over-counting on receipts " +
                    "with a line-item-shaped summary section.",
                validationAttemptId: counterV2ValidationId,
                createdBy: SEED_USER_ID,
            });
            await tx
                .update(schema.promptVersions)
                .set({
                    validationAttemptId: counterV2ValidationId,
                    optimizerAttemptId: optimizationId,
                    status: "runnable",
                })
                .where(sql`${schema.promptVersions.id} = ${counterV2Id}`);
            await tx.insert(schema.promptVersionFitTags).values([
                {
                    id: randomUUID(),
                    promptVersionId: counterV2Id,
                    tag: "vision",
                },
                {
                    id: randomUUID(),
                    promptVersionId: counterV2Id,
                    tag: "numeric-estimation",
                },
                {
                    id: randomUUID(),
                    promptVersionId: counterV2Id,
                    tag: "gpt-4.1",
                },
            ]);

            await tx.insert(schema.promptSchemaGenerationAttempts).values({
                id: randomUUID(),
                teamId: SEED_TEAM_ID,
                projectId,
                targetModelId: "gpt-4o",
                generatorModelId: "gpt-5.4-mini",
                status: "proposed",
                openaiCompatible: true,
                createdBy: SEED_USER_ID,
            });

            // A judge config used to score every cell below.
            const judgeConfigId = randomUUID();
            await tx.insert(schema.judgeConfigs).values({
                id: judgeConfigId,
                teamId: SEED_TEAM_ID,
                projectId,
                name: "Run judge",
                modelId: "gpt-5.4-mini",
                rubricPrompt:
                    "Score each criterion independently from 0 to 1:\n\n" +
                    "1) FieldAccuracy — do the extracted fields match what is visible " +
                    "in the receipt?\n" +
                    "2) SchemaCompliance — is the output valid JSON matching the " +
                    "schema, with no extra fields?\n\n" +
                    "Return the average as the overall score.",
                reasoningConfig: { effort: "low" },
            });

            function promptSnapshotFor(
                promptId: string,
                promptName: string,
                versionId: string,
                version: number,
                schemaVersionId: string,
                fitTags: string[],
            ): IRunModelPromptSnapshot {
                return {
                    promptId,
                    promptName,
                    promptVersionId: versionId,
                    promptVersion: version,
                    schemaVersionId,
                    schemaVersion: 1,
                    schemaHash:
                        schemaVersionId === extractorSchemaVersionId
                            ? extractorSchemaHash
                            : counterSchemaHash,
                    fitTags,
                };
            }

            const extractorSnapshot = promptSnapshotFor(
                promptExtractorId,
                "Receipt Field Extractor",
                extractorVersionId,
                1,
                extractorSchemaVersionId,
                ["vision", "json-output", "receipt-extraction"],
            );
            const counterV1Snapshot = promptSnapshotFor(
                promptCounterId,
                "Receipt Line-Item Counter",
                counterV1Id,
                1,
                counterSchemaVersionId,
                [],
            );
            const counterV2Snapshot = promptSnapshotFor(
                promptCounterId,
                "Receipt Line-Item Counter",
                counterV2Id,
                2,
                counterSchemaVersionId,
                ["vision", "numeric-estimation", "gpt-4.1"],
            );

            async function createRunWithCells(options: {
                note: string;
                counterVersionId: string;
                counterSnapshot: IRunModelPromptSnapshot;
            }) {
                const runId = randomUUID();
                const configSnapshot: RunConfigSnapshot = {
                    datasetId,
                    judgeConfigId,
                    maxTokens: 1024,
                    models: [
                        {
                            modelId: "gpt-4o",
                            promptVersionId: extractorVersionId,
                            schemaVersionId: extractorSchemaVersionId,
                            promptSnapshot: extractorSnapshot,
                            isReference: true,
                        },
                        {
                            modelId: "gpt-4.1",
                            promptVersionId: options.counterVersionId,
                            schemaVersionId: counterSchemaVersionId,
                            promptSnapshot: options.counterSnapshot,
                            isReference: false,
                        },
                    ],
                };
                await tx.insert(schema.runs).values({
                    id: runId,
                    teamId: SEED_TEAM_ID,
                    projectId,
                    datasetId,
                    judgeConfigId,
                    status: "completed",
                    configSnapshot,
                    createdBy: SEED_USER_ID,
                });

                const extractorRunModelId = randomUUID();
                await tx.insert(schema.runModels).values({
                    id: extractorRunModelId,
                    runId,
                    modelId: "gpt-4o",
                    promptVersionId: extractorVersionId,
                    schemaVersionId: extractorSchemaVersionId,
                    promptSnapshot: extractorSnapshot,
                    isReference: true,
                });
                const counterRunModelId = randomUUID();
                await tx.insert(schema.runModels).values({
                    id: counterRunModelId,
                    runId,
                    modelId: "gpt-4.1",
                    promptVersionId: options.counterVersionId,
                    schemaVersionId: counterSchemaVersionId,
                    promptSnapshot: options.counterSnapshot,
                    isReference: false,
                });

                for (const [index, item] of items.entries()) {
                    for (const runModel of [
                        { id: extractorRunModelId, kind: "extractor" as const },
                        { id: counterRunModelId, kind: "counter" as const },
                    ]) {
                        const outputJson: OutputJson =
                            runModel.kind === "extractor"
                                ? {
                                      merchant: item.merchant,
                                      date: "2026-04-0" + ((index % 9) + 1),
                                      total: 12.5 + index * 3.25,
                                      line_items: Array.from(
                                          { length: item.lineItemCount },
                                          (_v, lineIndex) =>
                                              `Item ${lineIndex + 1}`,
                                      ),
                                      error: "",
                                  }
                                : {
                                      line_item_count: item.lineItemCount,
                                      error: "",
                                  };
                        const schemaHash =
                            runModel.kind === "extractor"
                                ? extractorSchemaHash
                                : counterSchemaHash;
                        const cellId = randomUUID();
                        await tx.insert(schema.runCells).values({
                            id: cellId,
                            runId,
                            datasetItemId: item.id,
                            runModelId: runModel.id,
                            status: "succeeded",
                            outputJson,
                            latencyMs: 400 + index * 37,
                            costUsd: 0.0006 + index * 0.00011,
                            costSource: "computed",
                            promptTokens: 480 + index * 12,
                            completionTokens: 40 + index * 3,
                            schemaViolation: false,
                            maxTokens: 1024,
                            contentFingerprint: createHash("sha256")
                                .update(`${item.storageKey}:${runModel.id}`)
                                .digest("hex"),
                            schemaHash,
                        });
                        await tx.insert(schema.cellScores).values({
                            id: randomUUID(),
                            runCellId: cellId,
                            scorerType: "judge",
                            score: 0.82 + (index % 3) * 0.05,
                            detailsJson: {
                                criteria: [
                                    {
                                        name: "FieldAccuracy",
                                        score: 0.85 + (index % 3) * 0.05,
                                        reasoning:
                                            "Matches the visible merchant, total, and line items.",
                                    },
                                    {
                                        name: "SchemaCompliance",
                                        score: 1,
                                        reasoning:
                                            "Valid JSON, no extra fields.",
                                    },
                                ],
                            },
                            rationale: "Looks accurate and well-formed.",
                        });
                    }
                }

                await tx.insert(schema.runNotes).values({
                    id: randomUUID(),
                    runId,
                    body: options.note,
                    updatedBy: SEED_USER_ID,
                });
            }

            await createRunWithCells({
                note: "Baseline run before optimizing the line-item counter prompt.",
                counterVersionId: counterV1Id,
                counterSnapshot: counterV1Snapshot,
            });
            await createRunWithCells({
                note: "Run after optimizing the line-item counter prompt for gpt-4.1.",
                counterVersionId: counterV2Id,
                counterSnapshot: counterV2Snapshot,
            });
        });

        for (const image of imagesToStore) {
            await putImage(image.storageKey, image.bytes, image.mimeType, {
                upsert: true,
            });
        }

        console.info(
            `Seeded fixture: 1 team, 1 dataset (${imagesToStore.length} items), ` +
                "3 prompts, 2 runs across apps/web/scripts/seed.ts.",
        );
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
