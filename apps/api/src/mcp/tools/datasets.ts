import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    commitGoldenAnswersPayload,
    createDatasetItemFromFormPayload,
    createDatasetItemPayload,
    createDatasetPayload,
    datasetDetailPayload,
    deleteDatasetItemPayload,
    deleteDatasetPayload,
    deleteLabelPayload,
    duplicateDatasetPayload,
    datasetSummaryPayload,
    importAudioAnswersPayload,
    importAudioPayload,
    importGoldenAnswersPayload,
    importImageAnswersPayload,
    importImagesPayload,
    importPairedItemsPayload,
    importTextItemsPayload,
    listDatasetsPayload,
    listDatasetSummariesPagePayload,
    listDatasetItemsPagePayload,
    previewGoldenAnswersPayload,
    setDatasetArchivedPayload,
    updateDatasetDescriptionPayload,
    updateDatasetItemPayload,
    updateDatasetNamePayload,
} from "../../routes/datasets.js";
import { DATASET_IMPORT_LIMITS } from "../../routes/datasets/limits.js";
import type { LabelJson } from "@mosaic/api-contract";
import { ok } from "../responses.js";
import { withMcpIdempotency } from "../idempotency.js";
import { AudioFile, ImageFile, ProjectId } from "../schemas.js";
import { resolveProjectId, type IMcpContext } from "./context.js";
import {
    boundedMcpPageSize,
    decodeMcpPageCursor,
    encodeMcpPageCursor,
} from "../pagination.js";

const AnswerImportTarget = z.enum([
    "expectedTranscript",
    "expectedTranscriptLatin",
    "expectedLanguage",
    "expectedSpeakerTurns",
    "domainTerms",
    "expectedNumbers",
    "referenceKind",
    "latencySlaMs",
    "costOutlierUsd",
    "ignore",
]);
const AnswerImportMapping = z.record(z.string(), AnswerImportTarget);
const AnswerImportFile = z.object({
    fileName: z.string().min(1),
    content: limitedImportText(),
    interpretation: z.enum(["single_record", "keyed_map"]).optional(),
    itemId: z.string().uuid().optional(),
    allowOverwrite: z.boolean().optional(),
});
const AnswerImportFiles = z
    .array(AnswerImportFile)
    .min(1)
    .max(DATASET_IMPORT_LIMITS.maxFileCount)
    .superRefine((files, ctx) => {
        const totalBytes = files.reduce(
            (total, file) => total + Buffer.byteLength(file.content, "utf8"),
            0,
        );
        if (totalBytes > DATASET_IMPORT_LIMITS.maxTextBytes) {
            ctx.addIssue({
                code: "custom",
                message:
                    "Answer files exceed the total text import byte limit.",
            });
        }
    });

const ImageUploadFile = boundedMediaFile(
    ImageFile,
    DATASET_IMPORT_LIMITS.maxImageFileBytes,
    "Image",
);
const AudioUploadFile = boundedMediaFile(
    AudioFile,
    DATASET_IMPORT_LIMITS.maxAudioFileBytes,
    "Audio",
);
const ImageUploadFiles = z
    .array(ImageUploadFile)
    .min(1)
    .max(DATASET_IMPORT_LIMITS.maxFileCount)
    .superRefine((files, ctx) => {
        const totalBytes = files.reduce((total, file) => total + file.size, 0);
        if (totalBytes > DATASET_IMPORT_LIMITS.maxImageBatchBytes) {
            ctx.addIssue({
                code: "custom",
                message:
                    "Image files exceed the total image import byte limit.",
            });
        }
    });
const AudioUploadFiles = z
    .array(AudioUploadFile)
    .min(1)
    .max(DATASET_IMPORT_LIMITS.maxFileCount)
    .superRefine((files, ctx) => {
        const totalBytes = files.reduce((total, file) => total + file.size, 0);
        if (totalBytes > DATASET_IMPORT_LIMITS.maxAudioBatchBytes) {
            ctx.addIssue({
                code: "custom",
                message:
                    "Audio files exceed the total audio import byte limit.",
            });
        }
    });

export function registerDatasetTools(
    server: McpServer,
    context: IMcpContext,
): void {
    const { runtime, principal } = context;

    server.registerTool(
        "list_datasets",
        {
            title: "List datasets",
            description:
                "List datasets for the authenticated Flash Evals team.",
            inputSchema: z.object({
                projectId: ProjectId,
                includeArchived: z.boolean().optional(),
            }),
        },
        async (input) =>
            ok(
                "Loaded datasets.",
                await listDatasetsPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, input.projectId),
                    { includeArchived: input.includeArchived },
                ),
            ),
    );

    server.registerTool(
        "list_dataset_summaries_page",
        {
            title: "List dataset summaries page",
            description:
                "Read a bounded, stable page of dataset summaries; use this for large collections. The legacy list_datasets tool returns all matching summaries. The cursor is bound to the project and archived filter.",
            inputSchema: z.object({
                projectId: ProjectId,
                limit: z.number().int().min(1).max(100).optional(),
                cursor: z.string().optional(),
                includeArchived: z.boolean().optional(),
            }),
            outputSchema: {
                data: z.object({
                    datasets: z.array(
                        z.object({
                            id: z.string().uuid(),
                            name: z.string(),
                            purpose: z.enum(["golden", "evaluation"]),
                            modality: z.enum(["audio", "image", "text"]),
                            createdAt: z.string(),
                            itemCount: z.number().int(),
                            labeledItemCount: z.number().int(),
                            isRunnable: z.boolean(),
                            archived: z.boolean(),
                        }),
                    ),
                    complete: z.boolean(),
                    nextCursor: z.string().optional(),
                }),
            },
        },
        async (input) => {
            const projectId = await resolveProjectId(context, input.projectId);
            const scope = JSON.stringify([
                projectId,
                input.includeArchived ?? false,
            ]);
            const page = await listDatasetSummariesPagePayload(
                runtime.db,
                principal.teamId,
                projectId,
                {
                    limit: boundedMcpPageSize(input.limit),
                    includeArchived: input.includeArchived,
                    cursor: decodeMcpPageCursor(input.cursor, scope),
                },
            );
            return ok("Loaded dataset summary page.", {
                datasets: page.datasets,
                complete: page.complete,
                ...(page.nextCursor
                    ? {
                          nextCursor: encodeMcpPageCursor(
                              scope,
                              page.nextCursor,
                          ),
                      }
                    : {}),
            });
        },
    );

    server.registerTool(
        "get_dataset",
        {
            title: "Get dataset",
            description:
                "Return the complete legacy dataset response with metadata, items, labels, and schema context. For large datasets, use get_dataset_summary and the bounded list_dataset_items pages.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
            }),
        },
        async ({ projectId, datasetId }) =>
            ok(
                "Loaded dataset.",
                await datasetDetailPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, projectId),
                    datasetId,
                ),
            ),
    );

    server.registerTool(
        "get_dataset_summary",
        {
            title: "Get dataset summary",
            description:
                "Return compact dataset metadata and item/label counts. Use list_dataset_items for bounded item pages; get_dataset retains the full legacy response.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
            }),
            outputSchema: {
                data: z.object({
                    dataset: z.object({
                        id: z.string().uuid(),
                        name: z.string(),
                        purpose: z.enum(["golden", "evaluation"]),
                        modality: z.enum(["audio", "image", "text"]),
                        pipelineId: z.string().uuid().nullable(),
                        description: z.string().nullable(),
                        archivedAt: z.string().nullable(),
                    }),
                    itemCount: z.number().int(),
                    labeledItemCount: z.number().int(),
                    labelMode: z.string(),
                    freeformLabel: z.boolean(),
                    isRunnable: z.boolean(),
                }),
            },
        },
        async ({ projectId, datasetId }) =>
            ok(
                "Loaded dataset summary.",
                await datasetSummaryPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, projectId),
                    datasetId,
                ),
            ),
    );

    server.registerTool(
        "list_dataset_items",
        {
            title: "List dataset items",
            description:
                "Read a stable, bounded page of dataset items. Cursors are bound to the dataset and filters. Input text, storage keys, and labels are omitted unless requested.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                limit: z.number().int().min(1).max(100).optional(),
                cursor: z.string().optional(),
                type: z.enum(["audio", "image", "text", "mixed"]).optional(),
                labeled: z.boolean().optional(),
                includeInputText: z.boolean().optional(),
                includeStorageKey: z.boolean().optional(),
                includeLabel: z.boolean().optional(),
            }),
            outputSchema: {
                data: z.object({
                    items: z.array(
                        z.object({
                            id: z.string().uuid(),
                            type: z.enum(["audio", "image", "text", "mixed"]),
                            sourceName: z.string().nullable(),
                            mimeType: z.string().nullable(),
                            inputText: z.string().nullable().optional(),
                            storageKey: z.string().nullable().optional(),
                            label: z.unknown().optional(),
                        }),
                    ),
                    complete: z.boolean(),
                    nextCursor: z.string().optional(),
                }),
            },
        },
        async (input) => {
            const projectId = await resolveProjectId(context, input.projectId);
            const limit = boundedMcpPageSize(input.limit);
            const scope = JSON.stringify([
                input.datasetId,
                input.type ?? null,
                input.labeled ?? null,
            ]);
            const page = await listDatasetItemsPagePayload(runtime.db, {
                teamId: principal.teamId,
                projectId,
                datasetId: input.datasetId,
                limit,
                cursor: decodeMcpPageCursor(input.cursor, scope),
                type: input.type,
                labeled: input.labeled,
                includeInputText: input.includeInputText,
                includeStorageKey: input.includeStorageKey,
                includeLabel: input.includeLabel,
            });
            return ok("Loaded dataset item page.", {
                items: page.items,
                complete: page.complete,
                ...(page.nextCursor
                    ? {
                          nextCursor: encodeMcpPageCursor(
                              scope,
                              page.nextCursor,
                          ),
                      }
                    : {}),
            });
        },
    );

    server.registerTool(
        "create_dataset",
        {
            title: "Create dataset",
            description:
                "Create an image or text dataset for golden-answer or evaluation-only use.",
            inputSchema: z.object({
                projectId: ProjectId,
                name: z.string().min(1),
                purpose: z.enum(["golden", "evaluation"]),
                modality: z.enum(["audio", "image", "text"]),
            }),
        },
        async (input) =>
            ok(
                "Created dataset.",
                await createDatasetPayload(runtime.db, {
                    ...input,
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    createdBy: principal.userId,
                }),
            ),
    );

    server.registerTool(
        "import_dataset_images",
        {
            title: "Import dataset images",
            description:
                "Upload one or more base64-encoded image files into an image dataset.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                images: ImageUploadFiles,
            }),
        },
        async (input) =>
            ok(
                "Imported dataset images.",
                await importImagesPayload(runtime.db, runtime.config, {
                    ...input,
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                }),
            ),
    );

    server.registerTool(
        "import_dataset_text_items",
        {
            title: "Import dataset text items",
            description:
                "Import text dataset rows from CSV or JSONL content, optionally with labels.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                format: z.enum(["csv", "jsonl"]),
                content: limitedImportText(),
            }),
        },
        async (input) =>
            ok(
                "Imported dataset text items.",
                await importTextItemsPayload(runtime.db, {
                    ...input,
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                }),
            ),
    );

    server.registerTool(
        "import_dataset_golden_answers",
        {
            title: "Import dataset golden answers",
            description:
                "Attach golden answers to existing dataset items using CSV or JSONL answer content.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                answersContent: limitedImportText(),
            }),
        },
        async (input) =>
            ok(
                "Imported golden answers.",
                await importGoldenAnswersPayload(runtime.db, {
                    ...input,
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                }),
            ),
    );

    server.registerTool(
        "preview_dataset_golden_answers",
        {
            title: "Preview mapped golden answers",
            description:
                "Detect and preview mapped STT golden answers, including speaker-turn arrays and a derived gold transcript, without writing labels.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                answerFiles: AnswerImportFiles,
                mapping: AnswerImportMapping.optional(),
            }),
        },
        async (input) =>
            ok(
                "Previewed mapped golden answers.",
                await previewGoldenAnswersPayload(runtime.db, {
                    ...input,
                    answersContent: "",
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                }),
            ),
    );

    server.registerTool(
        "commit_dataset_golden_answers",
        {
            title: "Commit mapped golden answers",
            description:
                "Commit a previously previewed STT golden-answer mapping, including normalized speaker turns and an optional derived transcript.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                answerFiles: AnswerImportFiles,
                mapping: AnswerImportMapping,
                confirm: z.literal(true),
            }),
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async ({ confirm: _confirm, ...input }) =>
            ok(
                "Committed mapped golden answers.",
                await commitGoldenAnswersPayload(runtime.db, {
                    ...input,
                    answersContent: "",
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                }),
            ),
    );

    server.registerTool(
        "import_dataset_image_answers",
        {
            title: "Import images with answers",
            description:
                "Upload images and CSV or JSONL rows that pair each filename with freeform golden-answer content.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                images: ImageUploadFiles,
                answersContent: limitedImportText(),
            }),
        },
        async (input) =>
            ok(
                "Imported images with answers.",
                await importImageAnswersPayload(runtime.db, runtime.config, {
                    ...input,
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                }),
            ),
    );

    server.registerTool(
        "import_dataset_paired_items",
        {
            title: "Import paired image items",
            description:
                "Import image files plus spreadsheet/CSV rows that pair each filename with structured golden-answer fields.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                images: ImageUploadFiles,
                csvContent: limitedImportText(),
            }),
        },
        async (input) =>
            ok(
                "Imported paired image items.",
                await importPairedItemsPayload(runtime.db, runtime.config, {
                    ...input,
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                }),
            ),
    );

    server.registerTool(
        "add_dataset_item",
        {
            title: "Add dataset item",
            description:
                "Add a text item or a base64-encoded image or audio item to a dataset.",
            inputSchema: z
                .object({
                    projectId: ProjectId,
                    datasetId: z.string().uuid(),
                    inputText: z.string(),
                    label: z.unknown().optional(),
                    image: ImageUploadFile.optional(),
                    audio: AudioUploadFile.optional(),
                })
                .refine((input) => !(input.image && input.audio), {
                    path: ["audio"],
                    message: "Choose either image or audio for this item.",
                }),
        },
        async (input) => {
            const projectId = await resolveProjectId(context, input.projectId);
            const scope = {
                teamId: principal.teamId,
                projectId,
                datasetId: input.datasetId,
                inputText: input.inputText,
            };
            const result =
                input.image || input.audio
                    ? await createDatasetItemFromFormPayload(
                          runtime.db,
                          runtime.config,
                          {
                              ...scope,
                              rawLabel: rawLabel(input.label),
                              ...(input.image ? { image: input.image } : {}),
                              ...(input.audio ? { audio: input.audio } : {}),
                          },
                      )
                    : await createDatasetItemPayload(runtime.db, {
                          ...scope,
                          ...(input.label !== undefined
                              ? { label: input.label as LabelJson }
                              : {}),
                      });
            return ok("Added dataset item.", result);
        },
    );

    server.registerTool(
        "update_dataset_item",
        {
            title: "Update dataset item",
            description: "Update a dataset item's text and optional label.",
            inputSchema: z
                .object({
                    projectId: ProjectId,
                    itemId: z.string().uuid(),
                    inputText: z.string(),
                    label: z.unknown().optional(),
                    clearLabel: z.boolean().optional(),
                })
                .refine(
                    (input) => !(input.label !== undefined && input.clearLabel),
                    {
                        path: ["clearLabel"],
                        message: "Set label or clearLabel, not both.",
                    },
                ),
        },
        async (input) =>
            ok(
                "Updated dataset item.",
                await updateDatasetItemPayload(runtime.db, {
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    itemId: input.itemId,
                    inputText: input.inputText,
                    ...(input.label !== undefined
                        ? { label: input.label as LabelJson }
                        : {}),
                    ...(input.clearLabel ? { clearLabel: true } : {}),
                }),
            ),
    );

    server.registerTool(
        "delete_dataset_item",
        {
            title: "Delete dataset item",
            description: "Permanently delete an item from a dataset.",
            inputSchema: z.object({
                projectId: ProjectId,
                itemId: z.string().uuid(),
                confirm: z.literal(true),
            }),
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async (input) =>
            ok(
                "Deleted dataset item.",
                await deleteDatasetItemPayload(runtime.db, runtime.config, {
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    itemId: input.itemId,
                }),
            ),
    );

    server.registerTool(
        "delete_dataset_label",
        {
            title: "Delete dataset label",
            description: "Permanently remove the label from a dataset item.",
            inputSchema: z.object({
                projectId: ProjectId,
                itemId: z.string().uuid(),
                confirm: z.literal(true),
            }),
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async (input) =>
            ok(
                "Deleted dataset label.",
                await deleteLabelPayload(runtime.db, {
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    itemId: input.itemId,
                }),
            ),
    );

    server.registerTool(
        "rename_dataset",
        {
            title: "Rename dataset",
            description: "Rename a dataset.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                name: z.string().min(1).max(120),
            }),
        },
        async (input) => {
            await updateDatasetNamePayload(runtime.db, {
                teamId: principal.teamId,
                projectId: await resolveProjectId(context, input.projectId),
                datasetId: input.datasetId,
                name: input.name,
            });
            return ok("Renamed dataset.", { datasetId: input.datasetId });
        },
    );

    server.registerTool(
        "update_dataset_description",
        {
            title: "Update dataset description",
            description: "Set or clear a dataset description.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                description: z.string().max(2000).nullable(),
            }),
        },
        async (input) => {
            await updateDatasetDescriptionPayload(runtime.db, {
                teamId: principal.teamId,
                projectId: await resolveProjectId(context, input.projectId),
                datasetId: input.datasetId,
                description: input.description,
            });
            return ok("Updated dataset description.", {
                datasetId: input.datasetId,
            });
        },
    );

    server.registerTool(
        "set_dataset_archived",
        {
            title: "Archive or restore dataset",
            description: "Archive or restore a dataset.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                archived: z.boolean(),
                confirm: z.literal(true),
            }),
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async (input) => {
            await setDatasetArchivedPayload(runtime.db, {
                teamId: principal.teamId,
                projectId: await resolveProjectId(context, input.projectId),
                datasetId: input.datasetId,
                archived: input.archived,
            });
            return ok(
                input.archived ? "Archived dataset." : "Restored dataset.",
                {
                    datasetId: input.datasetId,
                    archived: input.archived,
                },
            );
        },
    );

    server.registerTool(
        "duplicate_dataset",
        {
            title: "Duplicate dataset",
            description:
                "Duplicate a dataset, including its schema, items, and labels. The optional idempotencyKey makes retries safe; when supplied, choose it before the first request and reuse it for this same copy.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                idempotencyKey: z.string().trim().min(1).max(200).optional(),
            }),
            outputSchema: {
                data: z.object({
                    datasetId: z.string().uuid(),
                    sourceDatasetId: z.string().uuid(),
                    createdDatasetId: z.string().uuid(),
                }),
            },
        },
        async (input) => {
            const request = {
                teamId: principal.teamId,
                projectId: await resolveProjectId(context, input.projectId),
                datasetId: input.datasetId,
                createdBy: principal.userId,
            };
            const result = await withMcpIdempotency(
                runtime.db,
                {
                    teamId: principal.teamId,
                    operation: "duplicate_dataset",
                    idempotencyKey: input.idempotencyKey,
                    request,
                },
                (tx) => duplicateDatasetPayload(tx, request),
            );
            return ok("Duplicated dataset.", {
                // Keep datasetId as the source ID for v1 callers.
                datasetId: input.datasetId,
                sourceDatasetId: result.sourceDatasetId,
                createdDatasetId: result.createdDatasetId,
            });
        },
    );

    server.registerTool(
        "delete_dataset",
        {
            title: "Delete dataset",
            description: "Permanently delete a dataset and its items.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                confirm: z.literal(true),
            }),
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async (input) => {
            await deleteDatasetPayload(runtime.db, runtime.config, {
                teamId: principal.teamId,
                projectId: await resolveProjectId(context, input.projectId),
                datasetId: input.datasetId,
            });
            return ok("Deleted dataset.", { datasetId: input.datasetId });
        },
    );

    server.registerTool(
        "import_dataset_audio",
        {
            title: "Import dataset audio",
            description:
                "Upload one or more base64-encoded files into an audio dataset.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                audio: AudioUploadFiles,
            }),
        },
        async (input) =>
            ok(
                "Imported dataset audio.",
                await importAudioPayload(runtime.db, runtime.config, {
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    datasetId: input.datasetId,
                    audio: input.audio,
                }),
            ),
    );

    server.registerTool(
        "import_dataset_audio_answers",
        {
            title: "Import audio with answers",
            description:
                "Upload audio files and CSV or JSONL rows pairing each filename with a golden transcript.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                audio: AudioUploadFiles,
                answersContent: limitedImportText(),
            }),
        },
        async (input) =>
            ok(
                "Imported audio with answers.",
                await importAudioAnswersPayload(runtime.db, runtime.config, {
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    datasetId: input.datasetId,
                    audio: input.audio,
                    answersContent: input.answersContent,
                }),
            ),
    );
}

function rawLabel(label: unknown): string {
    if (label === undefined) return "";
    return typeof label === "string" ? label : JSON.stringify(label);
}

function limitedImportText() {
    return z
        .string()
        .min(1)
        .refine(
            (value) =>
                Buffer.byteLength(value, "utf8") <=
                DATASET_IMPORT_LIMITS.maxTextBytes,
            { message: "Text exceeds the backend import byte limit." },
        );
}

function boundedMediaFile<T extends { size: number; base64Data: string }>(
    schema: z.ZodType<T>,
    maxBytes: number,
    label: string,
): z.ZodType<T> {
    return schema.superRefine((file, ctx) => {
        if (file.size > maxBytes) {
            ctx.addIssue({
                code: "custom",
                path: ["size"],
                message: `${label} file exceeds the backend per-file byte limit.`,
            });
        }
        if (estimatedBase64Bytes(file.base64Data) > maxBytes) {
            ctx.addIssue({
                code: "custom",
                path: ["base64Data"],
                message: `${label} file exceeds the backend per-file byte limit.`,
            });
        }
    });
}

function estimatedBase64Bytes(base64Data: string): number {
    return Math.ceil((base64Data.replace(/\s/g, "").length * 3) / 4);
}
