import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createDatasetItemFromFormPayload: vi.fn(),
    createDatasetItemPayload: vi.fn(),
    deleteDatasetItemPayload: vi.fn(),
    deleteDatasetPayload: vi.fn(),
    deleteLabelPayload: vi.fn(),
    duplicateDatasetPayload: vi.fn(),
    datasetSummaryPayload: vi.fn(),
    listDatasetItemsPagePayload: vi.fn(),
    importAudioAnswersPayload: vi.fn(),
    importAudioPayload: vi.fn(),
    previewGoldenAnswersPayload: vi.fn(),
    commitGoldenAnswersPayload: vi.fn(),
    setDatasetArchivedPayload: vi.fn(),
    updateDatasetDescriptionPayload: vi.fn(),
    updateDatasetItemPayload: vi.fn(),
    updateDatasetNamePayload: vi.fn(),
}));

vi.mock("../../routes/datasets.js", () => ({
    ...mocks,
    createDatasetPayload: vi.fn(),
    datasetDetailPayload: vi.fn(),
    datasetSummaryPayload: mocks.datasetSummaryPayload,
    importGoldenAnswersPayload: vi.fn(),
    importImageAnswersPayload: vi.fn(),
    importImagesPayload: vi.fn(),
    importPairedItemsPayload: vi.fn(),
    importTextItemsPayload: vi.fn(),
    listDatasetsPayload: vi.fn(),
    listDatasetItemsPagePayload: mocks.listDatasetItemsPagePayload,
    previewGoldenAnswersPayload: mocks.previewGoldenAnswersPayload,
    commitGoldenAnswersPayload: mocks.commitGoldenAnswersPayload,
}));

import { registerDatasetTools } from "./datasets.js";
import {
    createToolHarness,
    expectConfirmationGate,
    TEST_PROJECT_ID,
} from "./testSupport.js";
import { DATASET_IMPORT_LIMITS } from "../../routes/datasets/limits.js";
import { decodeMcpPageCursor, encodeMcpPageCursor } from "../pagination.js";

const PROJECT_ID = TEST_PROJECT_ID;
const DATASET_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

describe("MCP dataset tools", () => {
    beforeEach(() => vi.clearAllMocks());

    it("registers the complete dataset parity surface", () => {
        const { tools } = registerTools();

        expect([...tools.keys()]).toEqual([
            "list_datasets",
            "get_dataset",
            "get_dataset_summary",
            "list_dataset_items",
            "create_dataset",
            "import_dataset_images",
            "import_dataset_text_items",
            "import_dataset_golden_answers",
            "preview_dataset_golden_answers",
            "commit_dataset_golden_answers",
            "import_dataset_image_answers",
            "import_dataset_paired_items",
            "add_dataset_item",
            "update_dataset_item",
            "delete_dataset_item",
            "delete_dataset_label",
            "rename_dataset",
            "update_dataset_description",
            "set_dataset_archived",
            "duplicate_dataset",
            "delete_dataset",
            "import_dataset_audio",
            "import_dataset_audio_answers",
        ]);
    });

    it("returns a compact summary and an opaque, scope-bound item page", async () => {
        const { tools, runtime } = registerTools();
        const summary = {
            dataset: {
                id: DATASET_ID,
                name: "Synthetic",
                purpose: "evaluation",
                modality: "text",
                pipelineId: null,
                description: null,
                archivedAt: null,
            },
            itemCount: 125,
            labeledItemCount: 25,
            labelMode: "schema",
            freeformLabel: false,
            isRunnable: true,
        };
        mocks.datasetSummaryPayload.mockResolvedValue(summary);
        const summaryResult = (await tools.get("get_dataset_summary")!.handler({
            projectId: PROJECT_ID,
            datasetId: DATASET_ID,
        })) as { structuredContent: { data: unknown } };
        expect(summaryResult.structuredContent.data).toEqual(summary);

        const nextCursor = {
            createdAt: "2026-10-10T00:00:00.000Z",
            id: ITEM_ID,
        };
        mocks.listDatasetItemsPagePayload.mockResolvedValue({
            items: [
                {
                    id: ITEM_ID,
                    type: "text",
                    sourceName: null,
                    mimeType: null,
                    inputText: "sample",
                },
            ],
            complete: false,
            nextCursor,
        });
        const pageResult = (await tools.get("list_dataset_items")!.handler({
            projectId: PROJECT_ID,
            datasetId: DATASET_ID,
            limit: 1,
            type: "text",
            includeInputText: true,
        })) as { structuredContent: { data: Record<string, unknown> } };
        const cursor = pageResult.structuredContent.data.nextCursor as string;
        expect(
            decodeMcpPageCursor(
                cursor,
                JSON.stringify([DATASET_ID, "text", null]),
            ),
        ).toEqual(nextCursor);
        expect(mocks.listDatasetItemsPagePayload).toHaveBeenCalledWith(
            runtime.db,
            expect.objectContaining({
                teamId: "team-1",
                projectId: PROJECT_ID,
                datasetId: DATASET_ID,
                limit: 1,
                type: "text",
                includeInputText: true,
            }),
        );
        expect(
            tools.get("list_dataset_items")!.config.inputSchema!.safeParse({
                projectId: PROJECT_ID,
                datasetId: DATASET_ID,
                limit: 101,
            }).success,
        ).toBe(false);
    });

    it("rejects a dataset cursor reused with different filters", async () => {
        const { tools } = registerTools();
        const cursor = encodeMcpPageCursor(
            JSON.stringify([DATASET_ID, "image", null]),
            { createdAt: "2026-10-10T00:00:00.000Z", id: ITEM_ID },
        );
        await expect(
            tools.get("list_dataset_items")!.handler({
                projectId: PROJECT_ID,
                datasetId: DATASET_ID,
                type: "text",
                cursor,
            }),
        ).rejects.toMatchObject({ status: 400 });
        expect(mocks.listDatasetItemsPagePayload).not.toHaveBeenCalled();
    });

    it.each([
        ["delete_dataset_item", { itemId: ITEM_ID }],
        ["delete_dataset_label", { itemId: ITEM_ID }],
        ["delete_dataset", { datasetId: DATASET_ID }],
        [
            "commit_dataset_golden_answers",
            {
                datasetId: DATASET_ID,
                answerFiles: [{ fileName: "sample.json", content: "{}" }],
                mapping: { transcript: "expectedSpeakerTurns" },
            },
        ],
    ])("requires explicit confirmation for %s", (name, input) => {
        const tool = registerTools().tools.get(name)!;

        expectConfirmationGate(tool, { projectId: PROJECT_ID, ...input });
    });

    it("marks dataset archive changes as destructive and idempotent", () => {
        const tool = registerTools().tools.get("set_dataset_archived")!;

        expectConfirmationGate(tool, {
            projectId: PROJECT_ID,
            datasetId: DATASET_ID,
            archived: true,
        });
    });

    it("returns both source and created dataset IDs without changing the v1 datasetId meaning", async () => {
        const { tools, runtime } = registerTools();
        mocks.duplicateDatasetPayload.mockResolvedValue({
            sourceDatasetId: DATASET_ID,
            createdDatasetId: "22222222-2222-4222-8222-222222222222",
        });

        const result = (await tools.get("duplicate_dataset")!.handler({
            projectId: PROJECT_ID,
            datasetId: DATASET_ID,
        })) as { structuredContent: { data: Record<string, unknown> } };

        expect(result.structuredContent.data).toEqual({
            datasetId: DATASET_ID,
            sourceDatasetId: DATASET_ID,
            createdDatasetId: "22222222-2222-4222-8222-222222222222",
        });
        expect(mocks.duplicateDatasetPayload).toHaveBeenCalledWith(
            runtime.db,
            expect.objectContaining({
                projectId: PROJECT_ID,
                datasetId: DATASET_ID,
            }),
        );
    });

    it("uses principal scope for item and lifecycle mutations", async () => {
        const { tools, runtime } = registerTools();
        mocks.createDatasetItemPayload.mockResolvedValue({
            datasetId: DATASET_ID,
        });
        mocks.updateDatasetNamePayload.mockResolvedValue(undefined);

        await tools.get("add_dataset_item")!.handler({
            projectId: PROJECT_ID,
            datasetId: DATASET_ID,
            inputText: "hello",
            label: { answer: "world" },
        });
        await tools.get("rename_dataset")!.handler({
            projectId: PROJECT_ID,
            datasetId: DATASET_ID,
            name: "Renamed",
        });

        expect(mocks.createDatasetItemPayload).toHaveBeenCalledWith(
            runtime.db,
            {
                teamId: "team-1",
                projectId: PROJECT_ID,
                datasetId: DATASET_ID,
                inputText: "hello",
                label: { answer: "world" },
            },
        );
        expect(mocks.updateDatasetNamePayload).toHaveBeenCalledWith(
            runtime.db,
            {
                teamId: "team-1",
                projectId: PROJECT_ID,
                datasetId: DATASET_ID,
                name: "Renamed",
            },
        );
    });

    it("converts base64 item media through the existing form payload", async () => {
        const { tools, runtime } = registerTools();
        const audio = {
            name: "sample.mp3",
            mimeType: "audio/mpeg",
            size: 3,
            base64Data: "YWJj",
        };
        mocks.createDatasetItemFromFormPayload.mockResolvedValue({
            datasetId: DATASET_ID,
        });

        await tools.get("add_dataset_item")!.handler({
            projectId: PROJECT_ID,
            datasetId: DATASET_ID,
            inputText: "",
            label: "transcript",
            audio,
        });

        expect(mocks.createDatasetItemFromFormPayload).toHaveBeenCalledWith(
            runtime.db,
            runtime.config,
            {
                teamId: "team-1",
                projectId: PROJECT_ID,
                datasetId: DATASET_ID,
                inputText: "",
                rawLabel: "transcript",
                audio,
            },
        );
    });

    it("passes audio imports to the existing payloads", async () => {
        const { tools, runtime } = registerTools();
        const audio = [
            {
                name: "sample.wav",
                mimeType: "audio/wav",
                size: 3,
                base64Data: "YWJj",
            },
        ];
        mocks.importAudioPayload.mockResolvedValue({
            importedCount: 1,
            failures: [],
        });

        await tools.get("import_dataset_audio")!.handler({
            projectId: PROJECT_ID,
            datasetId: DATASET_ID,
            audio,
        });

        expect(mocks.importAudioPayload).toHaveBeenCalledWith(
            runtime.db,
            runtime.config,
            {
                teamId: "team-1",
                projectId: PROJECT_ID,
                datasetId: DATASET_ID,
                audio,
            },
        );
    });

    it("previews and commits mapped speaker-turn answers through shared payloads", async () => {
        const { tools, runtime } = registerTools();
        const answerFiles = [
            {
                fileName: "sample.json",
                content: JSON.stringify({
                    transcript: [{ text: "Hello", speaker: "A" }],
                }),
            },
        ];
        const mapping = {
            transcript: "expectedSpeakerTurns" as const,
            __derivedExpectedTranscript: "expectedTranscript" as const,
        };

        await tools.get("preview_dataset_golden_answers")!.handler({
            projectId: PROJECT_ID,
            datasetId: DATASET_ID,
            answerFiles,
        });
        await tools.get("commit_dataset_golden_answers")!.handler({
            projectId: PROJECT_ID,
            datasetId: DATASET_ID,
            answerFiles,
            mapping,
            confirm: true,
        });

        expect(mocks.previewGoldenAnswersPayload).toHaveBeenCalledWith(
            runtime.db,
            expect.objectContaining({
                teamId: "team-1",
                projectId: PROJECT_ID,
                datasetId: DATASET_ID,
                answersContent: "",
                answerFiles,
            }),
        );
        expect(mocks.commitGoldenAnswersPayload).toHaveBeenCalledWith(
            runtime.db,
            expect.objectContaining({
                teamId: "team-1",
                projectId: PROJECT_ID,
                datasetId: DATASET_ID,
                answersContent: "",
                answerFiles,
                mapping,
            }),
        );
    });

    it("rejects image and audio media on the same dataset item", () => {
        const schema =
            registerTools().tools.get("add_dataset_item")!.config.inputSchema!;
        const base = {
            projectId: PROJECT_ID,
            datasetId: DATASET_ID,
            inputText: "",
        };
        const image = mediaFile("image.png", "image/png");
        const audio = mediaFile("audio.wav", "audio/wav");

        expect(schema.safeParse({ ...base, image }).success).toBe(true);
        expect(schema.safeParse({ ...base, audio }).success).toBe(true);
        expect(schema.safeParse({ ...base, image, audio }).success).toBe(false);
    });

    it("rejects setting and clearing a label in the same update", () => {
        const schema = registerTools().tools.get("update_dataset_item")!.config
            .inputSchema!;
        const base = {
            projectId: PROJECT_ID,
            itemId: ITEM_ID,
            inputText: "hello",
        };

        expect(
            schema.safeParse({ ...base, label: { answer: "yes" } }).success,
        ).toBe(true);
        expect(schema.safeParse({ ...base, clearLabel: true }).success).toBe(
            true,
        );
        expect(
            schema.safeParse({
                ...base,
                label: { answer: "yes" },
                clearLabel: false,
            }).success,
        ).toBe(true);
        expect(
            schema.safeParse({
                ...base,
                label: { answer: "yes" },
                clearLabel: true,
            }).success,
        ).toBe(false);
    });

    it.each([
        [
            "import_dataset_images",
            { images: [mediaFile("image.png", "image/png")] },
        ],
        [
            "import_dataset_image_answers",
            {
                images: [mediaFile("image.png", "image/png")],
                answersContent: "filename,answer\nimage.png,yes",
            },
        ],
        [
            "import_dataset_paired_items",
            {
                images: [mediaFile("image.png", "image/png")],
                csvContent: "filename,answer\nimage.png,yes",
            },
        ],
        [
            "import_dataset_audio",
            { audio: [mediaFile("audio.wav", "audio/wav")] },
        ],
        [
            "import_dataset_audio_answers",
            {
                audio: [mediaFile("audio.wav", "audio/wav")],
                answersContent: "filename,transcript\naudio.wav,hello",
            },
        ],
    ] as const)("accepts backend-sized media batches for %s", (name, extra) => {
        const schema = registerTools().tools.get(name)!.config.inputSchema!;
        expect(
            schema.safeParse({
                projectId: PROJECT_ID,
                datasetId: DATASET_ID,
                ...extra,
            }).success,
        ).toBe(true);
    });

    it("bounds media file count, per-file size, and batch size by backend caps", () => {
        const tools = registerTools().tools;
        const imageSchema = tools.get("import_dataset_images")!.config
            .inputSchema!;
        const audioSchema = tools.get("import_dataset_audio")!.config
            .inputSchema!;
        const base = { projectId: PROJECT_ID, datasetId: DATASET_ID };
        const image = mediaFile("image.png", "image/png");
        const audio = mediaFile("audio.wav", "audio/wav");

        expect(
            imageSchema.safeParse({
                ...base,
                images: Array.from(
                    { length: DATASET_IMPORT_LIMITS.maxFileCount },
                    (_, index) => ({ ...image, name: `image-${index}.png` }),
                ),
            }).success,
        ).toBe(true);
        expect(
            imageSchema.safeParse({
                ...base,
                images: Array.from(
                    { length: DATASET_IMPORT_LIMITS.maxFileCount + 1 },
                    (_, index) => ({ ...image, name: `image-${index}.png` }),
                ),
            }).success,
        ).toBe(false);
        expect(
            imageSchema.safeParse({
                ...base,
                images: [
                    {
                        ...image,
                        size: DATASET_IMPORT_LIMITS.maxImageFileBytes + 1,
                    },
                ],
            }).success,
        ).toBe(false);
        expect(
            imageSchema.safeParse({
                ...base,
                images: [
                    {
                        ...image,
                        size: DATASET_IMPORT_LIMITS.maxImageBatchBytes / 2 + 1,
                    },
                    {
                        ...image,
                        name: "image-2.png",
                        size: DATASET_IMPORT_LIMITS.maxImageBatchBytes / 2 + 1,
                    },
                ],
            }).success,
        ).toBe(false);

        expect(
            audioSchema.safeParse({
                ...base,
                audio: Array.from(
                    { length: DATASET_IMPORT_LIMITS.maxFileCount + 1 },
                    (_, index) => ({ ...audio, name: `audio-${index}.wav` }),
                ),
            }).success,
        ).toBe(false);
        expect(
            audioSchema.safeParse({
                ...base,
                audio: [
                    {
                        ...audio,
                        size: DATASET_IMPORT_LIMITS.maxAudioFileBytes + 1,
                    },
                ],
            }).success,
        ).toBe(false);
        expect(
            audioSchema.safeParse({
                ...base,
                audio: [
                    {
                        ...audio,
                        size:
                            Math.floor(
                                DATASET_IMPORT_LIMITS.maxAudioBatchBytes / 3,
                            ) + 1,
                    },
                    {
                        ...audio,
                        name: "audio-2.wav",
                        size:
                            Math.floor(
                                DATASET_IMPORT_LIMITS.maxAudioBatchBytes / 3,
                            ) + 1,
                    },
                    {
                        ...audio,
                        name: "audio-3.wav",
                        size:
                            Math.floor(
                                DATASET_IMPORT_LIMITS.maxAudioBatchBytes / 3,
                            ) + 1,
                    },
                ],
            }).success,
        ).toBe(false);
    });

    it.each([
        ["import_dataset_text_items", { format: "jsonl", content: "{}" }],
        ["import_dataset_golden_answers", { answersContent: "{}" }],
        [
            "import_dataset_image_answers",
            {
                images: [mediaFile("image.png", "image/png")],
                answersContent: "{}",
            },
        ],
        [
            "import_dataset_paired_items",
            {
                images: [mediaFile("image.png", "image/png")],
                csvContent: "filename,answer\nimage.png,yes",
            },
        ],
        [
            "import_dataset_audio_answers",
            {
                audio: [mediaFile("audio.wav", "audio/wav")],
                answersContent: "{}",
            },
        ],
    ] as const)("bounds backend text import bytes for %s", (name, extra) => {
        const schema = registerTools().tools.get(name)!.config.inputSchema!;
        const valid = {
            projectId: PROJECT_ID,
            datasetId: DATASET_ID,
            ...extra,
        };
        expect(schema.safeParse(valid).success).toBe(true);

        const textKey =
            "content" in extra
                ? "content"
                : "answersContent" in extra
                  ? "answersContent"
                  : "csvContent";
        expect(
            schema.safeParse({
                ...valid,
                [textKey]: "é".repeat(
                    Math.floor(DATASET_IMPORT_LIMITS.maxTextBytes / 2) + 1,
                ),
            }).success,
        ).toBe(false);
    });

    it.each([
        "preview_dataset_golden_answers",
        "commit_dataset_golden_answers",
    ] as const)("bounds answer file count and total bytes for %s", (name) => {
        const schema = registerTools().tools.get(name)!.config.inputSchema!;
        const extra =
            name === "commit_dataset_golden_answers"
                ? {
                      mapping: { transcript: "expectedTranscript" },
                      confirm: true,
                  }
                : {};
        const valid = {
            projectId: PROJECT_ID,
            datasetId: DATASET_ID,
            answerFiles: [{ fileName: "answers.json", content: "{}" }],
            ...extra,
        };

        expect(schema.safeParse(valid).success).toBe(true);
        expect(
            schema.safeParse({
                ...valid,
                answerFiles: Array.from(
                    { length: DATASET_IMPORT_LIMITS.maxFileCount + 1 },
                    (_, index) => ({
                        fileName: `answers-${index}.json`,
                        content: "{}",
                    }),
                ),
            }).success,
        ).toBe(false);
        expect(
            schema.safeParse({
                ...valid,
                answerFiles: [
                    {
                        fileName: "a.json",
                        content: "x".repeat(
                            Math.floor(DATASET_IMPORT_LIMITS.maxTextBytes / 2) +
                                1,
                        ),
                    },
                    {
                        fileName: "b.json",
                        content: "y".repeat(
                            Math.floor(DATASET_IMPORT_LIMITS.maxTextBytes / 2) +
                                1,
                        ),
                    },
                ],
            }).success,
        ).toBe(false);
    });
});

function registerTools() {
    return createToolHarness(registerDatasetTools);
}

function mediaFile(name: string, mimeType: string) {
    return { name, mimeType, size: 3, base64Data: "YWJj" };
}
