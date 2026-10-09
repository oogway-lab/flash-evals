import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    createDatasetPayload,
    createDatasetItemPayload,
    createDatasetItemFromFormPayload,
    deleteDatasetPayload,
    deleteDatasetItemPayload,
    deleteLabelPayload,
    duplicateDatasetPayload,
    datasetDetailPayload,
    importAudioAnswersPayload,
    importAudioPayload,
    importImagesPayload,
    importTextItemsPayload,
    previewGoldenAnswersPayload,
    commitGoldenAnswersPayload,
    listDatasetsPayload,
    setDatasetArchivedPayload,
    signUploadPayload,
    writeLocalUpload,
    updateDatasetItemPayload,
    updateDatasetNamePayload,
} from "./datasets.js";
import { isStorageKey, localMediaPath } from "../mediaPaths.js";
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import { resolveApiFeatureFlags } from "../featureFlags.js";

function dbWithRows(rows: unknown[] | unknown[][]): IDb {
    const queue = Array.isArray(rows[0])
        ? [...(rows as unknown[][])]
        : [rows as unknown[]];
    return {
        query: vi.fn(async () => ({ rows: queue.shift() ?? [] }) as never),
    };
}

const config: IApiConfig = {
    nodeEnv: "test",
    port: 3001,
    databaseUrl: "postgres://example",
    storageAdapter: "supabase",
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role",
    supabaseStorageBucket: "mosaic-images",
    clerkSecretKey: "sk_test",
    mosaicTenancyMode: "single-org",
    mosaicAllowedEmailDomain: "example.com",
    mosaicLlmProvider: "openai",
    corsOrigins: [],
    sttCapabilityProbes: {},
    profilingEnabled: false,
    featureFlags: resolveApiFeatureFlags({}),
};

describe("mapped golden answer import", () => {
    const dataset = {
        id: "dataset-1",
        team_id: "team-1",
        project_id: "project-1",
        name: "Audio",
        purpose: "golden" as const,
        modality: "audio" as const,
        pipeline_id: null,
        description: null,
        archived_at: null,
        created_by: "user-1",
        created_at: new Date(),
    };
    const item = {
        id: "item-1",
        input_text: null,
        source_name: "test_audio_1.wav",
        has_label: false,
    };
    const answerFiles = [
        {
            fileName: "test_audio_1.json",
            content: JSON.stringify({
                user_id: "0Q7-user",
                memory_id: "memory-1",
                title: "Daily note",
                mom: "Meeting summary",
                transcript: "hello",
            }),
        },
    ];

    it("previews and commits the field-report record with source metadata", async () => {
        const input = {
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            answersContent: "",
            answerFiles,
        };
        const preview = await previewGoldenAnswersPayload(
            dbWithRows([[dataset], [], [item]]),
            input,
        );
        expect(preview).toMatchObject({
            importableCount: 1,
            failingCount: 0,
            proposedMapping: { transcript: "expectedTranscript" },
            rows: [
                {
                    itemId: "item-1",
                    label: {
                        expectedTranscript: "hello",
                        sourceMetadata: {
                            user_id: "0Q7-user",
                            memory_id: "memory-1",
                            title: "Daily note",
                            mom: "Meeting summary",
                        },
                    },
                },
            ],
        });

        const db = dbWithRows([[dataset], [], [item], []]);
        await expect(
            commitGoldenAnswersPayload(db, {
                ...input,
                mapping: preview.proposedMapping,
            }),
        ).resolves.toEqual({ importedCount: 1, failures: [] });
        expect(vi.mocked(db.query).mock.calls[3]?.[1]).toEqual([
            "item-1",
            expect.objectContaining({
                expectedTranscript: "hello",
                sourceMetadata: expect.objectContaining({
                    user_id: "0Q7-user",
                    memory_id: "memory-1",
                }),
            }),
            "team-1",
            "project-1",
        ]);
    });

    it("commits diarized transcript turns with the derived gold transcript", async () => {
        const input = {
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            answersContent: "",
            answerFiles: [
                {
                    fileName: "test_audio_1.json",
                    content: JSON.stringify({
                        transcript: [
                            { text: "Hello.", speaker: "Priyanshu" },
                            { text: "Welcome back.", speaker: "Asha" },
                        ],
                    }),
                },
            ],
        };
        const preview = await previewGoldenAnswersPayload(
            dbWithRows([[dataset], [], [item]]),
            input,
        );
        expect(preview).toMatchObject({
            importableCount: 1,
            failingCount: 0,
        });

        const db = dbWithRows([[dataset], [], [item], []]);
        await expect(
            commitGoldenAnswersPayload(db, {
                ...input,
                mapping: preview.proposedMapping,
            }),
        ).resolves.toEqual({ importedCount: 1, failures: [] });
        expect(vi.mocked(db.query).mock.calls[3]?.[1]?.[1]).toMatchObject({
            expectedSpeakerTurns: [
                { text: "Hello.", speaker: "Priyanshu" },
                { text: "Welcome back.", speaker: "Asha" },
            ],
            expectedTranscript: "Hello. Welcome back.",
        });
    });

    it("counts legacy content and file batches together for the payload cap", async () => {
        const preview = await previewGoldenAnswersPayload(dbWithRows([]), {
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            answersContent: "x".repeat(2 * 1024 * 1024),
            answerFiles,
        });

        expect(preview).toMatchObject({
            failingCount: 1,
            rows: [
                {
                    messages: [expect.stringContaining("payload limit")],
                },
            ],
        });
    });

    it("does not overwrite a label created after a single-record preview", async () => {
        const responses = [
            { rows: [dataset], rowCount: 1 },
            { rows: [], rowCount: 0 },
            { rows: [item], rowCount: 1 },
            { rows: [], rowCount: 0 },
        ];
        const db: IDb = {
            query: vi.fn(async () => responses.shift() as never),
        };

        await expect(
            commitGoldenAnswersPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                answersContent: "",
                answerFiles,
                mapping: { transcript: "expectedTranscript" },
            }),
        ).resolves.toEqual({
            importedCount: 0,
            failures: [
                {
                    row: 1,
                    fileName: "test_audio_1.json",
                    reason: expect.stringContaining("gained an answer"),
                },
            ],
        });
        expect(vi.mocked(db.query).mock.calls[3]?.[0]).toContain(
            "on conflict (dataset_item_id) do nothing",
        );
    });
});

describe("createDatasetPayload", () => {
    it("creates a dataset only inside a project owned by the team", async () => {
        const db = dbWithRows([[{ id: "project-1" }], [{ id: "dataset-1" }]]);

        await expect(
            createDatasetPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                name: "Dataset",
                purpose: "golden",
                modality: "image",
                createdBy: "user-1",
            }),
        ).resolves.toEqual({ id: "dataset-1" });
        expect(db.query).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining(
                "from projects where id = $1 and team_id = $2",
            ),
            ["project-1", "team-1"],
        );
    });

    it("rejects a project owned by another team before inserting", async () => {
        const db = dbWithRows([]);

        await expect(
            createDatasetPayload(db, {
                teamId: "team-1",
                projectId: "project-from-team-2",
                name: "Dataset",
                purpose: "golden",
                modality: "image",
                createdBy: "user-1",
            }),
        ).rejects.toThrow("Project not found.");
        expect(db.query).toHaveBeenCalledTimes(1);
    });
});

describe("listDatasetsPayload", () => {
    it("keeps project A and project B dataset queries isolated", async () => {
        const projectADb = dbWithRows([]);
        const projectBDb = dbWithRows([]);

        await listDatasetsPayload(projectADb, "team-1", "project-a");
        await listDatasetsPayload(projectBDb, "team-1", "project-b");

        expect(projectADb.query).toHaveBeenCalledWith(expect.any(String), [
            "team-1",
            "project-a",
            false,
            false,
        ]);
        expect(projectBDb.query).toHaveBeenCalledWith(expect.any(String), [
            "team-1",
            "project-b",
            false,
            false,
        ]);
    });

    it("returns enriched dataset rows with runnable and archived flags", async () => {
        const db = dbWithRows([
            {
                id: "dataset-1",
                name: "Golden",
                purpose: "golden",
                modality: "image",
                created_at: new Date("2026-07-06T08:00:00.000Z"),
                item_count: 2,
                labeled_item_count: 1,
                archived_at: null,
            },
            {
                id: "dataset-2",
                name: "Eval",
                purpose: "evaluation",
                modality: "text",
                created_at: "2026-07-05T08:00:00.000Z",
                item_count: "3",
                labeled_item_count: "0",
                archived_at: "2026-07-06T09:00:00.000Z",
            },
        ]);

        await expect(
            listDatasetsPayload(db, "team-1", "project-1", {
                includeArchived: true,
            }),
        ).resolves.toEqual([
            {
                id: "dataset-1",
                name: "Golden",
                purpose: "golden",
                modality: "image",
                createdAt: "2026-07-06T08:00:00.000Z",
                itemCount: 2,
                labeledItemCount: 1,
                isRunnable: true,
                archived: false,
            },
            {
                id: "dataset-2",
                name: "Eval",
                purpose: "evaluation",
                modality: "text",
                createdAt: "2026-07-05T08:00:00.000Z",
                itemCount: 3,
                labeledItemCount: 0,
                isRunnable: true,
                archived: true,
            },
        ]);
        expect(db.query).toHaveBeenCalledWith(expect.any(String), [
            "team-1",
            "project-1",
            true,
            false,
        ]);
    });

    it("requires labels before golden datasets are runnable", async () => {
        const db = dbWithRows([
            {
                id: "dataset-1",
                name: "Golden",
                purpose: "golden",
                modality: "image",
                created_at: new Date("2026-07-06T08:00:00.000Z"),
                item_count: 2,
                labeled_item_count: 0,
                archived_at: null,
            },
        ]);

        const [row] = await listDatasetsPayload(db, "team-1", "project-1");

        expect(row?.isRunnable).toBe(false);
        expect(db.query).toHaveBeenCalledWith(expect.any(String), [
            "team-1",
            "project-1",
            false,
            false,
        ]);
    });

    it("requests archived rows without loading active rows", async () => {
        const db = dbWithRows([]);

        await listDatasetsPayload(db, "team-1", "project-1", {
            archivedOnly: true,
        });

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("d.archived_at is not null"),
            ["team-1", "project-1", true, true],
        );
    });
});

describe("datasetDetailPayload", () => {
    it("returns dataset items, labels, and legacy schema detail", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    name: "Food",
                    purpose: "golden",
                    modality: "image",
                    pipeline_id: null,
                    description: "Meals",
                    archived_at: null,
                },
            ],
            [
                {
                    id: "item-1",
                    type: "image",
                    input_text: null,
                    source_name: "plate.jpg",
                    storage_key: "storage-1",
                    mime_type: "image/jpeg",
                },
            ],
            [
                {
                    json_schema: {
                        type: "object",
                        properties: { answer: { type: "string" } },
                        required: ["answer"],
                        additionalProperties: false,
                    },
                },
            ],
            [{ dataset_item_id: "item-1", label_json: { answer: "salad" } }],
        ]);

        await expect(
            datasetDetailPayload(db, "team-1", "project-1", "dataset-1"),
        ).resolves.toEqual({
            dataset: {
                id: "dataset-1",
                teamId: "team-1",
                name: "Food",
                purpose: "golden",
                modality: "image",
                pipelineId: null,
                description: "Meals",
                archivedAt: null,
            },
            items: [
                {
                    id: "item-1",
                    type: "image",
                    inputText: null,
                    sourceName: "plate.jpg",
                    storageKey: "storage-1",
                    mimeType: "image/jpeg",
                },
            ],
            labels: [{ answer: "salad" }],
            itemCount: 1,
            labeledItemCount: 1,
            labelMode: "legacySchema",
            answerSchema: {
                fields: [{ name: "answer", type: "string", required: true }],
                additionalProperties: false,
            },
            freeformLabel: false,
            isRunnable: true,
        });
    });
});

describe("dataset lifecycle mutations", () => {
    const ownedDataset = {
        id: "dataset-1",
        team_id: "team-1",
        name: "Food",
        purpose: "golden",
        modality: "image",
        pipeline_id: null,
        description: null,
        archived_at: null,
        created_by: "user-1",
        created_at: new Date("2026-07-06T08:00:00.000Z"),
    };

    it("archives an owned dataset", async () => {
        const db = dbWithRows([[ownedDataset], []]);

        await expect(
            setDatasetArchivedPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                archived: true,
            }),
        ).resolves.toBeUndefined();
        expect(db.query).toHaveBeenLastCalledWith(
            expect.stringContaining("now()"),
            ["dataset-1", "team-1", "project-1"],
        );
    });

    it("refuses to rename an archived dataset", async () => {
        const db = dbWithRows([[{ ...ownedDataset, archived_at: new Date() }]]);

        await expect(
            updateDatasetNamePayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                name: "New",
            }),
        ).rejects.toThrow("archived");
    });

    it("duplicates an owned dataset with item labels", async () => {
        const db = dbWithRows([
            [ownedDataset],
            [{ id: "copy-1" }],
            [],
            [
                {
                    id: "item-1",
                    type: "image",
                    input_text: "Input",
                    source_name: "plate.jpg",
                    storage_key: "storage-1",
                    mime_type: "image/jpeg",
                    label_json: { answer: "salad" },
                },
            ],
            [{ id: "copy-item-1" }],
            [],
        ]);

        await expect(
            duplicateDatasetPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                createdBy: "user-1",
            }),
        ).resolves.toBeUndefined();
        expect(vi.mocked(db.query).mock.calls[1]?.[1]).toEqual([
            "team-1",
            "project-1",
            "Copy of Food",
            "golden",
            "image",
            null,
            null,
            "user-1",
        ]);
        expect(db.query).toHaveBeenLastCalledWith(
            expect.stringContaining("labels"),
            ["copy-item-1", { answer: "salad" }],
        );
    });

    it("blocks dataset delete when runs use it", async () => {
        const db = dbWithRows([[ownedDataset], [{ count: 1 }]]);

        await expect(
            deleteDatasetPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
            }),
        ).rejects.toThrow("Delete the runs");
    });
});

describe("deleteLabelPayload", () => {
    it("deletes a label for an item owned by the requesting team", async () => {
        const db = dbWithRows([
            [{ dataset_id: "dataset-1", team_id: "team-1" }],
            [],
        ]);

        await expect(
            deleteLabelPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                itemId: "item-1",
            }),
        ).resolves.toEqual({ datasetId: "dataset-1" });
        expect(db.query).toHaveBeenLastCalledWith(
            expect.stringContaining("d.project_id = $3"),
            ["item-1", "team-1", "project-1"],
        );
    });

    it("does not delete labels for another team's item", async () => {
        const db = dbWithRows([[]]);

        await expect(
            deleteLabelPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                itemId: "item-1",
            }),
        ).rejects.toThrow("Dataset item not found");
    });

    it("does not delete labels for an item in another project", async () => {
        const db = dbWithRows([[]]);

        await expect(
            deleteLabelPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                itemId: "item-in-project-2",
            }),
        ).rejects.toThrow("Dataset item not found");
        expect(db.query).toHaveBeenCalledTimes(1);
    });
});

describe("dataset item mutations", () => {
    it("uploads image bytes and creates an item from form input", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue({ ok: true } as Response);
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    name: "Dataset",
                    purpose: "evaluation",
                    modality: "image",
                    pipeline_id: null,
                    description: null,
                    archived_at: null,
                    created_by: "user-1",
                    created_at: new Date(),
                },
            ],
            [],
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    name: "Dataset",
                    purpose: "evaluation",
                    modality: "image",
                    pipeline_id: null,
                    description: null,
                    archived_at: null,
                    created_by: "user-1",
                    created_at: new Date(),
                },
            ],
            [{ id: "item-1" }],
        ]);

        await expect(
            createDatasetItemFromFormPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                inputText: "",
                rawLabel: "",
                image: {
                    name: "plate.png",
                    mimeType: "image/png",
                    size: 5,
                    base64Data: Buffer.from("bytes").toString("base64"),
                },
            }),
        ).resolves.toEqual({ datasetId: "dataset-1" });

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining("/storage/v1/object/mosaic-images/"),
            expect.objectContaining({ method: "POST" }),
        );
        expect(vi.mocked(db.query).mock.calls[3]?.[1]).toEqual([
            "dataset-1",
            "image",
            null,
            "plate.png",
            expect.any(String),
            "image/png",
            "team-1",
            "project-1",
        ]);
        fetchMock.mockRestore();
    });

    it("rejects imported image payloads whose declared size does not match decoded bytes", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue({ ok: true } as Response);
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    name: "Dataset",
                    purpose: "evaluation",
                    modality: "image",
                    pipeline_id: null,
                    description: null,
                    archived_at: null,
                    created_by: "user-1",
                    created_at: new Date(),
                },
            ],
            [],
        ]);

        await expect(
            importImagesPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                images: [
                    {
                        name: "plate.png",
                        mimeType: "image/png",
                        size: 0,
                        base64Data: Buffer.from("bytes").toString("base64"),
                    },
                ],
            }),
        ).resolves.toEqual({
            importedCount: 0,
            failures: [
                {
                    fileName: "plate.png",
                    reason: "Image size does not match the uploaded bytes.",
                },
            ],
        });
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockRestore();
    });

    it("imports audio bytes for an audio dataset", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue({ ok: true } as Response);
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    name: "Dataset",
                    purpose: "evaluation",
                    modality: "audio",
                    pipeline_id: null,
                    description: null,
                    archived_at: null,
                    created_by: "user-1",
                    created_at: new Date(),
                },
            ],
            [],
            [{ id: "dataset-1", team_id: "team-1", archived_at: null }],
            [{ id: "item-1" }],
        ]);

        await expect(
            importAudioPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                audio: [
                    {
                        name: "sample.webm",
                        mimeType: "audio/webm",
                        size: 5,
                        base64Data: Buffer.from("audio").toString("base64"),
                    },
                ],
            }),
        ).resolves.toEqual({ importedCount: 1, failures: [] });

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining("/storage/v1/object/mosaic-images/"),
            expect.objectContaining({ method: "POST" }),
        );
        expect(vi.mocked(db.query).mock.calls[3]?.[1]).toEqual([
            "dataset-1",
            "audio",
            null,
            "sample.webm",
            expect.any(String),
            "audio/webm",
            "team-1",
            "project-1",
        ]);
        fetchMock.mockRestore();
    });

    it("imports audio bytes with STT reference answers for a freeform golden audio dataset", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue({ ok: true } as Response);
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    name: "Dataset",
                    purpose: "golden",
                    modality: "audio",
                    pipeline_id: null,
                    description: null,
                    archived_at: null,
                    created_by: "user-1",
                    created_at: new Date(),
                },
            ],
            [],
            [{ id: "dataset-1", team_id: "team-1", archived_at: null }],
            [{ id: "item-1" }],
        ]);

        await expect(
            importAudioAnswersPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                audio: [
                    {
                        name: "sample.webm",
                        mimeType: "audio/webm",
                        size: 5,
                        base64Data: Buffer.from("audio").toString("base64"),
                    },
                ],
                answersContent: JSON.stringify({
                    filename: "sample.webm",
                    label: {
                        referenceKind: "human_gold",
                        expectedTranscript: "नमस्ते दुनिया",
                        expectedTranscriptLatin: "namaste duniya",
                        expectedSpeakerTurns: [
                            {
                                speaker: "A",
                                text: "namaste",
                                startMs: 0,
                                endMs: 500,
                            },
                        ],
                    },
                }),
            }),
        ).resolves.toEqual({ importedCount: 1, failures: [] });

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining("/storage/v1/object/mosaic-images/"),
            expect.objectContaining({ method: "POST" }),
        );
        expect(vi.mocked(db.query).mock.calls[3]?.[1]).toEqual([
            "dataset-1",
            "audio",
            null,
            "sample.webm",
            expect.any(String),
            "audio/webm",
            "team-1",
            "project-1",
        ]);
        expect(vi.mocked(db.query).mock.calls[4]?.[1]).toEqual([
            "item-1",
            expect.objectContaining({
                referenceKind: "human_gold",
                expectedTranscript: "नमस्ते दुनिया",
                expectedTranscriptLatin: "namaste duniya",
            }),
        ]);
        fetchMock.mockRestore();
    });

    it("rejects malformed audio-answer STT labels before uploading audio", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    name: "Dataset",
                    purpose: "golden",
                    modality: "audio",
                    pipeline_id: null,
                    description: null,
                    archived_at: null,
                    created_by: "user-1",
                    created_at: new Date(),
                },
            ],
            [],
        ]);

        await expect(
            importAudioAnswersPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                audio: [
                    {
                        name: "sample.webm",
                        mimeType: "audio/webm",
                        size: 5,
                        base64Data: Buffer.from("audio").toString("base64"),
                    },
                ],
                answersContent: JSON.stringify({
                    filename: "sample.webm",
                    label: {
                        referenceKind: "human_gold",
                        expectedSpeakerTurns: [{ speaker: "S1" }],
                    },
                }),
            }),
        ).resolves.toMatchObject({
            importedCount: 0,
            failures: [
                {
                    fileName: "sample.webm",
                    reason: "expectedSpeakerTurns must contain speaker/text objects with optional numeric startMs/endMs.",
                },
            ],
        });

        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockRestore();
    });

    it("rejects malformed audio STT reference labels before uploading audio", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    name: "Dataset",
                    purpose: "golden",
                    modality: "audio",
                    pipeline_id: null,
                    description: null,
                    archived_at: null,
                    created_by: "user-1",
                    created_at: new Date(),
                },
            ],
            [],
        ]);

        await expect(
            createDatasetItemFromFormPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                inputText: "",
                rawLabel: JSON.stringify({
                    stt: {
                        referenceKind: "unknown",
                        expectedSpeakerTurns: [{ speaker: "S1" }],
                        latencySlaMs: "slow",
                        costOutlierUsd: Number.NaN,
                    },
                }),
                audio: {
                    name: "sample.webm",
                    mimeType: "audio/webm",
                    size: 5,
                    base64Data: Buffer.from("audio").toString("base64"),
                },
            }),
        ).rejects.toThrow(
            "referenceKind must be one of human_gold, silver, or prod_reference.",
        );

        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockRestore();
    });

    it.each([
        ["csv", "text,answer\nA receipt,Yes\n"],
        ["jsonl", '{"label":{"answer":"Yes"}}'],
    ] as const)(
        "rejects %s imports without input text",
        async (format, content) => {
            const db = dbWithRows([
                [
                    {
                        id: "dataset-1",
                        team_id: "team-1",
                        purpose: "golden",
                        modality: "text",
                        archived_at: null,
                    },
                ],
                [],
            ]);
            const result = await importTextItemsPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                format,
                content,
            });
            expect(result.importedCount).toBe(0);
            expect(result.failures).toEqual([
                expect.objectContaining({
                    reason: expect.stringContaining("inputText"),
                }),
            ]);
            expect(
                vi
                    .mocked(db.query)
                    .mock.calls.some(([sql]) =>
                        String(sql).includes("insert into dataset_items"),
                    ),
            ).toBe(false);
        },
    );

    it("creates an image item and label for an editable dataset", async () => {
        const db = dbWithRows([
            [{ id: "dataset-1", team_id: "team-1", archived_at: null }],
            [{ id: "item-1" }],
            [],
        ]);

        await expect(
            createDatasetItemPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                inputText: "Question",
                label: { answer: "Yes" },
                image: {
                    storageKey: "11111111-1111-4111-8111-111111111111",
                    mimeType: "image/png",
                    sourceName: "plate.png",
                },
            }),
        ).resolves.toEqual({ datasetId: "dataset-1" });

        expect(vi.mocked(db.query).mock.calls[1]?.[1]).toEqual([
            "dataset-1",
            "mixed",
            "Question",
            "plate.png",
            "11111111-1111-4111-8111-111111111111",
            "image/png",
            "team-1",
            "project-1",
        ]);
        expect(vi.mocked(db.query).mock.calls[2]?.[1]).toEqual([
            "item-1",
            { answer: "Yes" },
        ]);
    });

    it("updates an item through the requesting team's dataset", async () => {
        const db = dbWithRows([
            [
                {
                    id: "item-1",
                    dataset_id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    input_text: "Old",
                    storage_key: null,
                    mime_type: null,
                    source_name: null,
                },
            ],
            [],
            [],
        ]);

        await expect(
            updateDatasetItemPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                itemId: "item-1",
                inputText: "Updated",
                label: { answer: "Yes" },
            }),
        ).resolves.toEqual({ datasetId: "dataset-1" });

        expect(vi.mocked(db.query).mock.calls[1]?.[1]).toEqual([
            "Updated",
            null,
            null,
            null,
            "text",
            "item-1",
            "team-1",
            "project-1",
        ]);
        expect(vi.mocked(db.query).mock.calls[2]?.[1]).toEqual([
            "item-1",
            { answer: "Yes" },
            "team-1",
            "project-1",
        ]);
    });

    it("maps duplicate source names to a stable form error message", async () => {
        const db: IDb = {
            query: vi
                .fn()
                .mockResolvedValueOnce({
                    rows: [
                        {
                            id: "dataset-1",
                            team_id: "team-1",
                            archived_at: null,
                        },
                    ],
                })
                .mockRejectedValueOnce({ code: "23505" }) as never,
        };

        await expect(
            createDatasetItemPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                inputText: "",
                image: {
                    storageKey: "11111111-1111-4111-8111-111111111111",
                    mimeType: "image/png",
                    sourceName: "plate.png",
                },
            }),
        ).rejects.toThrow("An item with this source file already exists.");
    });
});

describe("signUploadPayload", () => {
    const MB = 1024 * 1024;

    function signFetchMock(): ReturnType<typeof vi.spyOn> {
        return vi.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: true,
            json: async () => ({ token: "signed-token" }),
        } as unknown as Response);
    }

    it("returns one dataset-scoped, unique signed target per file", async () => {
        const fetchMock = signFetchMock();
        const db = dbWithRows([[{ id: "project-1" }]]);

        const result = await signUploadPayload(db, config, {
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            modality: "image",
            files: [
                { fileName: "a.png", byteSize: 1024, contentType: "image/png" },
                {
                    fileName: "b.jpg",
                    byteSize: 2048,
                    contentType: "image/jpeg",
                },
            ],
        });

        expect(result.targets).toHaveLength(2);
        for (const target of result.targets) {
            expect(target.storageKey).toMatch(
                /^datasets\/dataset-1\/[a-f0-9-]{36}\.(png|jpg)$/,
            );
            expect(target.signedUrl).toContain(
                "/storage/v1/object/upload/sign/mosaic-images/datasets/dataset-1/",
            );
            expect(target.signedUrl).toContain("?token=signed-token");
        }
        expect(result.targets[0]?.storageKey).not.toBe(
            result.targets[1]?.storageKey,
        );
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining("/storage/v1/object/upload/sign/"),
            // Supabase 400s a JSON POST with an empty body, so the request must
            // carry a body — a regression here fails every sign in production.
            expect.objectContaining({ method: "POST", body: "{}" }),
        );
        fetchMock.mockRestore();
    });

    it("rejects a file one byte over the per-file cap", async () => {
        const fetchMock = signFetchMock();
        const db = dbWithRows([[{ id: "project-1" }]]);

        await expect(
            signUploadPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                modality: "image",
                files: [
                    {
                        fileName: "big.png",
                        byteSize: 20 * MB + 1,
                        contentType: "image/png",
                    },
                ],
            }),
        ).rejects.toThrow("per-file limit");
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockRestore();
    });

    it("rejects a batch over the total cap", async () => {
        const fetchMock = signFetchMock();
        const db = dbWithRows([[{ id: "project-1" }]]);

        await expect(
            signUploadPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                modality: "image",
                files: [
                    {
                        fileName: "a.png",
                        byteSize: 20 * MB,
                        contentType: "image/png",
                    },
                    {
                        fileName: "b.png",
                        byteSize: 20 * MB,
                        contentType: "image/png",
                    },
                ],
            }),
        ).rejects.toThrow("payload limit");
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockRestore();
    });

    it("rejects more files than the import file-count cap", async () => {
        const fetchMock = signFetchMock();
        const db = dbWithRows([[{ id: "project-1" }]]);
        const files = Array.from({ length: 101 }, (_unused, index) => ({
            fileName: `f${index}.png`,
            byteSize: 16,
            contentType: "image/png",
        }));

        await expect(
            signUploadPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                modality: "image",
                files,
            }),
        ).rejects.toThrow("limited to 100 files");
        expect(db.query).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockRestore();
    });

    it("rejects an unknown or foreign dataset before signing (FIX 1)", async () => {
        const fetchMock = signFetchMock();
        // assertEditableDataset -> getOwnedDataset finds no in-scope dataset.
        const db = dbWithRows([]);

        await expect(
            signUploadPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-from-team-2",
                modality: "image",
                files: [
                    {
                        fileName: "a.png",
                        byteSize: 16,
                        contentType: "image/png",
                    },
                ],
            }),
        ).rejects.toThrow("Dataset not found");
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockRestore();
    });

    it("rejects signing for an archived dataset (FIX 1)", async () => {
        const fetchMock = signFetchMock();
        // getOwnedDataset returns an archived dataset -> assertEditableDataset
        // throws a 409 before any signed URL is minted.
        const db = dbWithRows([[{ id: "dataset-1", archived_at: new Date() }]]);

        await expect(
            signUploadPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                modality: "image",
                files: [
                    {
                        fileName: "a.png",
                        byteSize: 16,
                        contentType: "image/png",
                    },
                ],
            }),
        ).rejects.toThrow("archived");
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockRestore();
    });

    it("drops an over-long file extension so the minted key validates (FIX 3)", async () => {
        const fetchMock = signFetchMock();
        const db = dbWithRows([[{ id: "dataset-1" }]]);

        const result = await signUploadPayload(db, config, {
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            modality: "image",
            files: [
                {
                    // 17-char extension exceeds DATASET_SCOPED_STORAGE_KEY's
                    // [A-Za-z0-9]{1,16} cap; it must be dropped, not truncated.
                    fileName: "photo.abcdefghijklmnopq",
                    byteSize: 1024,
                    contentType: "image/png",
                },
            ],
        });

        const key = result.targets[0]?.storageKey ?? "";
        expect(key).toMatch(/^datasets\/dataset-1\/[a-f0-9-]{36}$/);
        expect(isStorageKey(key)).toBe(true);
        fetchMock.mockRestore();
    });

    it("throws a typed 4xx when Supabase signing fails", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue({ ok: false, status: 500 } as Response);
        const db = dbWithRows([[{ id: "project-1" }]]);

        await expect(
            signUploadPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                modality: "image",
                files: [
                    {
                        fileName: "a.png",
                        byteSize: 16,
                        contentType: "image/png",
                    },
                ],
            }),
        ).rejects.toMatchObject({ status: 400 });
        fetchMock.mockRestore();
    });
});

describe("local storage adapter direct upload (U8)", () => {
    const localConfig: IApiConfig = { ...config, storageAdapter: "local" };
    const IMAGE_STORAGE_KEY =
        "datasets/dataset-1/11111111-1111-4111-8111-111111111111.png";

    function putRequest(
        body: Buffer | ReadableStream<Uint8Array>,
        headers?: HeadersInit,
    ): Request {
        return new Request("http://localhost:3001/api/datasets/upload/local", {
            method: "PUT",
            body: Buffer.isBuffer(body) ? new Uint8Array(body) : body,
            headers,
            duplex: "half",
        } as RequestInit);
    }

    function imageDataset(): Record<string, unknown> {
        return {
            id: "dataset-1",
            team_id: "team-1",
            name: "Dataset",
            purpose: "evaluation",
            modality: "image",
            pipeline_id: null,
            description: null,
            archived_at: null,
            created_by: "user-1",
            created_at: new Date(),
        };
    }

    let uploadDir: string;
    let priorUploadDir: string | undefined;

    beforeAll(async () => {
        priorUploadDir = process.env.UPLOAD_DIR;
        uploadDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "mosaic-local-upload-"),
        );
        process.env.UPLOAD_DIR = uploadDir;
    });

    afterAll(async () => {
        if (priorUploadDir === undefined) delete process.env.UPLOAD_DIR;
        else process.env.UPLOAD_DIR = priorUploadDir;
        await fs.rm(uploadDir, { recursive: true, force: true });
    });

    it("signs to a local API upload URL without calling Supabase", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const db = dbWithRows([[{ id: "project-1" }]]);

        const result = await signUploadPayload(db, localConfig, {
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            modality: "image",
            files: [
                { fileName: "a.png", byteSize: 1024, contentType: "image/png" },
            ],
        });

        expect(result.targets).toHaveLength(1);
        expect(result.targets[0]?.storageKey).toMatch(
            /^datasets\/dataset-1\/[a-f0-9-]{36}\.png$/,
        );
        expect(result.targets[0]?.signedUrl).toMatch(
            /^http:\/\/localhost:3001\/api\/datasets\/upload\/local\/datasets\/dataset-1\/[a-f0-9-]{36}\.png$/,
        );
        // No Supabase signing call is made under the local adapter.
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockRestore();
    });

    it("writes uploaded bytes to disk and verifies them on import", async () => {
        const bytes = Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Buffer.from("local-image-bytes-payload"),
        ]);
        await writeLocalUpload(
            localConfig,
            IMAGE_STORAGE_KEY,
            putRequest(bytes),
        );

        // The PUT handler wrote the object where verifyStorageObject looks.
        const stat = await fs.stat(localMediaPath(IMAGE_STORAGE_KEY));
        expect(stat.size).toBe(bytes.byteLength);

        // Import verifies via the local branch (fs.stat) and inserts without any
        // network/Supabase call.
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const db = dbWithRows([
            [imageDataset()],
            [],
            [imageDataset()],
            [{ id: "item-1" }],
        ]);

        await expect(
            importImagesPayload(db, localConfig, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                images: [
                    {
                        name: "plate.png",
                        mimeType: "image/png",
                        size: bytes.byteLength,
                        storageKey: IMAGE_STORAGE_KEY,
                    },
                ],
            }),
        ).resolves.toEqual({ importedCount: 1, failures: [] });

        expect(fetchMock).not.toHaveBeenCalled();
        // The item row references the client-provided key verbatim.
        expect(vi.mocked(db.query).mock.calls[3]?.[1]).toEqual([
            "dataset-1",
            "image",
            null,
            "plate.png",
            IMAGE_STORAGE_KEY,
            "image/png",
            "team-1",
            "project-1",
        ]);
        fetchMock.mockRestore();
    });

    it("rejects a path-traversal or malformed storageKey on the local write", async () => {
        await expect(
            writeLocalUpload(
                localConfig,
                "../secret.png",
                putRequest(Buffer.from("x")),
            ),
        ).rejects.toThrow("Invalid media storage key.");
        await expect(
            writeLocalUpload(
                localConfig,
                "datasets/dataset-1/../../escape.png",
                putRequest(Buffer.from("x")),
            ),
        ).rejects.toThrow("Invalid media storage key.");
        await expect(
            writeLocalUpload(
                localConfig,
                "/etc/passwd",
                putRequest(Buffer.from("x")),
            ),
        ).rejects.toThrow("Invalid media storage key.");
    });

    it("refuses local writes when the supabase adapter is active", async () => {
        await expect(
            writeLocalUpload(
                config,
                IMAGE_STORAGE_KEY,
                putRequest(Buffer.from("x")),
            ),
        ).rejects.toThrow("Local upload endpoint is not enabled.");
    });

    it("rejects a declared Content-Length above the cap before reading", async () => {
        const request = putRequest(Buffer.from("x"), {
            "content-length": "1025",
        });

        await expect(
            writeLocalUpload(localConfig, IMAGE_STORAGE_KEY, request, 1024),
        ).rejects.toMatchObject({ status: 413 });
        expect(request.bodyUsed).toBe(false);
    });

    it("aborts a streamed body that passes the cap and leaves no file", async () => {
        const storageKey =
            "datasets/dataset-1/22222222-2222-4222-8222-222222222222.png";

        await expect(
            writeLocalUpload(
                localConfig,
                storageKey,
                // No Content-Length: the cap has to trip mid-stream.
                putRequest(
                    new ReadableStream({
                        start(controller) {
                            controller.enqueue(new Uint8Array(800));
                            controller.enqueue(new Uint8Array(800));
                            controller.close();
                        },
                    }),
                ),
                1024,
            ),
        ).rejects.toMatchObject({ status: 413 });
        await expect(fs.stat(localMediaPath(storageKey))).rejects.toThrow();
        const siblings = await fs.readdir(
            path.dirname(localMediaPath(storageKey)),
        );
        expect(siblings.filter((name) => name.endsWith(".part"))).toEqual([]);
    });
});

describe("isStorageKey (relaxed matcher)", () => {
    it("accepts dataset-scoped and legacy keys, rejects unsafe ones", () => {
        // dataset-scoped keys minted by the signed-upload endpoint (U1)
        expect(
            isStorageKey(
                "datasets/dataset-1/11111111-1111-4111-8111-111111111111.png",
            ),
        ).toBe(true);
        expect(
            isStorageKey(
                "datasets/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.webm",
            ),
        ).toBe(true);
        // legacy bare-uuid form stays valid for backward compatibility
        expect(isStorageKey("11111111-1111-4111-8111-111111111111")).toBe(true);
        // unsafe / malformed keys are rejected
        expect(isStorageKey("../evil")).toBe(false);
        expect(isStorageKey("/datasets/x/y.png")).toBe(false);
        expect(isStorageKey("datasets/../evil/y.png")).toBe(false);
        expect(isStorageKey("datasets/x/y/../z.png")).toBe(false);
        expect(isStorageKey("not-a-key")).toBe(false);
        expect(isStorageKey("other/dataset-1/file.png")).toBe(false);
    });
});

describe("storageKey verify import (U6)", () => {
    const IMAGE_STORAGE_KEY =
        "datasets/dataset-1/11111111-1111-4111-8111-111111111111.png";

    function imageDataset(): Record<string, unknown> {
        return {
            id: "dataset-1",
            team_id: "team-1",
            name: "Dataset",
            purpose: "evaluation",
            modality: "image",
            pipeline_id: null,
            description: null,
            archived_at: null,
            created_by: "user-1",
            created_at: new Date(),
        };
    }

    const PNG_HEAD = Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
    ]);

    // HEAD answers the size check; the ranged GET returns the first bytes for
    // the magic-byte check.
    function headMock(
        contentLength: string,
        head: Uint8Array = PNG_HEAD,
    ): ReturnType<typeof vi.spyOn> {
        return vi
            .spyOn(globalThis, "fetch")
            .mockImplementation(async (_url, init) => {
                if (init?.method === "GET") {
                    return new Response(Buffer.from(head), { status: 206 });
                }
                return {
                    ok: true,
                    status: 200,
                    headers: { get: () => contentLength },
                } as unknown as Response;
            });
    }

    it("verifies a pre-uploaded object and inserts without re-uploading", async () => {
        const fetchMock = headMock("1024");
        const db = dbWithRows([
            [imageDataset()],
            [],
            [imageDataset()],
            [{ id: "item-1" }],
        ]);

        await expect(
            importImagesPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                images: [
                    {
                        name: "plate.png",
                        mimeType: "image/png",
                        size: 1024,
                        storageKey: IMAGE_STORAGE_KEY,
                    },
                ],
            }),
        ).resolves.toEqual({ importedCount: 1, failures: [] });

        // A HEAD verify was issued, and no POST upload happened.
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining(
                "/storage/v1/object/mosaic-images/datasets/dataset-1/",
            ),
            expect.objectContaining({ method: "HEAD" }),
        );
        for (const call of fetchMock.mock.calls) {
            expect((call[1] as RequestInit).method).not.toBe("POST");
        }
        // The item row references the client-provided key verbatim.
        expect(vi.mocked(db.query).mock.calls[3]?.[1]).toEqual([
            "dataset-1",
            "image",
            null,
            "plate.png",
            IMAGE_STORAGE_KEY,
            "image/png",
            "team-1",
            "project-1",
        ]);
        fetchMock.mockRestore();
    });

    it("rejects an object whose bytes do not match the declared type", async () => {
        const fetchMock = headMock(
            "1024",
            new TextEncoder().encode("<html><script>alert(1)</script>"),
        );
        const db = dbWithRows([[imageDataset()], []]);

        await expect(
            importImagesPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                images: [
                    {
                        name: "plate.png",
                        mimeType: "image/png",
                        size: 1024,
                        storageKey: IMAGE_STORAGE_KEY,
                    },
                ],
            }),
        ).resolves.toMatchObject({
            importedCount: 0,
            failures: [
                {
                    fileName: "plate.png",
                    reason: expect.stringContaining(
                        "does not match its declared type",
                    ),
                },
            ],
        });
        // The ranged read asked for just the leading bytes.
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining("/storage/v1/object/mosaic-images/"),
            expect.objectContaining({
                method: "GET",
                headers: expect.objectContaining({ Range: "bytes=0-15" }),
            }),
        );
        fetchMock.mockRestore();
    });

    it("times out a ranged read whose body stalls after the headers", async () => {
        vi.useFakeTimers();
        // Headers arrive, then the body never sends a byte until aborted.
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockImplementation(async (_url, init) => {
                if (init?.method !== "GET") {
                    return {
                        ok: true,
                        status: 200,
                        headers: { get: () => "1024" },
                    } as unknown as Response;
                }
                const signal = init.signal!;
                const body = new ReadableStream<Uint8Array>({
                    start(controller) {
                        signal.addEventListener("abort", () =>
                            controller.error(new Error("body read aborted")),
                        );
                    },
                });
                return new Response(body, { status: 206 });
            });
        const db = dbWithRows([[imageDataset()], []]);

        try {
            const result = importImagesPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                images: [
                    {
                        name: "plate.png",
                        mimeType: "image/png",
                        size: 1024,
                        storageKey: IMAGE_STORAGE_KEY,
                    },
                ],
            });
            await vi.advanceTimersByTimeAsync(15_000);

            await expect(result).resolves.toMatchObject({
                importedCount: 0,
                failures: [
                    {
                        fileName: "plate.png",
                        reason: "body read aborted",
                    },
                ],
            });
        } finally {
            fetchMock.mockRestore();
            vi.useRealTimers();
        }
    });

    it("rejects a missing object with a typed 400", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue({ ok: false, status: 404 } as Response);
        const db = dbWithRows([[imageDataset()], []]);

        await expect(
            createDatasetItemFromFormPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                inputText: "",
                rawLabel: "",
                image: {
                    name: "plate.png",
                    mimeType: "image/png",
                    size: 1024,
                    storageKey: IMAGE_STORAGE_KEY,
                },
            }),
        ).rejects.toMatchObject({
            status: 400,
            message: expect.stringContaining("Uploaded object not found"),
        });
        fetchMock.mockRestore();
    });

    it("rejects an object whose real size exceeds the per-file cap", async () => {
        const fetchMock = headMock(String(21 * 1024 * 1024));
        const db = dbWithRows([[imageDataset()], []]);

        await expect(
            createDatasetItemFromFormPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                inputText: "",
                rawLabel: "",
                image: {
                    name: "plate.png",
                    mimeType: "image/png",
                    // Client under-reported the size at sign time (R-D); the
                    // server-side Content-Length re-check catches it.
                    size: 512,
                    storageKey: IMAGE_STORAGE_KEY,
                },
            }),
        ).rejects.toMatchObject({
            status: 400,
            message: expect.stringContaining("per-file limit"),
        });
        fetchMock.mockRestore();
    });

    it("best-effort deletes the orphaned object when the insert fails", async () => {
        const fetchMock = headMock("1024");
        // Final insert returns no rows -> createDatasetItemPayload throws after
        // a successful verify, triggering orphan cleanup.
        const db = dbWithRows([[imageDataset()], [], [imageDataset()], []]);

        await expect(
            importImagesPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                images: [
                    {
                        name: "plate.png",
                        mimeType: "image/png",
                        size: 1024,
                        storageKey: IMAGE_STORAGE_KEY,
                    },
                ],
            }),
        ).resolves.toMatchObject({
            importedCount: 0,
            failures: [{ fileName: "plate.png" }],
        });

        // Orphan cleanup issued a DELETE for the client-uploaded object (R7).
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining("/storage/v1/object/mosaic-images"),
            expect.objectContaining({ method: "DELETE" }),
        );
        fetchMock.mockRestore();
    });

    it("still rejects answers on evaluation datasets", async () => {
        const db = dbWithRows([
            [{ ...imageDataset(), purpose: "evaluation", modality: "audio" }],
            [],
        ]);

        await expect(
            importAudioAnswersPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                audio: [
                    {
                        name: "sample.webm",
                        mimeType: "audio/webm",
                        size: 5,
                        storageKey:
                            "datasets/dataset-1/44444444-4444-4444-8444-444444444444.webm",
                    },
                ],
                answersContent: "{}",
            }),
        ).resolves.toMatchObject({ rejected: true });
    });

    it("rejects a storageKey scoped to a different dataset (FIX 4)", async () => {
        // createDatasetItemPayload: assertEditableDataset resolves, then the
        // storageKey binding check rejects a key minted for another dataset
        // before any object is referenced.
        const db = dbWithRows([[{ id: "dataset-1" }]]);

        await expect(
            createDatasetItemPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                inputText: "",
                image: {
                    storageKey:
                        "datasets/other-dataset/22222222-2222-4222-8222-222222222222.png",
                    mimeType: "image/png",
                    sourceName: "plate.png",
                },
            }),
        ).rejects.toMatchObject({
            status: 400,
            message: expect.stringContaining(
                "Storage key does not belong to this dataset",
            ),
        });
    });

    it("rejects a bulk-import storageKey bound to another dataset (FIX 4)", async () => {
        const fetchMock = headMock("1024");
        const db = dbWithRows([[imageDataset()], []]);

        await expect(
            importImagesPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                images: [
                    {
                        name: "plate.png",
                        mimeType: "image/png",
                        size: 1024,
                        storageKey:
                            "datasets/other-dataset/33333333-3333-4333-8333-333333333333.png",
                    },
                ],
            }),
        ).resolves.toMatchObject({
            importedCount: 0,
            failures: [
                {
                    fileName: "plate.png",
                    reason: expect.stringContaining(
                        "does not belong to this dataset",
                    ),
                },
            ],
        });
        // The binding check fails before any HEAD verify is issued.
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockRestore();
    });

    it("rejects an object with no Content-Length (FIX 5)", async () => {
        // Supabase HEAD omits Content-Length -> size unverifiable -> fail closed.
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
        } as unknown as Response);
        const db = dbWithRows([[imageDataset()], []]);

        await expect(
            importImagesPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                images: [
                    {
                        name: "plate.png",
                        mimeType: "image/png",
                        size: 1024,
                        storageKey: IMAGE_STORAGE_KEY,
                    },
                ],
            }),
        ).resolves.toMatchObject({
            importedCount: 0,
            failures: [
                {
                    fileName: "plate.png",
                    reason: expect.stringContaining(
                        "size could not be verified",
                    ),
                },
            ],
        });
        fetchMock.mockRestore();
    });

    it("rejects a 0-byte object (FIX 5)", async () => {
        const fetchMock = headMock("0");
        const db = dbWithRows([[imageDataset()], []]);

        await expect(
            importImagesPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                images: [
                    {
                        name: "plate.png",
                        mimeType: "image/png",
                        size: 0,
                        storageKey: IMAGE_STORAGE_KEY,
                    },
                ],
            }),
        ).resolves.toMatchObject({
            importedCount: 0,
            failures: [
                {
                    fileName: "plate.png",
                    reason: expect.stringContaining("empty"),
                },
            ],
        });
        fetchMock.mockRestore();
    });
});

describe("deleteDatasetItemPayload", () => {
    it("deletes an unused item owned by the requesting team", async () => {
        const db = dbWithRows([
            [{ dataset_id: "dataset-1", team_id: "team-1", archived_at: null }],
            [{ count: 0 }],
            [],
            [],
        ]);

        await expect(
            deleteDatasetItemPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                itemId: "item-1",
            }),
        ).resolves.toEqual({ datasetId: "dataset-1" });
        expect(db.query).toHaveBeenLastCalledWith(
            expect.stringContaining("d.project_id = $3"),
            ["item-1", "team-1", "project-1"],
        );
    });

    it("blocks deleting an item used by run cells", async () => {
        const db = dbWithRows([
            [{ dataset_id: "dataset-1", team_id: "team-1", archived_at: null }],
            [{ count: 1 }],
        ]);

        await expect(
            deleteDatasetItemPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                itemId: "item-1",
            }),
        ).rejects.toThrow("Delete the runs");
    });
});
