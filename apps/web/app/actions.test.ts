import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as PipelineService from "@/server/pipelines/service";
import type * as DatasetImport from "@/server/datasets/import";

const mockApiClient = vi.hoisted(() => ({
    createDataset: vi.fn(),
    createDatasetItem: vi.fn(),
    createDatasetItemFromForm: vi.fn(),
    createRun: vi.fn(),
    createRunFromSelection: vi.fn(),
    generateJudgeForRun: vi.fn(),
    importGoldenAnswers: vi.fn(),
    importAudioAnswers: vi.fn(),
    importImageAnswers: vi.fn(),
    importImages: vi.fn(),
    importPairedItems: vi.fn(),
    importTextItems: vi.fn(),
    updateDatasetItem: vi.fn(),
    updateDatasetItemFromForm: vi.fn(),
    updateDatasetName: vi.fn(),
    updateDatasetDescription: vi.fn(),
    setDatasetArchived: vi.fn(),
    duplicateDataset: vi.fn(),
    deleteDataset: vi.fn(),
    deleteRun: vi.fn(),
    retryRun: vi.fn(),
    deletePrompt: vi.fn(),
    duplicatePromptVersion: vi.fn(),
    createJudgePrompt: vi.fn(),
    generatePromptSchema: vi.fn(),
    optimizePrompt: vi.fn(),
    recordPromptValidationAttempt: vi.fn(),
    saveRunnablePrompt: vi.fn(),
    testJudgeDraft: vi.fn(),
    testPromptDraft: vi.fn(),
    validateRunnablePrompt: vi.fn(),
    deleteLabel: vi.fn(),
    deleteDatasetItem: vi.fn(),
    saveRunNote: vi.fn(),
    saveCellAnnotation: vi.fn(),
}));

import {
    addItemAction,
    archiveDatasetAction,
    deleteItemAction,
    deleteLabelAction,
    deleteDatasetAction,
    duplicateDatasetAction,
    editItemAction,
    createRunAction,
    createJudgeAction,
    deleteRunAction,
    deletePromptAction,
    duplicatePromptVersionAction,
    generateJudgeForRunAction,
    generateSchemaFromPromptAction,
    importGoldenAnswersAction,
    importAudioAnswersAction,
    importImageAnswersAction,
    optimizePromptAction,
    restoreDatasetAction,
    retryRunAction,
    saveCellAnnotationAction,
    saveRunNoteAction,
    saveRunnablePromptAction,
    testPromptDraftAction,
    testJudgeDraftAction,
    updateDatasetDescriptionAction,
    updateDatasetNameAction,
} from "./actions";
import * as datasetService from "@/server/datasets/service";
import * as pipelinesService from "@/server/pipelines/service";
import * as promptsService from "@/server/prompts/service";
import { MAX_TEXT_IMPORT_BYTES, MosaicApiError } from "@mosaic/api-contract";
import { assertSameTeam } from "@/server/auth/session";
import { requireActiveProject } from "@/server/projects/activeProject";

vi.mock("@/server/db/client", () => ({ db: {}, schema: {} }));

vi.mock("@/server/api/client", () => ({
    serverApiClient: () => mockApiClient,
}));

vi.mock("next/cache", () => ({
    revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    redirect: vi.fn(),
    unstable_rethrow: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
    requirePrincipal: vi.fn(async () => ({
        teamId: "team-1",
        userId: "user-1",
    })),
    assertSameTeam: vi.fn(),
}));

vi.mock("@/server/projects/activeProject", () => ({
    requireActiveProject: vi.fn(async () => ({
        teamId: "team-1",
        projectId: "project-1",
        userId: "user-1",
        projects: [],
    })),
}));

vi.mock("@/server/datasets/service", () => ({
    DeleteItemBlockedError: class DeleteItemBlockedError extends Error {},
    DuplicateItemSourceNameError: class DuplicateItemSourceNameError extends Error {},
    DUPLICATE_ITEM_SOURCE_NAME_MESSAGE:
        "An item with this filename already exists in the dataset.",
    getDataset: vi.fn(),
    getDatasetSchema: vi.fn(),
    getItem: vi.fn(),
    listItems: vi.fn(),
    addTextItem: vi.fn(),
    addImageItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    deleteDataset: vi.fn(),
    deleteLabel: vi.fn(),
    setDatasetArchived: vi.fn(),
    duplicateDataset: vi.fn(),
    updateDatasetName: vi.fn(),
    updateDatasetDescription: vi.fn(),
}));

vi.mock("@/server/pipelines/service", async (importOriginal) => {
    const actual = await importOriginal<typeof PipelineService>();
    return {
        ...actual,
        getPipeline: vi.fn(),
        pipelineFactualDescriptors: vi.fn(() => []),
    };
});
vi.mock("@/server/datasets/import", async (importOriginal) => {
    const actual = await importOriginal<typeof DatasetImport>();
    return {
        ...actual,
        importFreeformImageAnswerItems: vi.fn(),
    };
});
vi.mock("@/server/prompts/service", () => ({
    createPrompt: vi.fn(),
    createSchemaVersion: vi.fn(),
    recordPromptValidationAttempt: vi.fn(),
    recordPromptOptimizationAttempt: vi.fn(),
    recordPromptSchemaGenerationAttempt: vi.fn(),
    linkPromptOptimizationAttempt: vi.fn(),
    addRunnablePromptVersion: vi.fn(),
    createJudgePrompt: vi.fn(),
    savePromptDraftSampleInputs: vi.fn(),
    updatePromptMetadata: vi.fn(),
    getPromptVersion: vi.fn(),
    getPrompt: vi.fn(),
    getPromptSchemaVersion: vi.fn(),
    getPromptValidationAttempt: vi.fn(),
    listPromptVersionFitTags: vi.fn(),
    deletePrompt: vi.fn(),
}));
vi.mock("@/server/prompts/optimizer", () => ({
    optimizePrompt: vi.fn(),
}));
vi.mock("@/server/prompts/schemaGenerator", () => ({
    generateSchemaFromPrompt: vi.fn(),
}));
vi.mock("@/server/scoring/judge", () => ({
    runJudge: vi.fn(),
}));
vi.mock("@/server/judges/service", () => ({
    legacyJudgeSpec: vi.fn((modelId: string) => ({
        modelId,
        declaredInputs: ["task_input", "candidate_output", "reference"],
    })),
    createJudgeConfig: vi.fn(),
}));
vi.mock("@/server/runs/service", () => ({
    createRun: vi.fn(),
    deleteRun: vi.fn(),
    getRun: vi.fn(),
}));
vi.mock("@/server/jobs/runQueue", () => ({
    enqueueRun: vi.fn(),
}));

const jsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["answer"],
    properties: {
        answer: { type: "string" },
    },
};

function passedPromptValidation(sampleName = "Sample") {
    return {
        passed: true,
        evidence: {
            staticChecks: [],
            schemaValidation: {
                localValid: true,
                openaiCompatible: true,
                errors: [],
            },
            sampleResults: [
                {
                    sampleName,
                    status: "passed" as const,
                    rawOutput: '{"answer":"yes"}',
                    parsedOutput: { answer: "yes" },
                    errors: [],
                },
            ],
        },
    };
}

function formData(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
}

const baseDataset = {
    id: "dataset-1",
    teamId: "team-1",
    projectId: "project-1",
    name: "Dataset",
    purpose: "golden" as const,
    pipelineId: null,
    modality: "image" as const,
    description: null,
    archivedAt: null,
    createdBy: "user-1",
    createdAt: new Date(),
};

describe("addItemAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockApiClient.createDatasetItem.mockResolvedValue({
            datasetId: "dataset-1",
        });
        mockApiClient.createDatasetItemFromForm.mockResolvedValue({
            datasetId: "dataset-1",
        });
        mockApiClient.updateDatasetItem.mockResolvedValue({
            datasetId: "dataset-1",
        });
        mockApiClient.updateDatasetItemFromForm.mockResolvedValue({
            datasetId: "dataset-1",
        });
        vi.mocked(datasetService.getDataset).mockResolvedValue(baseDataset);
        vi.mocked(datasetService.getDatasetSchema).mockResolvedValue({
            id: "schema-1",
            datasetId: "dataset-1",
            jsonSchema,
            fieldRules: [{ field: "answer", matcher: "exact" }],
            createdAt: new Date(),
        });
        vi.mocked(datasetService.getItem).mockResolvedValue({
            id: "item-1",
            datasetId: "dataset-1",
            type: "text",
            inputText: "Question",
            sourceName: null,
            storageKey: null,
            mimeType: null,
            createdAt: new Date(),
        });
        vi.mocked(assertSameTeam).mockImplementation(() => undefined);
    });

    it("rejects direct posts with unknown label fields before saving", async () => {
        vi.mocked(datasetService.getDatasetSchema).mockResolvedValue({
            id: "schema-1",
            datasetId: "dataset-1",
            jsonSchema,
            fieldRules: [{ field: "answer", matcher: "exact" }],
            createdAt: new Date(),
        });

        const result = await addItemAction(
            {},
            formData({
                datasetId: "dataset-1",
                inputText: "Question",
                label: JSON.stringify({ answer: "Yes", notes: "extra" }),
            }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.createDatasetItemFromForm).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            inputText: "Question",
            rawLabel: JSON.stringify({ answer: "Yes", notes: "extra" }),
        });
    });

    it("saves any JSON object on an independent golden dataset", async () => {
        vi.mocked(datasetService.getDatasetSchema).mockResolvedValue(
            undefined as never,
        );

        const result = await addItemAction(
            {},
            formData({
                datasetId: "dataset-1",
                inputText: "Question",
                label: JSON.stringify({ score: 8, title: "oatmeal" }),
            }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.createDatasetItemFromForm).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            inputText: "Question",
            rawLabel: JSON.stringify({ score: 8, title: "oatmeal" }),
        });
    });

    it("saves labels keyed by schema field name", async () => {
        const result = await addItemAction(
            {},
            formData({
                datasetId: "dataset-1",
                inputText: "Question",
                label: JSON.stringify({ answer: "Yes" }),
            }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.createDatasetItemFromForm).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            inputText: "Question",
            rawLabel: JSON.stringify({ answer: "Yes" }),
        });
    });

    it("returns an image field error for duplicate image filenames", async () => {
        if (!File.prototype.arrayBuffer) {
            Object.defineProperty(File.prototype, "arrayBuffer", {
                value: async () => new ArrayBuffer(5),
                configurable: true,
            });
        }
        const image = new Blob(["bytes"], { type: "image/png" });
        const data = formData({
            datasetId: "dataset-1",
            label: JSON.stringify({ answer: "Yes" }),
        });
        data.set("image", image, "plate.png");
        mockApiClient.createDatasetItemFromForm.mockRejectedValue(
            new MosaicApiError(
                datasetService.DUPLICATE_ITEM_SOURCE_NAME_MESSAGE,
                400,
            ),
        );

        const result = await addItemAction({}, data);

        expect(result.fieldErrors?.image?.[0]).toContain("filename");
    });

    it("returns an audio field error for duplicate audio filenames", async () => {
        if (!File.prototype.arrayBuffer) {
            Object.defineProperty(File.prototype, "arrayBuffer", {
                value: async () => new ArrayBuffer(5),
                configurable: true,
            });
        }
        const data = formData({
            datasetId: "dataset-1",
            label: JSON.stringify({ answer: "Yes" }),
        });
        data.set(
            "audioUpload",
            JSON.stringify([
                {
                    storageKey: "datasets/dataset-1/call.wav",
                    name: "call.wav",
                    mimeType: "audio/wav",
                    size: 5,
                },
            ]),
        );
        mockApiClient.createDatasetItemFromForm.mockRejectedValue(
            new MosaicApiError(
                datasetService.DUPLICATE_ITEM_SOURCE_NAME_MESSAGE,
                400,
            ),
        );

        const result = await addItemAction({}, data);

        expect(result.fieldErrors?.audio?.[0]).toContain("filename");
        expect(result.fieldErrors?.image).toBeUndefined();
    });

    it("returns an image field error for duplicate filenames during image replacement", async () => {
        if (!File.prototype.arrayBuffer) {
            Object.defineProperty(File.prototype, "arrayBuffer", {
                value: async () => new ArrayBuffer(5),
                configurable: true,
            });
        }
        const image = new Blob(["bytes"], { type: "image/png" });
        const data = formData({
            itemId: "item-1",
            inputText: "Updated",
            label: JSON.stringify({ answer: "Yes" }),
        });
        data.set("image", image, "plate.png");
        mockApiClient.updateDatasetItemFromForm.mockRejectedValue(
            new MosaicApiError(
                datasetService.DUPLICATE_ITEM_SOURCE_NAME_MESSAGE,
                400,
            ),
        );

        const result = await editItemAction({}, data);

        expect(result.fieldErrors?.image?.[0]).toContain("filename");
    });

    it("returns an audio field error for duplicate filenames during audio replacement", async () => {
        if (!File.prototype.arrayBuffer) {
            Object.defineProperty(File.prototype, "arrayBuffer", {
                value: async () => new ArrayBuffer(5),
                configurable: true,
            });
        }
        const data = formData({
            itemId: "item-1",
            inputText: "Updated",
            label: JSON.stringify({ answer: "Yes" }),
        });
        data.set(
            "audioUpload",
            JSON.stringify([
                {
                    storageKey: "datasets/dataset-1/call.wav",
                    name: "call.wav",
                    mimeType: "audio/wav",
                    size: 5,
                },
            ]),
        );
        mockApiClient.updateDatasetItemFromForm.mockRejectedValue(
            new MosaicApiError(
                datasetService.DUPLICATE_ITEM_SOURCE_NAME_MESSAGE,
                400,
            ),
        );

        const result = await editItemAction({}, data);

        expect(result.fieldErrors?.audio?.[0]).toContain("filename");
        expect(result.fieldErrors?.image).toBeUndefined();
    });

    it("refuses to add an item to an archived dataset", async () => {
        mockApiClient.createDatasetItemFromForm.mockRejectedValue(
            new MosaicApiError(
                "This dataset is archived. Restore it to make changes.",
                400,
            ),
        );

        await expect(
            addItemAction(
                {},
                formData({
                    datasetId: "dataset-1",
                    inputText: "Question",
                    label: JSON.stringify({ answer: "Yes" }),
                }),
            ),
        ).rejects.toThrow("archived");
        expect(mockApiClient.createDatasetItemFromForm).toHaveBeenCalled();
    });

    it("refuses to add an image item to an archived dataset", async () => {
        mockApiClient.createDatasetItemFromForm.mockRejectedValue(
            new MosaicApiError(
                "This dataset is archived. Restore it to make changes.",
                400,
            ),
        );
        if (!File.prototype.arrayBuffer) {
            Object.defineProperty(File.prototype, "arrayBuffer", {
                value: async () => new ArrayBuffer(5),
                configurable: true,
            });
        }
        const image = new Blob(["bytes"], { type: "image/png" });
        const data = formData({
            datasetId: "dataset-1",
            label: JSON.stringify({ answer: "Yes" }),
        });
        data.set("image", image, "plate.png");

        await expect(addItemAction({}, data)).rejects.toThrow("archived");
        expect(mockApiClient.createDatasetItemFromForm).toHaveBeenCalled();
    });

    it("refuses edit attempts for another team's dataset before writing", async () => {
        mockApiClient.updateDatasetItemFromForm.mockRejectedValue(
            new MosaicApiError("Forbidden", 400),
        );

        await expect(
            editItemAction(
                {},
                formData({
                    itemId: "item-1",
                    inputText: "Updated",
                    label: JSON.stringify({ answer: "Yes" }),
                }),
            ),
        ).rejects.toThrow("Forbidden");

        expect(mockApiClient.updateDatasetItemFromForm).toHaveBeenCalled();
    });

    it("refuses to edit an item in an archived dataset", async () => {
        mockApiClient.updateDatasetItemFromForm.mockRejectedValue(
            new MosaicApiError(
                "This dataset is archived. Restore it to make changes.",
                400,
            ),
        );

        await expect(
            editItemAction(
                {},
                formData({
                    itemId: "item-1",
                    inputText: "Updated",
                    label: JSON.stringify({ answer: "Yes" }),
                }),
            ),
        ).rejects.toThrow("archived");

        expect(mockApiClient.updateDatasetItemFromForm).toHaveBeenCalled();
    });

    it("refuses delete attempts for another team's dataset before writing", async () => {
        mockApiClient.deleteDatasetItem.mockRejectedValue(
            new MosaicApiError("Forbidden", 400),
        );

        await expect(
            deleteItemAction({}, formData({ itemId: "item-1" })),
        ).rejects.toThrow("Forbidden");
    });

    it("refuses to delete an item in an archived dataset", async () => {
        mockApiClient.deleteDatasetItem.mockRejectedValue(
            new MosaicApiError("archived", 400),
        );

        await expect(
            deleteItemAction({}, formData({ itemId: "item-1" })),
        ).rejects.toThrow("archived");
    });

    it("deletes an item through the API", async () => {
        mockApiClient.deleteDatasetItem.mockResolvedValue({
            datasetId: "dataset-1",
        });

        const result = await deleteItemAction(
            {},
            formData({ itemId: "item-1" }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.deleteDatasetItem).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            itemId: "item-1",
        });
    });

    it("returns item delete blockers as form errors", async () => {
        mockApiClient.deleteDatasetItem.mockRejectedValue(
            new MosaicApiError(
                "Delete the runs that use this item before deleting it.",
                400,
            ),
        );

        const result = await deleteItemAction(
            {},
            formData({ itemId: "item-1" }),
        );

        expect(result.formError).toContain("Delete the runs");
    });

    it("deletes a label through the API", async () => {
        mockApiClient.deleteLabel.mockResolvedValue({ datasetId: "dataset-1" });

        const result = await deleteLabelAction(
            {},
            formData({ itemId: "item-1" }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.deleteLabel).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            itemId: "item-1",
        });
    });
});

describe("addItemAction (evaluation purpose)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockApiClient.createDatasetItemFromForm.mockResolvedValue({
            datasetId: "dataset-1",
        });
        vi.mocked(assertSameTeam).mockImplementation(() => undefined);
        vi.mocked(datasetService.getDataset).mockResolvedValue({
            ...baseDataset,
            name: "Eval set",
            purpose: "evaluation",
            pipelineId: "pipe-1",
        });
    });

    it("adds an image-only item with no label and never resolves an answer schema", async () => {
        await addItemAction({}, formData({ datasetId: "dataset-1" }));

        expect(mockApiClient.createDatasetItemFromForm).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            inputText: "",
            rawLabel: "",
        });
        expect(datasetService.getDatasetSchema).not.toHaveBeenCalled();
        expect(pipelinesService.getPipeline).not.toHaveBeenCalled();
    });
});

describe("createRunAction", () => {
    const pipelineOutputSchema = {
        type: "object" as const,
        properties: { answer: { type: "string" } },
    };
    // Validation failures that surface as plain Errors are logged by
    // clientErrorMessage before being rethrown; capture that expected log.
    let consoleError: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleError.mockRestore();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mockApiClient.createRunFromSelection.mockResolvedValue({
            runId: "run-1",
        });
        vi.mocked(assertSameTeam).mockImplementation(() => undefined);
        vi.mocked(datasetService.getDataset).mockResolvedValue(baseDataset);
        vi.mocked(promptsService.getPromptVersion).mockResolvedValue({
            id: "pv-1",
            promptId: "prompt-1",
            version: 3,
            content: "Return JSON.",
            schemaVersionId: "schema-version-1",
            status: "runnable",
            validationAttemptId: "validation-1",
            optimizerAttemptId: null,
            reasoningConfig: { effort: "high" },
            judgeSpec: null,
            createdBy: "user-1",
            createdAt: new Date(),
        });
        vi.mocked(promptsService.getPrompt).mockResolvedValue({
            id: "prompt-1",
            teamId: "team-1",
            projectId: "project-1",
            name: "Extract answer",
            description: null,
            kind: "eval",
            basePromptId: null,
            targetModelId: null,
            createdAt: new Date(),
        });
        vi.mocked(promptsService.getPromptSchemaVersion).mockResolvedValue({
            id: "schema-version-1",
            promptId: "prompt-1",
            version: 2,
            jsonSchema: {
                type: "object",
                additionalProperties: false,
                required: ["answer"],
                properties: { answer: { type: "string" } },
            },
            fieldConfigs: [
                {
                    field: "answer",
                    kind: "factual",
                    spec: { matcher: "exact" },
                },
            ],
            schemaHash: "hash-1",
            openaiCompatible: true,
            compatibilityErrors: [],
            createdBy: "user-1",
            createdAt: new Date(),
        });
        vi.mocked(promptsService.listPromptVersionFitTags).mockResolvedValue([
            "structured-output",
        ]);
    });

    function pipeline(fieldConfigs: unknown) {
        return {
            id: "pipe-1",
            teamId: "team-1",
            projectId: "project-1",
            name: "Bundle",
            outputSchema: pipelineOutputSchema,
            fieldConfigs,
            createdAt: new Date(),
        } as unknown as Awaited<
            ReturnType<typeof pipelinesService.getPipeline>
        >;
    }

    it("returns a form error when no runnable prompt is chosen", async () => {
        mockApiClient.createRunFromSelection.mockRejectedValue(
            new MosaicApiError("Choose a runnable prompt version first.", 400),
        );

        await expect(
            createRunAction(
                formData({
                    datasetId: "dataset-1",
                    pipelineId: "",
                    models: "gpt-4o",
                }),
            ),
        ).resolves.toMatchObject({
            formError: expect.stringContaining(
                "Choose a runnable prompt version",
            ),
        });
    });

    it("returns a form error when no candidate models are selected", async () => {
        const result = await createRunAction(
            formData({
                datasetId: "dataset-1",
                pipelineId: "",
                promptVersionId: "pv-1",
                models: "",
            }),
        );

        expect(result.formError).toBe(
            "Select at least one model before starting a run.",
        );
        expect(result.fieldErrors?.models?.[0]).toBe(
            "Select at least one model before starting a run.",
        );
        expect(mockApiClient.createRunFromSelection).not.toHaveBeenCalled();
    });

    it("submits STT metrics runs without prompt-only fields", async () => {
        await createRunAction(
            formData({
                datasetId: "dataset-1",
                audioRunMode: "stt_metrics",
                models: "",
                sttConfig: JSON.stringify({
                    modelId: "gpt-4o-transcribe",
                    transcriptVariant: "raw",
                }),
                fieldConfigs: JSON.stringify([
                    { field: "answer", kind: "factual" },
                ]),
                judgeRubric: "Do not send this for STT-only.",
                judgePromptVersionId: "judge-pv-1",
                referenceModel: "gpt-4o",
            }),
        );

        expect(mockApiClient.createRunFromSelection).toHaveBeenCalledTimes(1);
        const payload = mockApiClient.createRunFromSelection.mock.calls[0]?.[0];
        expect(payload).toMatchObject({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            audioRunMode: "stt_metrics",
            modelIds: [],
            promptAssignments: [],
            reasoningConfigs: [],
            fieldConfigs: [],
            sttConfig: {
                modelId: "gpt-4o-transcribe",
                transcriptVariant: "raw",
            },
        });
        expect(payload).not.toHaveProperty("promptVersionId");
        expect(payload).not.toHaveProperty("judgeRubric");
        expect(payload).not.toHaveProperty("judgePromptVersionId");
        expect(payload).not.toHaveProperty("referenceModel");
    });

    it("always prefers the serialized STT variants payload over a scalar config", async () => {
        await createRunAction(
            formData({
                datasetId: "dataset-1",
                audioRunMode: "stt_metrics",
                models: "",
                sttConfig: JSON.stringify({ modelId: "legacy-model" }),
                sttVariants: JSON.stringify([
                    {
                        variantKey: "v1",
                        label: "Hindi hint",
                        config: {
                            modelId: "gpt-4o-transcribe",
                            language: "hi",
                        },
                    },
                ]),
                sttEvaluation: JSON.stringify({ transcriptVariant: "raw" }),
            }),
        );

        const payload = mockApiClient.createRunFromSelection.mock.calls[0]?.[0];
        expect(payload).toMatchObject({
            sttVariants: [
                {
                    variantKey: "v1",
                    label: "Hindi hint",
                    config: {
                        modelId: "gpt-4o-transcribe",
                        language: "hi",
                    },
                },
            ],
            sttEvaluation: { transcriptVariant: "raw" },
        });
        expect(payload).not.toHaveProperty("sttConfig");
    });

    it("does not parse prompt-eval fields for STT metrics runs", async () => {
        await createRunAction(
            formData({
                datasetId: "dataset-1",
                audioRunMode: "stt_metrics",
                promptAssignments: "not-json",
                reasoningConfigs: "not-json",
                fieldConfigs: "not-json",
                sttConfig: JSON.stringify({ modelId: "gpt-4o-transcribe" }),
            }),
        );

        expect(mockApiClient.createRunFromSelection).toHaveBeenCalledWith(
            expect.objectContaining({
                audioRunMode: "stt_metrics",
                modelIds: [],
                promptAssignments: [],
                reasoningConfigs: [],
                fieldConfigs: [],
            }),
        );
    });

    it("returns API validation failures as form errors", async () => {
        mockApiClient.createRunFromSelection.mockRejectedValue(
            new MosaicApiError(
                "Cannot start a run with no candidate models.",
                400,
                "bad_request",
            ),
        );

        const result = await createRunAction(
            formData({
                datasetId: "dataset-1",
                pipelineId: "",
                promptVersionId: "pv-1",
                models: "gpt-4o",
            }),
        );

        expect(result.formError).toBe(
            "Cannot start a run with no candidate models.",
        );
    });

    it("rejects a run against an archived dataset", async () => {
        mockApiClient.createRunFromSelection.mockRejectedValue(
            new MosaicApiError(
                "This dataset is archived. Restore it before running.",
                400,
            ),
        );

        await expect(
            createRunAction(
                formData({
                    datasetId: "dataset-1",
                    pipelineId: "pipe-1",
                    models: "gpt-4o",
                }),
            ),
        ).resolves.toMatchObject({
            formError: expect.stringContaining("archived"),
        });
    });

    it("returns a form error when the chosen prompt bundle does not exist", async () => {
        mockApiClient.createRunFromSelection.mockRejectedValue(
            new MosaicApiError("Prompt bundle not found.", 400),
        );

        await expect(
            createRunAction(
                formData({
                    datasetId: "dataset-1",
                    pipelineId: "pipe-1",
                    models: "gpt-4o",
                }),
            ),
        ).resolves.toMatchObject({
            formError: expect.stringContaining("Prompt bundle not found."),
        });
    });

    it("rejects an oversized fieldConfigs payload", async () => {
        vi.mocked(pipelinesService.getPipeline).mockResolvedValue(
            pipeline([
                {
                    field: "answer",
                    kind: "factual",
                    spec: { matcher: "exact" },
                },
            ]),
        );

        await expect(
            createRunAction(
                formData({
                    datasetId: "dataset-1",
                    pipelineId: "pipe-1",
                    fieldConfigs: "x".repeat(64_001),
                }),
            ),
        ).resolves.toMatchObject({
            formError: expect.stringContaining("too large"),
        });
    });

    it("allows a run with no factual scorer and no judge", async () => {
        vi.mocked(pipelinesService.getPipeline).mockResolvedValue(
            pipeline([{ field: "answer", kind: "factual" }]),
        );

        await createRunAction(
            formData({
                datasetId: "dataset-1",
                pipelineId: "pipe-1",
                promptVersionId: "pv-1",
                models: "gpt-4o",
            }),
        );

        expect(mockApiClient.createRunFromSelection).toHaveBeenCalledTimes(1);
        expect(
            mockApiClient.createRunFromSelection.mock.calls[0]?.[0],
        ).not.toHaveProperty("runJudge");
    });

    it("strips the 'none' judge sentinel and creates the run", async () => {
        vi.mocked(pipelinesService.getPipeline).mockResolvedValue(
            pipeline([
                {
                    field: "answer",
                    kind: "factual",
                    spec: { matcher: "exact" },
                },
            ]),
        );

        await createRunAction(
            formData({
                datasetId: "dataset-1",
                pipelineId: "pipe-1",
                promptVersionId: "pv-1",
                models: "gpt-4o",
                judgeConfigId: "none",
            }),
        );

        expect(mockApiClient.createRunFromSelection).toHaveBeenCalledTimes(1);
        expect(
            mockApiClient.createRunFromSelection.mock.calls[0]?.[0],
        ).not.toHaveProperty("judgeConfigId");
        expect(
            mockApiClient.createRunFromSelection.mock.calls[0]?.[0],
        ).toMatchObject({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            pipelineId: "pipe-1",
            promptVersionId: "pv-1",
            modelIds: ["gpt-4o"],
            promptAssignments: [{ modelId: "gpt-4o", promptVersionId: "pv-1" }],
        });
    });

    it("creates a run-scoped judge config from an edited rubric and passes its id", async () => {
        vi.mocked(pipelinesService.getPipeline).mockResolvedValue(
            pipeline([
                {
                    field: "answer",
                    kind: "factual",
                    spec: { matcher: "exact" },
                },
            ]),
        );

        await createRunAction(
            formData({
                datasetId: "dataset-1",
                pipelineId: "pipe-1",
                promptVersionId: "pv-1",
                models: "gpt-4o",
                judgeRubric: "Score accuracy. Reason first.",
                judgeModelId: "gpt-5.4-mini",
            }),
        );

        expect(mockApiClient.createRunFromSelection).toHaveBeenCalledWith(
            expect.objectContaining({
                judgeModelId: "gpt-5.4-mini",
                judgeRubric: "Score accuracy. Reason first.",
            }),
        );
    });

    it("does not create a judge config when no rubric is provided", async () => {
        vi.mocked(pipelinesService.getPipeline).mockResolvedValue(
            pipeline([
                {
                    field: "answer",
                    kind: "factual",
                    spec: { matcher: "exact" },
                },
            ]),
        );

        await createRunAction(
            formData({
                datasetId: "dataset-1",
                pipelineId: "pipe-1",
                promptVersionId: "pv-1",
                models: "gpt-4o",
            }),
        );

        expect(
            mockApiClient.createRunFromSelection.mock.calls[0]?.[0],
        ).not.toHaveProperty("judgeRubric");
    });

    it("stores submitted field scoring for selected prompt schema runs", async () => {
        vi.mocked(promptsService.getPromptSchemaVersion).mockResolvedValue({
            id: "schema-version-1",
            promptId: "prompt-1",
            version: 2,
            jsonSchema: {
                type: "object",
                additionalProperties: false,
                required: ["answer"],
                properties: { answer: { type: "string" } },
            },
            fieldConfigs: [],
            schemaHash: "hash-1",
            openaiCompatible: true,
            compatibilityErrors: [],
            createdBy: "user-1",
            createdAt: new Date(),
        });
        const submittedFieldConfigs = [
            {
                field: "answer",
                kind: "factual",
                spec: { matcher: "exact" },
            },
        ];

        await createRunAction(
            formData({
                datasetId: "dataset-1",
                pipelineId: "__prompt__",
                promptVersionId: "pv-1",
                models: "gpt-4o",
                fieldConfigs: JSON.stringify(submittedFieldConfigs),
            }),
        );

        expect(mockApiClient.createRunFromSelection).toHaveBeenCalledTimes(1);
        expect(
            mockApiClient.createRunFromSelection.mock.calls[0]?.[0].pipelineId,
        ).toBeUndefined();
        expect(
            mockApiClient.createRunFromSelection.mock.calls[0]?.[0]
                .fieldConfigs,
        ).toEqual(submittedFieldConfigs);
    });

    it("allows evaluation runs to compare prompts with different factual schemas", async () => {
        vi.mocked(datasetService.getDataset).mockResolvedValue({
            ...baseDataset,
            purpose: "evaluation",
        });
        vi.mocked(promptsService.getPromptVersion).mockImplementation(
            async (id: string) => ({
                id,
                promptId: "prompt-1",
                version: id === "meal-pv" ? 1 : 2,
                content: "Return JSON.",
                schemaVersionId:
                    id === "meal-pv" ? "meal-schema" : "macro-schema",
                status: "runnable",
                validationAttemptId: "validation-1",
                optimizerAttemptId: null,
                reasoningConfig: null,
                judgeSpec: null,
                createdBy: "user-1",
                createdAt: new Date(),
            }),
        );
        vi.mocked(promptsService.getPromptSchemaVersion).mockImplementation(
            async (id: string) => ({
                id,
                promptId: "prompt-1",
                version: 1,
                jsonSchema:
                    id === "meal-schema"
                        ? {
                              type: "object",
                              additionalProperties: false,
                              required: ["fatPrimarySource"],
                              properties: {
                                  fatPrimarySource: { type: "string" },
                              },
                          }
                        : {
                              type: "object",
                              additionalProperties: false,
                              required: ["fat"],
                              properties: { fat: { type: "integer" } },
                          },
                fieldConfigs: [],
                schemaHash: id,
                openaiCompatible: true,
                compatibilityErrors: [],
                createdBy: "user-1",
                createdAt: new Date(),
            }),
        );
        await createRunAction(
            formData({
                datasetId: "dataset-1",
                pipelineId: "__prompt__",
                promptVersionId: "meal-pv",
                models: "gpt-4o\ngpt-5.4-mini",
                promptAssignments: JSON.stringify([
                    { modelId: "gpt-4o", promptVersionId: "meal-pv" },
                    { modelId: "gpt-5.4-mini", promptVersionId: "macro-pv" },
                ]),
                fieldConfigs: JSON.stringify([
                    {
                        field: "fatPrimarySource",
                        kind: "factual",
                        spec: { matcher: "exact" },
                    },
                ]),
            }),
        );

        expect(mockApiClient.createRunFromSelection).toHaveBeenCalledTimes(1);
    });

    it("still rejects golden runs when a prompt lacks a scored factual field", async () => {
        mockApiClient.createRunFromSelection.mockRejectedValue(
            new MosaicApiError(
                'Prompt schema does not define the scorable field "fatPrimarySource".',
                400,
            ),
        );

        await expect(
            createRunAction(
                formData({
                    datasetId: "dataset-1",
                    pipelineId: "__prompt__",
                    promptVersionId: "meal-pv",
                    models: "gpt-4o\ngpt-5.4-mini",
                    promptAssignments: JSON.stringify([
                        { modelId: "gpt-4o", promptVersionId: "meal-pv" },
                        {
                            modelId: "gpt-5.4-mini",
                            promptVersionId: "macro-pv",
                        },
                    ]),
                    fieldConfigs: JSON.stringify([
                        {
                            field: "fatPrimarySource",
                            kind: "factual",
                            spec: { matcher: "exact" },
                        },
                    ]),
                }),
            ),
        ).resolves.toMatchObject({
            formError: expect.stringContaining("fatPrimarySource"),
        });
    });

    it("passes a saved judge prompt version id to new runs", async () => {
        vi.mocked(pipelinesService.getPipeline).mockResolvedValue(
            pipeline([
                {
                    field: "answer",
                    kind: "factual",
                    spec: { matcher: "exact" },
                },
            ]),
        );
        vi.mocked(promptsService.getPromptVersion).mockImplementation(
            async (id: string) =>
                id === "judge-pv-1"
                    ? {
                          id: "judge-pv-1",
                          promptId: "judge-prompt-1",
                          version: 1,
                          content: "Score the candidate.",
                          schemaVersionId: null,
                          status: "runnable",
                          validationAttemptId: null,
                          optimizerAttemptId: null,
                          reasoningConfig: { effort: "low" },
                          judgeSpec: {
                              modelId: "gpt-5.4-mini",
                              declaredInputs: ["candidate_output", "reference"],
                          },
                          createdBy: "user-1",
                          createdAt: new Date(),
                      }
                    : {
                          id: "pv-1",
                          promptId: "prompt-1",
                          version: 3,
                          content: "Return JSON.",
                          schemaVersionId: "schema-version-1",
                          status: "runnable",
                          validationAttemptId: "validation-1",
                          optimizerAttemptId: null,
                          reasoningConfig: { effort: "high" },
                          judgeSpec: null,
                          createdBy: "user-1",
                          createdAt: new Date(),
                      },
        );
        vi.mocked(promptsService.getPrompt).mockImplementation(
            async (id: string) =>
                id === "judge-prompt-1"
                    ? {
                          id: "judge-prompt-1",
                          teamId: "team-1",
                          projectId: "project-1",
                          name: "Food quality judge",
                          description: null,
                          kind: "judge",
                          basePromptId: null,
                          targetModelId: "gpt-5.4-mini",
                          createdAt: new Date(),
                      }
                    : {
                          id: "prompt-1",
                          teamId: "team-1",
                          projectId: "project-1",
                          name: "Extract answer",
                          description: null,
                          kind: "eval",
                          basePromptId: null,
                          targetModelId: null,
                          createdAt: new Date(),
                      },
        );
        await createRunAction(
            formData({
                datasetId: "dataset-1",
                pipelineId: "pipe-1",
                promptVersionId: "pv-1",
                models: "gpt-4o",
                judgePromptVersionId: "judge-pv-1",
            }),
        );

        expect(mockApiClient.createRunFromSelection).toHaveBeenCalledTimes(1);
        expect(
            mockApiClient.createRunFromSelection.mock.calls[0]?.[0],
        ).not.toHaveProperty("judgeConfigId");
        expect(
            mockApiClient.createRunFromSelection.mock.calls[0]?.[0]
                .judgePromptVersionId,
        ).toBe("judge-pv-1");
    });

    it("rejects combining a saved judge prompt with generative-field scoring", async () => {
        vi.mocked(pipelinesService.getPipeline).mockResolvedValue(
            pipeline([
                {
                    field: "answer",
                    kind: "generative",
                    rubric: "Score answer quality.",
                    modelId: "gpt-4o-mini",
                },
            ]),
        );

        const result = await createRunAction(
            formData({
                datasetId: "dataset-1",
                pipelineId: "pipe-1",
                promptVersionId: "pv-1",
                models: "gpt-4o",
                judgePromptVersionId: "judge-pv-1",
                fieldConfigs: JSON.stringify([
                    {
                        field: "answer",
                        kind: "generative",
                        rubric: "Score answer quality.",
                        modelId: "gpt-4o-mini",
                    },
                ]),
            }),
        );

        expect(result.fieldErrors?.judgePromptVersionId?.[0]).toContain(
            "generative-field scoring",
        );
        expect(mockApiClient.createRunFromSelection).not.toHaveBeenCalled();
    });

    it("freezes per-model reasoning config from run overrides and omits non-reasoning models", async () => {
        vi.mocked(pipelinesService.getPipeline).mockResolvedValue(
            pipeline([
                {
                    field: "answer",
                    kind: "factual",
                    spec: { matcher: "exact" },
                },
            ]),
        );

        await createRunAction(
            formData({
                datasetId: "dataset-1",
                pipelineId: "pipe-1",
                promptVersionId: "pv-1",
                models: "gpt-5.5\ngpt-4o",
                reasoningConfigs: JSON.stringify([
                    {
                        modelId: "gpt-5.5",
                        reasoningConfig: { effort: "low" },
                    },
                    {
                        modelId: "gpt-4o",
                        reasoningConfig: { effort: "high" },
                    },
                ]),
            }),
        );

        expect(
            mockApiClient.createRunFromSelection.mock.calls[0]?.[0]
                .reasoningConfigs,
        ).toEqual([
            { modelId: "gpt-5.5", reasoningConfig: { effort: "low" } },
            { modelId: "gpt-4o", reasoningConfig: { effort: "high" } },
        ]);
    });

    it("rejects non-runnable prompt versions before creating a run", async () => {
        mockApiClient.createRunFromSelection.mockRejectedValue(
            new MosaicApiError(
                "Choose a runnable prompt version for gpt-4o.",
                400,
            ),
        );

        await expect(
            createRunAction(
                formData({
                    datasetId: "dataset-1",
                    pipelineId: "pipe-1",
                    promptVersionId: "pv-1",
                    models: "gpt-4o",
                }),
            ),
        ).resolves.toMatchObject({
            formError: expect.stringContaining("runnable prompt version"),
        });
    });

    it("rejects prompt schemas incompatible with selected scoring fields", async () => {
        mockApiClient.createRunFromSelection.mockRejectedValue(
            new MosaicApiError(
                'Field config "missing" is not defined in the output structure.',
                400,
            ),
        );

        await expect(
            createRunAction(
                formData({
                    datasetId: "dataset-1",
                    pipelineId: "pipe-1",
                    promptVersionId: "pv-1",
                    models: "gpt-4o",
                }),
            ),
        ).resolves.toMatchObject({
            formError: expect.stringContaining("Field config"),
        });
    });
});

describe("generateJudgeForRunAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockApiClient.generateJudgeForRun.mockResolvedValue({
            rubricPrompt: "RUBRIC TEXT",
        });
    });

    it("returns the generated rubric from the API", async () => {
        const result = await generateJudgeForRunAction("pv-1", "dataset-1");

        expect(result).toEqual({ ok: true, rubricPrompt: "RUBRIC TEXT" });
        expect(mockApiClient.generateJudgeForRun).toHaveBeenCalledWith(
            {
                teamId: "team-1",
                projectId: "project-1",
                promptVersionId: "pv-1",
                datasetId: "dataset-1",
            },
            { teamId: "team-1", actorId: "user-1" },
        );
    });

    it("returns an API error when the prompt version is not runnable yet", async () => {
        mockApiClient.generateJudgeForRun.mockRejectedValue(
            new MosaicApiError("Select a runnable prompt version first.", 400),
        );

        const result = await generateJudgeForRunAction("pv-1", "dataset-1");

        expect(result).toEqual({
            ok: false,
            error: "Select a runnable prompt version first.",
        });
    });
});

describe("prompt management actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(assertSameTeam).mockImplementation(() => undefined);
        vi.mocked(promptsService.createPrompt).mockResolvedValue({
            id: "prompt-1",
            teamId: "team-1",
            projectId: "project-1",
            name: "Extract answer",
            description: null,
            kind: "eval",
            basePromptId: null,
            targetModelId: null,
            createdAt: new Date(),
        });
        vi.mocked(promptsService.createSchemaVersion).mockResolvedValue({
            id: "schema-version-1",
            promptId: "prompt-1",
            version: 1,
            jsonSchema,
            fieldConfigs: [],
            schemaHash: "hash-1",
            openaiCompatible: true,
            compatibilityErrors: [],
            createdBy: "user-1",
            createdAt: new Date(),
        });
        vi.mocked(
            promptsService.recordPromptValidationAttempt,
        ).mockResolvedValue({
            id: "validation-1",
            teamId: "team-1",
            projectId: "project-1",
            promptId: "prompt-1",
            draftId: null,
            promptVersionId: null,
            schemaVersionId: "schema-version-1",
            targetModelId: "gpt-4o",
            status: "passed",
            schemaHash: "hash-1",
            evidence: null,
            rawOutput: null,
            parsedOutput: null,
            error: null,
            latencyMs: null,
            createdBy: "user-1",
            createdAt: new Date(),
        });
        vi.mocked(promptsService.addRunnablePromptVersion).mockResolvedValue({
            id: "pv-1",
            promptId: "prompt-1",
            version: 1,
            content: "Return JSON.",
            schemaVersionId: "schema-version-1",
            status: "runnable",
            validationAttemptId: "validation-1",
            optimizerAttemptId: null,
            reasoningConfig: null,
            judgeSpec: null,
            createdBy: "user-1",
            createdAt: new Date(),
        });
        vi.mocked(promptsService.createJudgePrompt).mockResolvedValue({
            prompt: {
                id: "judge-prompt-1",
                teamId: "team-1",
                projectId: "project-1",
                name: "Judge answer",
                description: null,
                kind: "judge",
                basePromptId: null,
                targetModelId: "gpt-4o-mini",
                createdAt: new Date(),
            },
            version: {
                id: "judge-pv-1",
                promptId: "judge-prompt-1",
                version: 1,
                content: "Score the candidate.",
                schemaVersionId: null,
                status: "runnable",
                validationAttemptId: null,
                optimizerAttemptId: null,
                reasoningConfig: null,
                judgeSpec: {
                    modelId: "gpt-4o-mini",
                    declaredInputs: ["candidate_output", "reference"],
                },
                createdBy: "user-1",
                createdAt: new Date(),
            },
        });
        mockApiClient.saveRunnablePrompt.mockResolvedValue({
            promptId: "prompt-1",
            promptVersionId: "pv-1",
            promptVersion: 1,
            schemaVersionId: "schema-version-1",
        });
        mockApiClient.validateRunnablePrompt.mockResolvedValue(
            passedPromptValidation(),
        );
        mockApiClient.createJudgePrompt.mockResolvedValue({
            promptId: "judge-prompt-1",
            promptVersionId: "judge-pv-1",
        });
    });

    it("creates a legacy judge prompt through the API", async () => {
        await createJudgeAction(
            formData({
                name: "Judge answer",
                modelId: "gpt-5.4-mini",
                rubricPrompt: "Score the candidate.",
                reasoningEffort: "low",
            }),
        );

        expect(mockApiClient.createJudgePrompt).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            name: "Judge answer",
            modelId: "gpt-5.4-mini",
            rubricPrompt: "Score the candidate.",
            reasoningConfig: { effort: "low" },
            createdBy: "user-1",
        });
    });

    it("does not save a prompt when sample validation fails", async () => {
        mockApiClient.validateRunnablePrompt.mockResolvedValue({
            passed: false,
            evidence: {
                staticChecks: [],
                schemaValidation: {
                    localValid: true,
                    openaiCompatible: true,
                    errors: [],
                },
                sampleResults: [
                    {
                        sampleName: "Sample",
                        status: "failed",
                        errors: [
                            {
                                path: "$",
                                code: "invalid_json",
                                message: "Model output was not valid JSON.",
                            },
                        ],
                    },
                ],
            },
            failureMessage: "Model output was not valid JSON.",
        });

        const result = await saveRunnablePromptAction(
            {},
            formData({
                name: "Extract answer",
                content: "Return JSON.",
                targetModelId: "gpt-4o",
                jsonSchema: JSON.stringify(jsonSchema),
                sampleInput: "Question",
            }),
        );

        expect(result.formError).toContain("valid JSON");
        expect(mockApiClient.validateRunnablePrompt).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId: "team-1",
                targetModelId: "gpt-4o",
            }),
        );
        expect(
            mockApiClient.recordPromptValidationAttempt,
        ).not.toHaveBeenCalled();
        expect(mockApiClient.saveRunnablePrompt).not.toHaveBeenCalled();
    });

    it("saves a runnable prompt only after passing validation", async () => {
        mockApiClient.validateRunnablePrompt.mockResolvedValue(
            passedPromptValidation(),
        );

        const result = await saveRunnablePromptAction(
            {},
            formData({
                name: "Extract answer",
                content: "Return JSON.",
                targetModelId: "gpt-4o",
                jsonSchema: JSON.stringify(jsonSchema),
                sampleInput: "Question",
                optimizerAttemptId: "opt-1",
            }),
        );

        expect(result.ok).toBe(true);
        expect(result.promptId).toBe("prompt-1");
        expect(result.promptKind).toBe("eval");
        expect(mockApiClient.saveRunnablePrompt).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId: "team-1",
                projectId: "project-1",
                name: "Extract answer",
                content: "Return JSON.",
                targetModelId: "gpt-4o",
                jsonSchema,
                optimizerAttemptId: "opt-1",
                createdBy: "user-1",
            }),
        );
    });

    it("persists the prompt description on a newly created prompt", async () => {
        mockApiClient.validateRunnablePrompt.mockResolvedValue(
            passedPromptValidation(),
        );

        const result = await saveRunnablePromptAction(
            {},
            formData({
                name: "Extract answer",
                content: "Return JSON.",
                description: "Extracts the answer field from text.",
                targetModelId: "gpt-4o",
                jsonSchema: JSON.stringify(jsonSchema),
                sampleInput: "Question",
            }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.saveRunnablePrompt).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "Extract answer",
                description: "Extracts the answer field from text.",
                targetModelId: "gpt-4o",
            }),
        );
    });

    it("saves a judge prompt version with declared inputs and skips eval validation", async () => {
        const result = await saveRunnablePromptAction(
            {},
            formData({
                kind: "judge",
                name: "Judge answer",
                content: "Score the candidate against the reference.",
                targetModelId: "gpt-5.4-mini",
                reasoningEffort: "low",
                judgeDeclaredInputs: "candidate_output,reference",
            }),
        );

        expect(result.ok).toBe(true);
        expect(result.promptId).toBe("judge-prompt-1");
        expect(result.promptKind).toBe("judge");
        expect(mockApiClient.validateRunnablePrompt).not.toHaveBeenCalled();
        expect(mockApiClient.createJudgePrompt).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId: "team-1",
                projectId: "project-1",
                name: "Judge answer",
                modelId: "gpt-5.4-mini",
                rubricPrompt: "Score the candidate against the reference.",
                judgeSpec: {
                    modelId: "gpt-5.4-mini",
                    declaredInputs: ["candidate_output", "reference"],
                },
                reasoningConfig: { effort: "low" },
            }),
        );
    });

    it("adds a version to the judge prompt it already saved instead of a second prompt", async () => {
        await saveRunnablePromptAction(
            {},
            formData({
                kind: "judge",
                promptId: "judge-prompt-1",
                name: "Judge answer",
                content: "Score it again.",
                targetModelId: "gpt-5.4-mini",
                judgeDeclaredInputs: "candidate_output,reference",
            }),
        );
        expect(mockApiClient.createJudgePrompt).toHaveBeenCalledWith(
            expect.objectContaining({ promptId: "judge-prompt-1" }),
        );
    });

    it("creates a new judge prompt when there is no promptId yet", async () => {
        await saveRunnablePromptAction(
            {},
            formData({
                kind: "judge",
                name: "Judge answer",
                content: "Score it.",
                targetModelId: "gpt-5.4-mini",
                judgeDeclaredInputs: "candidate_output,reference",
            }),
        );
        expect(
            mockApiClient.createJudgePrompt.mock.calls[0]?.[0],
        ).not.toHaveProperty("promptId");
    });

    it("returns a rejected judge save as a form error instead of throwing", async () => {
        mockApiClient.createJudgePrompt.mockRejectedValueOnce(
            new Error("Prompt not found."),
        );
        const result = await saveRunnablePromptAction(
            {},
            formData({
                kind: "judge",
                promptId: "missing-prompt",
                name: "Judge answer",
                content: "Score it.",
                targetModelId: "gpt-5.4-mini",
                judgeDeclaredInputs: "candidate_output,reference",
            }),
        );
        expect(result.ok).toBeUndefined();
        expect(result.formError).toBeTruthy();
    });

    it("snapshots reasoning effort high onto a newly saved reasoning prompt version", async () => {
        mockApiClient.validateRunnablePrompt.mockResolvedValue(
            passedPromptValidation(),
        );

        const result = await saveRunnablePromptAction(
            {},
            formData({
                name: "Extract answer",
                content: "Return JSON.",
                targetModelId: "gpt-5.5",
                reasoningEffort: "high",
                jsonSchema: JSON.stringify(jsonSchema),
                sampleInput: "Question",
            }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.validateRunnablePrompt).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId: "team-1",
                projectId: "project-1",
                targetModelId: "gpt-5.5",
                reasoningEffort: "high",
            }),
        );
        expect(mockApiClient.saveRunnablePrompt).toHaveBeenCalledWith(
            expect.objectContaining({
                reasoningConfig: { effort: "high" },
            }),
        );
    });

    it("does not snapshot reasoning effort for a non-reasoning prompt model", async () => {
        mockApiClient.validateRunnablePrompt.mockResolvedValue(
            passedPromptValidation(),
        );

        await saveRunnablePromptAction(
            {},
            formData({
                name: "Extract answer",
                content: "Return JSON.",
                targetModelId: "gpt-4o",
                reasoningEffort: "high",
                jsonSchema: JSON.stringify(jsonSchema),
                sampleInput: "Question",
            }),
        );

        expect(
            mockApiClient.saveRunnablePrompt.mock.calls[0][0].reasoningConfig,
        ).toBeUndefined();
    });

    it("saves later reasoning edits as new version snapshots without rewriting earlier calls", async () => {
        mockApiClient.validateRunnablePrompt.mockResolvedValue(
            passedPromptValidation(),
        );

        await saveRunnablePromptAction(
            {},
            formData({
                name: "Extract answer",
                content: "Return JSON.",
                targetModelId: "gpt-5.5",
                reasoningEffort: "high",
                jsonSchema: JSON.stringify(jsonSchema),
                sampleInput: "Question",
            }),
        );
        await saveRunnablePromptAction(
            {},
            formData({
                name: "Extract answer",
                content: "Return JSON v2.",
                targetModelId: "gpt-5.5",
                reasoningEffort: "low",
                jsonSchema: JSON.stringify(jsonSchema),
                sampleInput: "Question",
            }),
        );

        expect(
            mockApiClient.saveRunnablePrompt.mock.calls[0][0].reasoningConfig,
        ).toEqual({ effort: "high" });
        expect(
            mockApiClient.saveRunnablePrompt.mock.calls[1][0].reasoningConfig,
        ).toEqual({ effort: "low" });
    });

    it("records optimizer proposals and returns the attempt id", async () => {
        mockApiClient.optimizePrompt.mockResolvedValue({
            originalPrompt: "extract",
            optimizedPrompt: "Return JSON only.",
            optimizationRationale: "Tighter output contract.",
            fitTags: ["gpt-4o"],
            structuredOutputNotes: ["Returns a bare JSON object."],
            optimizationGuidanceSource: {
                title: "OpenAI prompt guide",
                url: "https://developers.openai.com/api/docs/guides/prompt-engineering",
                retrievedAt: "2026-06-19",
            },
            optimizerModelId: "gpt-5.4-mini",
            optimizationTargetModelId: "gpt-4o",
            validationSummary: "Optimized by gpt-5.4-mini for gpt-4o.",
            optimizerAttemptId: "opt-1",
        });

        const result = await optimizePromptAction(
            {},
            formData({
                content: "extract",
                targetModelId: "gpt-4o",
                jsonSchema: JSON.stringify(jsonSchema),
            }),
        );

        expect(result.optimizedPrompt).toBe("Return JSON only.");
        expect(result.originalPrompt).toBe("extract");
        expect(result.structuredOutputNotes).toEqual([
            "Returns a bare JSON object.",
        ]);
        expect(result.optimizationGuidanceSource?.title).toBe(
            "OpenAI prompt guide",
        );
        expect(result.optimizerModelId).toBe("gpt-5.4-mini");
        expect(result.optimizationTargetModelId).toBe("gpt-4o");
        expect(result.optimizerAttemptId).toBe("opt-1");
        expect(mockApiClient.optimizePrompt).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId: "team-1",
                projectId: "project-1",
                content: "extract",
                targetModelId: "gpt-4o",
                optimizerModelId: "gpt-5.4-mini",
                jsonSchema,
                createdBy: "user-1",
            }),
        );
    });

    it("validates saved sample inputs before saving a prompt version", async () => {
        mockApiClient.validateRunnablePrompt.mockResolvedValue({
            passed: true,
            evidence: {
                staticChecks: [],
                schemaValidation: {
                    localValid: true,
                    openaiCompatible: true,
                    errors: [],
                },
                sampleResults: [
                    {
                        sampleName: "Sample 1",
                        status: "passed",
                        rawOutput: '{"answer":"yes"}',
                        parsedOutput: { answer: "yes" },
                        errors: [],
                    },
                    {
                        sampleName: "Sample 2",
                        status: "passed",
                        rawOutput: '{"answer":"no"}',
                        parsedOutput: { answer: "no" },
                        errors: [],
                    },
                ],
            },
        });

        await saveRunnablePromptAction(
            {},
            formData({
                name: "Extract answer",
                content: "Return JSON.",
                targetModelId: "gpt-4o",
                jsonSchema: JSON.stringify(jsonSchema),
                sampleInput: "Ignored fallback",
                sampleInputs: JSON.stringify([
                    { name: "Sample 1", inputText: "Question 1" },
                    { name: "Sample 2", inputText: "Question 2" },
                ]),
            }),
        );

        expect(mockApiClient.validateRunnablePrompt).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId: "team-1",
                projectId: "project-1",
                samples: [
                    { name: "Sample 1", inputText: "Question 1" },
                    { name: "Sample 2", inputText: "Question 2" },
                ],
            }),
        );
    });

    it("duplicates a prompt with copied validation evidence", async () => {
        await duplicatePromptVersionAction(
            formData({ sourcePromptVersionId: "source-pv" }),
        );

        expect(mockApiClient.duplicatePromptVersion).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            sourcePromptVersionId: "source-pv",
            createdBy: "user-1",
        });
    });
});

describe("importGoldenAnswersAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        for (const mock of Object.values(mockApiClient)) {
            mock.mockReset();
            mock.mockResolvedValue(undefined);
        }
    });

    it("authenticates before rejecting a missing file", async () => {
        const result = await importGoldenAnswersAction(
            {},
            formData({ datasetId: "dataset-1" }),
        );

        expect(requireActiveProject).toHaveBeenCalled();
        expect(result.rejected).toBe(true);
        expect(result.formError).toContain("golden-answers file");
    });

    it("returns API validation when golden answers are rejected", async () => {
        mockApiClient.importGoldenAnswers.mockResolvedValue({
            importedCount: 0,
            failures: [
                { reason: "Evaluation datasets do not carry golden answers." },
            ],
            rejected: true,
        });

        const fd = formData({ datasetId: "dataset-1" });
        const answers = new File(['{"key":"x"}'], "a.jsonl");
        Object.defineProperty(answers, "text", {
            value: async () => '{"key":"x"}',
        });
        fd.set("answers", answers);
        const result = await importGoldenAnswersAction({}, fd);

        expect(result.rejected).toBe(true);
        expect(result.formError).toContain("do not carry golden answers");
        expect(mockApiClient.importGoldenAnswers).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            answersContent: '{"key":"x"}',
        });
    });

    it("imports golden answers through the API", async () => {
        mockApiClient.importGoldenAnswers.mockResolvedValue({
            importedCount: 1,
            failures: [],
        });

        const fd = formData({ datasetId: "dataset-1" });
        const answers = new File(['{"key":"x"}'], "a.jsonl");
        Object.defineProperty(answers, "text", {
            value: async () => '{"key":"x"}',
        });
        fd.set("answers", answers);
        const result = await importGoldenAnswersAction({}, fd);

        expect(result.ok).toBe(true);
        expect(result.importedCount).toBe(1);
        expect(mockApiClient.importGoldenAnswers).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            answersContent: '{"key":"x"}',
        });
    });
});

describe("importImageAnswersAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function withImage(fd: FormData, name = "a.png"): FormData {
        fd.set(
            "imageUploads",
            JSON.stringify([
                {
                    storageKey: `datasets/dataset-1/${name}`,
                    name,
                    mimeType: "image/png",
                    size: 3,
                },
            ]),
        );
        return fd;
    }

    function answersFile(content: string, name = "answers.jsonl"): File {
        const file = new File([content], name, { type: "application/json" });
        Object.defineProperty(file, "text", { value: async () => content });
        return file;
    }

    it("returns API validation for datasets that are not golden image datasets", async () => {
        mockApiClient.importImageAnswers.mockResolvedValue({
            importedCount: 0,
            failures: [
                {
                    reason: "Only golden image datasets can import images with answers.",
                },
            ],
            rejected: true,
        });

        const fd = withImage(formData({ datasetId: "dataset-1" }));
        fd.set("answers", answersFile('{"filename":"a.png","label":"x"}'));
        const result = await importImageAnswersAction({}, fd);

        expect(result.rejected).toBe(true);
        expect(result.formError).toContain("golden image datasets");
        expect(mockApiClient.importImageAnswers).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
            }),
        );
    });

    it("returns API validation for structured answers", async () => {
        mockApiClient.importImageAnswers.mockResolvedValue({
            importedCount: 0,
            failures: [
                {
                    reason: "Use the structured paired import for this dataset.",
                },
            ],
            rejected: true,
        });

        const fd = withImage(formData({ datasetId: "dataset-1" }));
        fd.set("answers", answersFile('{"filename":"a.png","label":"x"}'));
        const result = await importImageAnswersAction({}, fd);

        expect(result.rejected).toBe(true);
        expect(result.formError).toContain("structured paired import");
        expect(mockApiClient.importImageAnswers).toHaveBeenCalled();
    });

    it("rejects when no images are selected", async () => {
        const result = await importImageAnswersAction(
            {},
            formData({ datasetId: "dataset-1" }),
        );

        expect(result.rejected).toBe(true);
        expect(result.formError).toContain("one or more images");
        expect(mockApiClient.importImageAnswers).not.toHaveBeenCalled();
    });

    it("rejects when the answers file is missing", async () => {
        const result = await importImageAnswersAction(
            {},
            withImage(formData({ datasetId: "dataset-1" })),
        );

        expect(result.rejected).toBe(true);
        expect(result.formError).toContain("answer file");
        expect(mockApiClient.importImageAnswers).not.toHaveBeenCalled();
    });

    it("rejects an answers file over the text import limit", async () => {
        const fd = withImage(formData({ datasetId: "dataset-1" }));
        fd.set("answers", answersFile("x".repeat(MAX_TEXT_IMPORT_BYTES + 1)));

        const result = await importImageAnswersAction({}, fd);

        expect(result.rejected).toBe(true);
        expect(result.formError).toContain("exceeds");
        expect(mockApiClient.importImageAnswers).not.toHaveBeenCalled();
    });

    it("imports freeform image answers on the happy path", async () => {
        mockApiClient.importImageAnswers.mockResolvedValue({
            importedCount: 1,
            failures: [],
        });
        const fd = withImage(formData({ datasetId: "dataset-1" }));
        fd.set(
            "answers",
            answersFile('{"filename":"a.png","label":{"answer":"x"}}'),
        );

        const result = await importImageAnswersAction({}, fd);

        expect(result.ok).toBe(true);
        expect(result.importedCount).toBe(1);
        expect(mockApiClient.importImageAnswers).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            images: [
                expect.objectContaining({
                    name: "a.png",
                    mimeType: "image/png",
                    size: 3,
                    storageKey: "datasets/dataset-1/a.png",
                }),
            ],
            answersContent: expect.stringContaining("a.png"),
        });
    });
});

describe("importAudioAnswersAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function withAudio(fd: FormData, name = "call.webm"): FormData {
        fd.set(
            "audioUploads",
            JSON.stringify([
                {
                    storageKey: `datasets/dataset-1/${name}`,
                    name,
                    mimeType: "audio/webm",
                    size: 3,
                },
            ]),
        );
        return fd;
    }

    function answersFile(content: string, name = "answers.jsonl"): File {
        const file = new File([content], name, { type: "application/json" });
        Object.defineProperty(file, "text", { value: async () => content });
        return file;
    }

    it("rejects when no audio files are selected", async () => {
        const result = await importAudioAnswersAction(
            {},
            formData({ datasetId: "dataset-1" }),
        );

        expect(result.rejected).toBe(true);
        expect(result.formError).toContain("one or more audio");
        expect(mockApiClient.importAudioAnswers).not.toHaveBeenCalled();
    });

    it("rejects when the answers file is missing", async () => {
        const result = await importAudioAnswersAction(
            {},
            withAudio(formData({ datasetId: "dataset-1" })),
        );

        expect(result.rejected).toBe(true);
        expect(result.formError).toContain("answer file");
        expect(mockApiClient.importAudioAnswers).not.toHaveBeenCalled();
    });

    it("imports freeform audio STT answers on the happy path", async () => {
        mockApiClient.importAudioAnswers.mockResolvedValue({
            importedCount: 1,
            failures: [],
        });
        const fd = withAudio(formData({ datasetId: "dataset-1" }));
        fd.set(
            "answers",
            answersFile(
                '{"filename":"call.webm","label":{"referenceKind":"human_gold","expectedTranscript":"नमस्ते","expectedTranscriptLatin":"namaste"}}',
            ),
        );

        const result = await importAudioAnswersAction({}, fd);

        expect(result.ok).toBe(true);
        expect(result.importedCount).toBe(1);
        expect(mockApiClient.importAudioAnswers).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            audio: [
                expect.objectContaining({
                    name: "call.webm",
                    mimeType: "audio/webm",
                    size: 3,
                    storageKey: "datasets/dataset-1/call.webm",
                }),
            ],
            answersContent: expect.stringContaining("expectedTranscriptLatin"),
        });
    });
});

describe("dataset lifecycle actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(assertSameTeam).mockImplementation(() => undefined);
        vi.mocked(datasetService.getDataset).mockResolvedValue(baseDataset);
    });

    it("archives an owned dataset", async () => {
        const result = await archiveDatasetAction(
            {},
            formData({ datasetId: "dataset-1" }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.setDatasetArchived).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            archived: true,
        });
    });

    it("restores an owned dataset", async () => {
        const result = await restoreDatasetAction(
            {},
            formData({ datasetId: "dataset-1" }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.setDatasetArchived).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            archived: false,
        });
    });

    it("duplicates an owned dataset", async () => {
        const result = await duplicateDatasetAction(
            {},
            formData({ datasetId: "dataset-1" }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.duplicateDataset).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            createdBy: "user-1",
        });
    });

    it("deletes an owned dataset", async () => {
        const result = await deleteDatasetAction(
            {},
            formData({ datasetId: "dataset-1" }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.deleteDataset).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
        });
    });

    it("returns dataset delete blockers as form errors", async () => {
        mockApiClient.deleteDataset.mockRejectedValue(
            new MosaicApiError(
                "Delete the runs that use this dataset first.",
                400,
            ),
        );

        const result = await deleteDatasetAction(
            {},
            formData({ datasetId: "dataset-1" }),
        );

        expect(result.formError).toContain("Delete the runs");
    });

    it("returns a form error when duplicating a dataset that does not exist", async () => {
        mockApiClient.duplicateDataset.mockRejectedValue(
            new MosaicApiError("Dataset not found", 400),
        );

        await expect(
            duplicateDatasetAction({}, formData({ datasetId: "missing" })),
        ).resolves.toEqual({ formError: "Dataset not found" });
    });

    it("refuses to duplicate an archived dataset", async () => {
        mockApiClient.duplicateDataset.mockRejectedValue(
            new MosaicApiError("archived", 400),
        );

        await expect(
            duplicateDatasetAction({}, formData({ datasetId: "dataset-1" })),
        ).resolves.toEqual({ formError: "archived" });
    });

    it("persists a trimmed dataset name", async () => {
        const result = await updateDatasetNameAction(
            {},
            formData({ datasetId: "dataset-1", name: "  Food plates v2  " }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.updateDatasetName).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            name: "Food plates v2",
        });
    });

    it("rejects a blank dataset name", async () => {
        const result = await updateDatasetNameAction(
            {},
            formData({ datasetId: "dataset-1", name: "   " }),
        );

        expect(result.fieldErrors?.name?.[0]).toContain("required");
        expect(mockApiClient.updateDatasetName).not.toHaveBeenCalled();
    });

    it("rejects an over-cap dataset name", async () => {
        const result = await updateDatasetNameAction(
            {},
            formData({ datasetId: "dataset-1", name: "x".repeat(121) }),
        );

        expect(result.fieldErrors?.name?.[0]).toContain("120");
        expect(mockApiClient.updateDatasetName).not.toHaveBeenCalled();
    });

    it("persists a valid description", async () => {
        const result = await updateDatasetDescriptionAction(
            {},
            formData({ datasetId: "dataset-1", description: "Food eval set" }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.updateDatasetDescription).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            description: "Food eval set",
        });
    });

    it("clears the description when only whitespace is submitted", async () => {
        const result = await updateDatasetDescriptionAction(
            {},
            formData({ datasetId: "dataset-1", description: "   " }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.updateDatasetDescription).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            description: null,
        });
    });

    it("rejects an over-cap description", async () => {
        const result = await updateDatasetDescriptionAction(
            {},
            formData({
                datasetId: "dataset-1",
                description: "x".repeat(2001),
            }),
        );

        expect(result.formError).toContain("2000");
        expect(mockApiClient.updateDatasetDescription).not.toHaveBeenCalled();
    });

    it("refuses to edit the description of an archived dataset", async () => {
        mockApiClient.updateDatasetDescription.mockRejectedValue(
            new MosaicApiError("archived", 400),
        );

        await expect(
            updateDatasetDescriptionAction(
                {},
                formData({ datasetId: "dataset-1", description: "Note" }),
            ),
        ).rejects.toThrow("archived");
    });

    it("refuses to edit the name of an archived dataset", async () => {
        mockApiClient.updateDatasetName.mockRejectedValue(
            new MosaicApiError("archived", 400),
        );

        await expect(
            updateDatasetNameAction(
                {},
                formData({ datasetId: "dataset-1", name: "New name" }),
            ),
        ).rejects.toThrow("archived");
    });

    it("hides an unexpected failure behind a generic message instead of throwing", async () => {
        mockApiClient.setDatasetArchived.mockRejectedValue(
            new TypeError("fetch failed"),
        );
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        await expect(
            archiveDatasetAction({}, formData({ datasetId: "dataset-1" })),
        ).resolves.toEqual({
            formError: "Something went wrong. Please try again.",
        });
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it("rejects archive for another team's dataset", async () => {
        mockApiClient.setDatasetArchived.mockRejectedValue(
            new MosaicApiError("Forbidden", 400),
        );

        await expect(
            archiveDatasetAction({}, formData({ datasetId: "dataset-1" })),
        ).resolves.toEqual({ formError: "Forbidden" });
    });

    it("rejects restore for another team's dataset", async () => {
        mockApiClient.setDatasetArchived.mockRejectedValue(
            new MosaicApiError("Forbidden", 400),
        );

        await expect(
            restoreDatasetAction({}, formData({ datasetId: "dataset-1" })),
        ).resolves.toEqual({ formError: "Forbidden" });
    });

    it("rejects duplicate for another team's dataset", async () => {
        mockApiClient.duplicateDataset.mockRejectedValue(
            new MosaicApiError("Forbidden", 400),
        );

        await expect(
            duplicateDatasetAction({}, formData({ datasetId: "dataset-1" })),
        ).resolves.toEqual({ formError: "Forbidden" });
    });

    it("rejects description update for another team's dataset", async () => {
        mockApiClient.updateDatasetDescription.mockRejectedValue(
            new MosaicApiError("Forbidden", 400),
        );

        await expect(
            updateDatasetDescriptionAction(
                {},
                formData({ datasetId: "dataset-1", description: "Nope" }),
            ),
        ).rejects.toThrow("Forbidden");
    });

    it("rejects name update for another team's dataset", async () => {
        mockApiClient.updateDatasetName.mockRejectedValue(
            new MosaicApiError("Forbidden", 400),
        );

        await expect(
            updateDatasetNameAction(
                {},
                formData({ datasetId: "dataset-1", name: "Nope" }),
            ),
        ).rejects.toThrow("Forbidden");
    });
});

describe("delete actions report failures instead of throwing", () => {
    it("returns a run delete failure as a form error", async () => {
        mockApiClient.deleteRun.mockRejectedValueOnce(
            new MosaicApiError("Run is still running", 409),
        );
        await expect(
            deleteRunAction({}, formData({ runId: "run-1" })),
        ).resolves.toEqual({ formError: "Run is still running" });
    });

    it("returns a label delete failure as a form error", async () => {
        mockApiClient.deleteLabel.mockRejectedValueOnce(
            new MosaicApiError("Label is locked", 409),
        );
        await expect(
            deleteLabelAction({}, formData({ itemId: "item-1" })),
        ).resolves.toEqual({ formError: "Label is locked" });
    });

    it("keeps a 5xx on a dataset name save in the form", async () => {
        mockApiClient.updateDatasetName.mockRejectedValueOnce(
            new MosaicApiError("Flash Evals API request failed (500)", 500),
        );
        await expect(
            updateDatasetNameAction(
                {},
                formData({ datasetId: "dataset-1", name: "New name" }),
            ),
        ).resolves.toEqual({ formError: "Flash Evals API request failed (500)" });
    });
});

describe("run review actions report failures instead of throwing", () => {
    it("saves a run note and returns ok", async () => {
        mockApiClient.saveRunNote.mockResolvedValue(undefined);
        await expect(
            saveRunNoteAction({}, formData({ runId: "run-1", body: " Note " })),
        ).resolves.toEqual({ ok: true });
        expect(mockApiClient.saveRunNote).toHaveBeenCalledWith(
            expect.objectContaining({ runId: "run-1", body: "Note" }),
        );
    });

    it("returns a run note API failure as a form error", async () => {
        mockApiClient.saveRunNote.mockRejectedValueOnce(
            new MosaicApiError("Run not found", 404),
        );
        await expect(
            saveRunNoteAction({}, formData({ runId: "run-1", body: "x" })),
        ).resolves.toEqual({ formError: "Run not found" });
    });

    it("returns cell feedback failures and invalid verdicts as form errors", async () => {
        mockApiClient.saveCellAnnotation.mockRejectedValueOnce(
            new MosaicApiError("Cell not found", 404),
        );
        await expect(
            saveCellAnnotationAction(
                formData({ runCellId: "cell-1", verdict: "approved" }),
            ),
        ).resolves.toEqual({ formError: "Cell not found" });
        await expect(
            saveCellAnnotationAction(
                formData({ runCellId: "cell-1", verdict: "bogus" }),
            ),
        ).resolves.toEqual({ formError: "Choose a valid review status." });
    });

    it("saves cell feedback and returns ok", async () => {
        mockApiClient.saveCellAnnotation.mockResolvedValue({ runId: "run-1" });
        await expect(
            saveCellAnnotationAction(
                formData({ runCellId: "cell-1", verdict: "issue" }),
            ),
        ).resolves.toEqual({ ok: true });
    });
});

describe("delete actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(assertSameTeam).mockImplementation(() => undefined);
    });

    it("deletes an owned run", async () => {
        const result = await deleteRunAction({}, formData({ runId: "run-1" }));

        expect(result.ok).toBe(true);
        expect(mockApiClient.deleteRun).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            runId: "run-1",
        });
    });

    it("retries an owned run through the API", async () => {
        const result = await retryRunAction({}, formData({ runId: "run-1" }));

        expect(result.ok).toBe(true);
        expect(mockApiClient.retryRun).toHaveBeenCalledWith(
            {
                teamId: "team-1",
                projectId: "project-1",
                runId: "run-1",
            },
            { teamId: "team-1", actorId: "user-1" },
        );
    });

    it("returns rate-limited retries as a form error", async () => {
        mockApiClient.retryRun.mockRejectedValueOnce(
            new MosaicApiError(
                "Too many run requests: the limit is 10 per minute. Try again in 30 seconds.",
                429,
                "rate_limited",
                undefined,
                undefined,
                30,
            ),
        );

        await expect(
            retryRunAction({}, formData({ runId: "run-1" })),
        ).resolves.toEqual({
            formError:
                "Too many run requests: the limit is 10 per minute. Try again in 30 seconds.",
        });
    });

    it("deletes an owned prompt", async () => {
        const result = await deletePromptAction(
            {},
            formData({ promptId: "prompt-1" }),
        );

        expect(result.ok).toBe(true);
        expect(mockApiClient.deletePrompt).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            promptId: "prompt-1",
        });
    });

    it("returns prompt delete blockers as form errors", async () => {
        mockApiClient.deletePrompt.mockRejectedValue(
            new MosaicApiError(
                "Delete the runs that use this prompt first.",
                400,
            ),
        );

        const result = await deletePromptAction(
            {},
            formData({ promptId: "prompt-1" }),
        );

        expect(result.formError).toContain("Delete the runs");
    });
});

describe("test-draft actions require authentication", () => {
    it("testJudgeDraftAction returns a bounded timeout error", async () => {
        mockApiClient.testJudgeDraft.mockRejectedValue(
            new MosaicApiError("Judge test timed out.", 400),
        );
        const fd = new FormData();
        fd.set("content", "Score the candidate against the rubric.");
        fd.set("targetModelId", "gpt-4o-mini");
        fd.set("judgeCandidateOutput", '{"answer":"yes"}');

        await expect(testJudgeDraftAction(fd)).resolves.toMatchObject({
            formError: "Judge test timed out.",
        });
    });

    it("testPromptDraftAction rejects an unauthenticated caller before any provider call", async () => {
        vi.mocked(requireActiveProject).mockRejectedValueOnce(
            new Error("unauthenticated"),
        );
        const fd = new FormData();
        fd.set("content", "Extract the dish name as JSON.");
        await expect(testPromptDraftAction(fd)).rejects.toThrow(
            "unauthenticated",
        );
    });

    it("testPromptDraftAction calls the API draft test endpoint", async () => {
        mockApiClient.testPromptDraft.mockResolvedValue({
            status: "success",
            targetModelId: "gpt-4o",
            results: [
                {
                    sampleName: "Single input",
                    inputText: "Question",
                    status: "success",
                    rawOutput: '{"answer":"yes"}',
                    parsedOutput: { answer: "yes" },
                    validation: { valid: true, errors: [] },
                    costSource: "unavailable",
                },
            ],
        });
        const fd = new FormData();
        fd.set("content", "Extract the dish name as JSON.");
        fd.set("targetModelId", "gpt-4o");
        fd.set("jsonSchema", JSON.stringify(jsonSchema));
        fd.set("testInput", "Question");

        await expect(testPromptDraftAction(fd)).resolves.toMatchObject({
            ok: true,
            result: { status: "success" },
        });
        expect(mockApiClient.testPromptDraft).toHaveBeenCalledWith(
            {
                teamId: "team-1",
                prompt: "Extract the dish name as JSON.",
                jsonSchema,
                targetModelId: "gpt-4o",
                samples: [{ name: "Single input", inputText: "Question" }],
                timeoutMs: 120_000,
            },
            { teamId: "team-1", actorId: "user-1" },
        );
    });

    it("testPromptDraftAction rejects an unsupported image type", async () => {
        const fd = new FormData();
        fd.set("content", "Describe the image as JSON.");
        fd.set("jsonSchema", "{}");
        fd.set("testInput", "describe this");
        fd.set(
            "imageFile",
            new File([new Uint8Array([1, 2, 3])], "x.svg", {
                type: "image/svg+xml",
            }),
        );
        await expect(testPromptDraftAction(fd)).resolves.toMatchObject({
            fieldErrors: {
                imageFile: [expect.stringContaining("Unsupported image type")],
            },
        });
    });

    it("testPromptDraftAction rejects an image whose bytes do not match its declared type", async () => {
        const fd = new FormData();
        fd.set("content", "Describe the image as JSON.");
        fd.set("jsonSchema", "{}");
        fd.set("testInput", "describe this");
        fd.set(
            "imageFile",
            new File([new TextEncoder().encode("not really a png")], "x.png", {
                type: "image/png",
            }),
        );
        await expect(testPromptDraftAction(fd)).resolves.toMatchObject({
            fieldErrors: {
                imageFile: [expect.stringContaining("do not match")],
            },
        });
    });

    it("generateSchemaFromPromptAction records a proposed attempt on success", async () => {
        mockApiClient.generatePromptSchema.mockResolvedValueOnce({
            schema: { type: "object" },
            openaiCompatible: true,
            compatibilityErrors: [],
        });
        const fd = new FormData();
        fd.set("content", "Return the dish name as JSON.");
        fd.set("targetModelId", "gpt-4o");

        const result = await generateSchemaFromPromptAction(fd);

        expect(result.ok).toBe(true);
        expect(mockApiClient.generatePromptSchema).toHaveBeenCalledWith(
            expect.objectContaining({
                teamId: "team-1",
                projectId: "project-1",
                content: "Return the dish name as JSON.",
                targetModelId: "gpt-4o",
                generatorModelId: "gpt-5.4-mini",
                createdBy: "user-1",
            }),
        );
    });

    it("generateSchemaFromPromptAction records a failed attempt when generation throws", async () => {
        mockApiClient.generatePromptSchema.mockRejectedValueOnce(
            new MosaicApiError("schema boom", 400),
        );
        const fd = new FormData();
        fd.set("content", "Return the dish name as JSON.");

        const result = await generateSchemaFromPromptAction(fd);

        expect(result.formError).toBe("schema boom");
        expect(mockApiClient.generatePromptSchema).toHaveBeenCalled();
    });

    it("generateSchemaFromPromptAction rejects an unauthenticated caller before any provider call", async () => {
        vi.mocked(requireActiveProject).mockRejectedValueOnce(
            new Error("unauthenticated"),
        );
        const fd = new FormData();
        fd.set("content", "Return the dish name as JSON.");
        await expect(generateSchemaFromPromptAction(fd)).rejects.toThrow(
            "unauthenticated",
        );
    });

    it("testJudgeDraftAction rejects an unauthenticated caller before any provider call", async () => {
        vi.mocked(requireActiveProject).mockRejectedValueOnce(
            new Error("unauthenticated"),
        );
        const fd = new FormData();
        fd.set("content", "Score the candidate against the rubric.");
        await expect(testJudgeDraftAction(fd)).rejects.toThrow(
            "unauthenticated",
        );
    });
});
