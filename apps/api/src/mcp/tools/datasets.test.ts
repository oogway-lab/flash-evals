import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createDatasetItemFromFormPayload: vi.fn(),
    createDatasetItemPayload: vi.fn(),
    deleteDatasetItemPayload: vi.fn(),
    deleteDatasetPayload: vi.fn(),
    deleteLabelPayload: vi.fn(),
    duplicateDatasetPayload: vi.fn(),
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
    importGoldenAnswersPayload: vi.fn(),
    importImageAnswersPayload: vi.fn(),
    importImagesPayload: vi.fn(),
    importPairedItemsPayload: vi.fn(),
    importTextItemsPayload: vi.fn(),
    listDatasetsPayload: vi.fn(),
    previewGoldenAnswersPayload: mocks.previewGoldenAnswersPayload,
    commitGoldenAnswersPayload: mocks.commitGoldenAnswersPayload,
}));

import { registerDatasetTools } from "./datasets.js";
import {
    createToolHarness,
    expectConfirmationGate,
    TEST_PROJECT_ID,
} from "./testSupport.js";

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
});

function registerTools() {
    return createToolHarness(registerDatasetTools);
}
