import { beforeEach, describe, expect, it, vi } from "vitest";

type UpdatePayload = {
    providerMetadata?: Record<string, unknown>;
    status?: string;
    [key: string]: unknown;
};

const mocks = vi.hoisted(() => ({
    updatePayloads: [] as UpdatePayload[],
    getRunCells: vi.fn(),
    findCachedCell: vi.fn(),
    executeCell: vi.fn(),
    transport: undefined as "openai" | "gateway" | "openrouter" | undefined,
}));

vi.mock("../db/client", () => {
    const update = vi.fn(() => ({
        set: vi.fn((payload: UpdatePayload) => {
            mocks.updatePayloads.push(payload);
            return { where: vi.fn(async () => undefined) };
        }),
    }));
    const select = vi.fn(() => ({
        from: vi.fn(() => ({
            where: vi.fn(async () => [
                {
                    id: "item-1",
                    datasetId: "dataset-1",
                    inputText: "hello",
                    storageKey: null,
                    mimeType: null,
                },
            ]),
            limit: vi.fn(async () => []),
        })),
    }));

    return {
        db: {
            update,
            select,
            transaction: vi.fn(
                async (fn: (tx: TransactionMock) => Promise<unknown>) =>
                    fn({
                        delete: vi.fn(() => ({
                            where: vi.fn(async () => undefined),
                        })),
                        insert: vi.fn(() => ({
                            values: vi.fn(async () => undefined),
                        })),
                    }),
            ),
        },
    };
});

vi.mock("./service", () => ({
    getRun: vi.fn(async () => ({
        id: "run-1",
        datasetId: "dataset-1",
        pipelineId: "pipeline-1",
        judgeConfigId: null,
        judgePromptVersionId: null,
        configSnapshot: {
            maxTokens: 100,
            fieldConfigs: [],
            models: [
                {
                    modelId: "gpt-4o",
                    promptVersionId: "prompt-version-1",
                    isReference: true,
                    transport: mocks.transport,
                },
            ],
        },
    })),
    getRunModels: vi.fn(async () => [
        {
            id: "run-model-1",
            modelId: "gpt-4o",
            promptVersionId: "prompt-version-1",
            schemaVersionId: null,
            promptSnapshot: null,
            reasoningConfig: null,
            isReference: true,
        },
    ]),
    getRunCells: mocks.getRunCells,
    getScoredRunCellIds: vi.fn(async () => new Set<string>()),
    findCachedCell: mocks.findCachedCell,
    claimRunCells: vi.fn(async () => [
        {
            id: "cell-1",
            runModelId: "run-model-1",
            datasetItemId: "item-1",
        },
    ]),
    contentFingerprintForItem: vi.fn(
        (inputText: string | null, storageKey: string | null) =>
            `fingerprint:${inputText ?? ""}:${storageKey ?? ""}`,
    ),
}));

interface TransactionMock {
    delete: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
}

vi.mock("../prompts/service", () => ({
    getPromptVersion: vi.fn(async () => ({ content: "Extract food labels." })),
    getPromptSchemaVersion: vi.fn(),
}));

vi.mock("../pipelines/service", () => ({
    getPipeline: vi.fn(async () => ({
        id: "pipeline-1",
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { answer: { type: "string" } },
        },
        fieldConfigs: [],
    })),
    getPipelineForDataset: vi.fn(),
    fieldConfigsFromSchema: vi.fn(() => []),
}));

vi.mock("../datasets/service", () => ({
    getDatasetSchema: vi.fn(),
    getLabelsForItems: vi.fn(async () => new Map()),
}));

vi.mock("../images/source", () => ({
    loadImage: vi.fn(),
}));

vi.mock("../jobs/runOrchestrator", () => ({
    executeCell: mocks.executeCell,
}));

vi.mock("../secrets/resolveApiKeys", () => ({
    resolveApiKeys: vi.fn(async () => ({
        apiKeys: { openai: "sk-test", gateway: "vck-test" },
        sttProviderKeys: { openai: "sk-test", vercelGateway: "vck-test" },
    })),
}));

vi.mock("../llm/pricing", () => ({
    resolvePricingFor: vi.fn(),
}));

vi.mock("../scoring/scoreOutput", () => ({
    scoreOutput: vi.fn(),
}));

vi.mock("../scoring/judge", () => ({
    runJudge: vi.fn(),
}));

vi.mock("../judges/service", () => ({
    getJudgePromptVersion: vi.fn(),
}));

import { executeRun } from "./executor";

describe("executeRun provider metadata persistence", () => {
    beforeEach(() => {
        mocks.updatePayloads.length = 0;
        mocks.getRunCells.mockReset();
        mocks.getRunCells.mockResolvedValue([]);
        mocks.findCachedCell.mockReset();
        mocks.executeCell.mockReset();
        mocks.transport = undefined;
    });

    it("persists provider metadata returned by a fresh model execution", async () => {
        const providerMetadata = { gateway: { generationId: "gen_123" } };
        mocks.findCachedCell.mockResolvedValue(undefined);
        mocks.executeCell.mockResolvedValue({
            outputText: '{"answer":"yes"}',
            parsed: { answer: "yes" },
            schemaViolation: false,
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            latencyMs: 123,
            costSource: "unavailable",
            providerMetadata,
        });

        await executeRun("run-1");

        expect(metadataUpdate()).toEqual(
            expect.objectContaining({
                status: "succeeded",
                providerMetadata,
            }),
        );
    });

    it("copies provider metadata from cached cells", async () => {
        const providerMetadata = { gateway: { generationId: "gen_cached" } };
        mocks.findCachedCell.mockResolvedValue({
            outputJson: { answer: "yes" },
            latencyMs: 123,
            costUsd: null,
            costSource: "unavailable",
            promptTokens: 10,
            completionTokens: 5,
            providerMetadata,
        });

        await executeRun("run-1");

        expect(mocks.executeCell).not.toHaveBeenCalled();
        expect(metadataUpdate()).toEqual(
            expect.objectContaining({
                status: "cached",
                providerMetadata,
            }),
        );
    });

    it("does not reuse an identical cached cell from a different transport", async () => {
        mocks.transport = "openrouter";
        mocks.findCachedCell.mockImplementation(
            async (
                _itemId,
                _modelId,
                _promptVersionId,
                _maxTokens,
                _fingerprint,
                _schemaHash,
                transport,
            ) =>
                transport === "openai"
                    ? { outputJson: { answer: "from OpenAI" } }
                    : undefined,
        );
        mocks.executeCell.mockResolvedValue({
            outputText: '{"answer":"from OpenRouter"}',
            parsed: { answer: "from OpenRouter" },
            schemaViolation: false,
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            latencyMs: 123,
            costSource: "unavailable",
        });

        await executeRun("run-1");

        expect(mocks.findCachedCell).toHaveBeenCalledWith(
            "item-1",
            "gpt-4o",
            "prompt-version-1",
            100,
            "fingerprint:hello:",
            undefined,
            "openrouter",
        );
        expect(mocks.executeCell).toHaveBeenCalledWith(
            "gpt-4o",
            expect.anything(),
            expect.anything(),
            undefined,
            "openrouter",
        );
    });
});

function metadataUpdate(): UpdatePayload | undefined {
    return mocks.updatePayloads.find(
        (payload) => "providerMetadata" in payload,
    );
}
