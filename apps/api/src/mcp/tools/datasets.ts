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
    importAudioAnswersPayload,
    importAudioPayload,
    importGoldenAnswersPayload,
    importImageAnswersPayload,
    importImagesPayload,
    importPairedItemsPayload,
    importTextItemsPayload,
    listDatasetsPayload,
    previewGoldenAnswersPayload,
    setDatasetArchivedPayload,
    updateDatasetDescriptionPayload,
    updateDatasetItemPayload,
    updateDatasetNamePayload,
} from "../../routes/datasets.js";
import type { LabelJson } from "@mosaic/api-contract";
import { ok } from "../responses.js";
import { AudioFile, ImageFile, ProjectId } from "../schemas.js";
import { resolveProjectId, type IMcpContext } from "./context.js";

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
    content: z.string().min(1),
    interpretation: z.enum(["single_record", "keyed_map"]).optional(),
    itemId: z.string().uuid().optional(),
    allowOverwrite: z.boolean().optional(),
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
            description: "List datasets for the authenticated Flash Evals team.",
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
        "get_dataset",
        {
            title: "Get dataset",
            description:
                "Return dataset metadata, items, labels, and schema context.",
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
                images: z.array(ImageFile).min(1),
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
                content: z.string().min(1),
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
                answersContent: z.string().min(1),
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
                answerFiles: z.array(AnswerImportFile).min(1),
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
                answerFiles: z.array(AnswerImportFile).min(1),
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
                images: z.array(ImageFile).min(1),
                answersContent: z.string().min(1),
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
                images: z.array(ImageFile).min(1),
                csvContent: z.string().min(1),
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
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                inputText: z.string(),
                label: z.unknown().optional(),
                image: ImageFile.optional(),
                audio: AudioFile.optional(),
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
            inputSchema: z.object({
                projectId: ProjectId,
                itemId: z.string().uuid(),
                inputText: z.string(),
                label: z.unknown().optional(),
                clearLabel: z.boolean().optional(),
            }),
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
                "Duplicate a dataset, including its schema, items, and labels.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
            }),
        },
        async (input) => {
            await duplicateDatasetPayload(runtime.db, {
                teamId: principal.teamId,
                projectId: await resolveProjectId(context, input.projectId),
                datasetId: input.datasetId,
                createdBy: principal.userId,
            });
            return ok("Duplicated dataset.", { datasetId: input.datasetId });
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
                audio: z.array(AudioFile).min(1),
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
                audio: z.array(AudioFile).min(1),
                answersContent: z.string().min(1),
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
