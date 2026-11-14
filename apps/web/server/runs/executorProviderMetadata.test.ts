import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IRunDataPolicy } from "@flash-evals/api-contract";
import type * as RunStopModule from "./runStop";

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
    temperature: null as number | null,
    dataPolicy: undefined as IRunDataPolicy | undefined,
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
                        update,
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

vi.mock("./runStop", async (importOriginal) => {
    const actual = await importOriginal<typeof RunStopModule>();
    return {
        ...actual,
        createRunStopGuard: (runId: string) =>
            actual.createRunStopGuard(runId, {
                read: async () => ({ cancelRequested: false }),
            }),
    };
});
vi.mock("./service", () => ({
    getRun: vi.fn(async () => ({
        id: "run-1",
        status: "pending",
        datasetId: "dataset-1",
        pipelineId: "pipeline-1",
        judgeConfigId: null,
        judgePromptVersionId: null,
        configSnapshot: {
            maxTokens: 100,
            fieldConfigs: [],
            ...(mocks.dataPolicy ? { dataPolicy: mocks.dataPolicy } : {}),
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
            temperature: mocks.temperature,
            isReference: true,
        },
    ]),
    getRunCells: mocks.getRunCells,
    getScoredRunCellIds: vi.fn(async () => new Set<string>()),
    getBenchmarkDetailsToRetry: vi.fn(async () => new Map()),
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
    update: ReturnType<typeof vi.fn>;
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
import { sameDataPolicy } from "./dataPolicyReuse";
import { scoreOutput } from "../scoring/scoreOutput";
import { getLabelsForItems } from "../datasets/service";
import { getPipeline } from "../pipelines/service";

describe("executeRun provider metadata persistence", () => {
    beforeEach(() => {
        mocks.updatePayloads.length = 0;
        mocks.getRunCells.mockReset();
        mocks.getRunCells.mockResolvedValue([]);
        mocks.findCachedCell.mockReset();
        mocks.executeCell.mockReset();
        mocks.transport = undefined;
        mocks.temperature = null;
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

        // An "auto" run records the provider auto picked (the OpenAI key).
        expect(metadataUpdate()).toEqual(
            expect.objectContaining({
                status: "succeeded",
                providerMetadata: { ...providerMetadata, transport: "openai" },
            }),
        );
    });

    it("keys an auto run's saved answers by the provider auto picks", async () => {
        mocks.findCachedCell.mockResolvedValue(undefined);
        mocks.executeCell.mockResolvedValue({
            outputText: '{"answer":"yes"}',
            parsed: { answer: "yes" },
            schemaViolation: false,
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            latencyMs: 123,
            costSource: "unavailable",
        });

        await executeRun("run-1");

        expect(mocks.findCachedCell.mock.calls[0]![6]).toEqual({
            transport: undefined,
            resolvedTransport: "openai",
        });
    });

    it("records the provider an auto run's data rules route the call over", async () => {
        mocks.dataPolicy = { zeroDataRetention: true };
        mocks.findCachedCell.mockResolvedValue(undefined);
        mocks.executeCell.mockResolvedValue({
            outputText: '{"answer":"yes"}',
            parsed: { answer: "yes" },
            schemaViolation: false,
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            latencyMs: 123,
            costSource: "unavailable",
        });

        await executeRun("run-1");
        mocks.dataPolicy = undefined;

        // OpenAI refuses data rules, so the call goes via Gateway.
        expect(mocks.findCachedCell.mock.calls[0]![6]).toEqual({
            transport: undefined,
            resolvedTransport: "gateway",
        });
        expect(metadataUpdate()).toEqual(
            expect.objectContaining({
                providerMetadata: { transport: "gateway" },
            }),
        );
    });

    it("fails a cell cut off by the output limit once, without retrying it", async () => {
        mocks.findCachedCell.mockResolvedValue(undefined);
        mocks.executeCell.mockRejectedValue(
            new Error(
                "OpenRouter reached the output token limit for gpt-4o. Increase max output tokens and try again.",
            ),
        );

        await executeRun("run-1");

        expect(mocks.executeCell).toHaveBeenCalledOnce();
        expect(mocks.updatePayloads).toContainEqual(
            expect.objectContaining({
                status: "failed",
                error: expect.stringContaining("output token limit"),
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
                route: { transport?: string },
            ) =>
                route.transport === "openai"
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
            { transport: "openrouter" },
            undefined,
            undefined,
            undefined,
        );
        expect(mocks.executeCell).toHaveBeenCalledWith(
            "gpt-4o",
            expect.anything(),
            expect.anything(),
            undefined,
            "openrouter",
            undefined,
        );
    });
});

describe("executeRun temperature", () => {
    beforeEach(() => {
        mocks.updatePayloads.length = 0;
        mocks.getRunCells.mockReset();
        mocks.getRunCells.mockResolvedValue([]);
        mocks.findCachedCell.mockReset();
        mocks.executeCell.mockReset();
        mocks.transport = "openrouter";
        mocks.temperature = null;
        mocks.executeCell.mockResolvedValue({
            outputText: '{"answer":"yes"}',
            parsed: { answer: "yes" },
            schemaViolation: false,
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            latencyMs: 123,
            costSource: "unavailable",
        });
    });

    function cachedAt(temperature: number | undefined) {
        // Cached answers exist only for calls sent at `temperature`.
        mocks.findCachedCell.mockImplementation(async (...args: unknown[]) =>
            args[8] === temperature
                ? {
                      outputJson: { answer: "cached" },
                      providerMetadata: null,
                  }
                : undefined,
        );
    }

    it("sends the run model's temperature with every call", async () => {
        mocks.temperature = 0.4;
        mocks.findCachedCell.mockResolvedValue(undefined);

        await executeRun("run-1");

        expect(mocks.executeCell).toHaveBeenCalledWith(
            "gpt-4o",
            expect.objectContaining({ temperature: 0.4 }),
            expect.anything(),
            undefined,
            "openrouter",
            undefined,
        );
    });

    it("sends no temperature when the run set none", async () => {
        mocks.findCachedCell.mockResolvedValue(undefined);

        await executeRun("run-1");

        const request = mocks.executeCell.mock.calls[0]?.[1] as Record<
            string,
            unknown
        >;
        expect(request).not.toHaveProperty("temperature");
    });

    it("keys the answer cache by temperature", async () => {
        mocks.temperature = 0.4;
        mocks.findCachedCell.mockResolvedValue(undefined);

        await executeRun("run-1");

        expect(mocks.findCachedCell).toHaveBeenCalledWith(
            "item-1",
            "gpt-4o",
            "prompt-version-1",
            100,
            "fingerprint:hello:",
            undefined,
            { transport: "openrouter" },
            undefined,
            0.4,
            undefined,
        );
    });

    it("doesn't reuse an answer sent at another temperature", async () => {
        mocks.temperature = 0.4;
        cachedAt(undefined);

        await executeRun("run-1");

        expect(mocks.executeCell).toHaveBeenCalledOnce();
    });

    it("reuses an answer sent at the same temperature", async () => {
        mocks.temperature = 0.4;
        cachedAt(0.4);

        await executeRun("run-1");

        expect(mocks.executeCell).not.toHaveBeenCalled();
        expect(mocks.updatePayloads).toContainEqual(
            expect.objectContaining({ status: "cached" }),
        );
    });
});

describe("executeRun data rules and saved answers", () => {
    beforeEach(() => {
        mocks.updatePayloads.length = 0;
        mocks.getRunCells.mockReset();
        mocks.getRunCells.mockResolvedValue([]);
        mocks.findCachedCell.mockReset();
        mocks.executeCell.mockReset();
        mocks.transport = "openrouter";
        mocks.temperature = null;
        mocks.dataPolicy = undefined;
        mocks.executeCell.mockResolvedValue({
            outputText: '{"answer":"fresh"}',
            parsed: { answer: "fresh" },
            schemaViolation: false,
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            latencyMs: 123,
            costSource: "unavailable",
        });
    });

    /** A saved answer from a run made under `saved` (as findCachedCell matches). */
    function savedUnder(saved: IRunDataPolicy | undefined) {
        mocks.findCachedCell.mockImplementation(async (...args: unknown[]) => {
            const policy = args[9] as IRunDataPolicy | undefined;
            const matches = policy ? sameDataPolicy(policy, saved) : true;
            return matches
                ? { outputJson: { answer: "saved" }, providerMetadata: null }
                : undefined;
        });
    }

    it("looks up saved answers with the run's data rules", async () => {
        mocks.dataPolicy = { onlyHosts: ["vertex"], zeroDataRetention: true };
        mocks.findCachedCell.mockResolvedValue(undefined);

        await executeRun("run-1");

        expect(mocks.findCachedCell).toHaveBeenCalledOnce();
        expect(mocks.findCachedCell.mock.calls[0]![9]).toEqual({
            onlyHosts: ["vertex"],
            zeroDataRetention: true,
        });
    });

    it("reuses an answer saved under the same rules, hosts in any order", async () => {
        mocks.dataPolicy = { onlyHosts: ["vertex", "bedrock"] };
        savedUnder({ onlyHosts: ["bedrock", "vertex"] });

        await executeRun("run-1");

        expect(mocks.executeCell).not.toHaveBeenCalled();
        expect(mocks.updatePayloads).toContainEqual(
            expect.objectContaining({ status: "cached" }),
        );
    });

    it("answers afresh when the saved answer had other hosts", async () => {
        mocks.dataPolicy = { onlyHosts: ["vertex"] };
        savedUnder({ onlyHosts: ["vertex", "openai"] });

        await executeRun("run-1");

        expect(mocks.executeCell).toHaveBeenCalledOnce();
    });

    it("answers afresh when the saved answer was made without rules", async () => {
        mocks.dataPolicy = { zeroDataRetention: true };
        savedUnder(undefined);

        await executeRun("run-1");

        expect(mocks.executeCell).toHaveBeenCalledOnce();
    });

    it("still reuses any saved answer when the run has no rules", async () => {
        savedUnder({ onlyHosts: ["vertex"] });

        await executeRun("run-1");

        expect(mocks.findCachedCell.mock.calls[0]![9]).toBeUndefined();
        expect(mocks.executeCell).not.toHaveBeenCalled();
    });
});

function metadataUpdate(): UpdatePayload | undefined {
    return mocks.updatePayloads.find(
        (payload) => "providerMetadata" in payload,
    );
}

it("enables golden matching when the worker scores cached text outputs", async () => {
    const outputJson = { answer: "yes" };
    mocks.findCachedCell.mockResolvedValue({
        outputJson,
        latencyMs: 10,
        costUsd: 0.001,
        costSource: "computed",
        promptTokens: 10,
        completionTokens: 5,
    });
    mocks.getRunCells.mockResolvedValue([
        {
            id: "cell-1",
            runModelId: "run-model-1",
            datasetItemId: "item-1",
            status: "cached",
            outputJson,
        },
    ]);
    vi.mocked(getLabelsForItems).mockResolvedValue(
        new Map([["item-1", { answer: "yes" }]]),
    );
    vi.mocked(scoreOutput).mockResolvedValue({
        fieldDiff: { score: 1, details: { fields: [] } },
    });
    await executeRun("run-1");
    expect(scoreOutput).toHaveBeenCalledWith(
        expect.objectContaining({
            defaultFieldMatcher: "exact",
            fieldConfigs: [],
            label: { answer: "yes" },
            output: outputJson,
        }),
    );
});

it("does not exact-match labels against free-text outputs", async () => {
    vi.mocked(getPipeline).mockResolvedValueOnce(
        undefined as unknown as Awaited<ReturnType<typeof getPipeline>>,
    );
    const outputJson = { text: "Paris" };
    mocks.findCachedCell.mockResolvedValue({
        outputJson,
        latencyMs: 10,
        costUsd: 0.001,
        costSource: "computed",
        promptTokens: 10,
        completionTokens: 5,
    });
    mocks.getRunCells.mockResolvedValue([
        {
            id: "cell-1",
            runModelId: "run-model-1",
            datasetItemId: "item-1",
            status: "cached",
            outputJson,
        },
    ]);
    vi.mocked(getLabelsForItems).mockResolvedValue(
        new Map([["item-1", { answer: "Paris" }]]),
    );
    vi.mocked(scoreOutput).mockResolvedValue({});
    await executeRun("run-1");
    expect(scoreOutput).toHaveBeenCalledWith(
        expect.objectContaining({
            defaultFieldMatcher: undefined,
            output: outputJson,
        }),
    );
});
