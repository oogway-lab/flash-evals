import { beforeEach, describe, expect, it, vi } from "vitest";

const executionMocks = vi.hoisted(() => ({
    run: undefined as any,
    runModels: [] as Array<Record<string, any>>,
    cells: [] as Array<Record<string, any>>,
    items: [] as Array<Record<string, any>>,
    runStatus: "pending",
    recoverScoring: false,
    scoredCellIds: new Set<string>(),
    getOrCreateAudioTranscriptArtifact: vi.fn(),
    runTranscriptEvaluator: vi.fn(),
    executeCell: vi.fn(),
}));

vi.mock("../db/client", () => {
    function tableName(table: object): string | undefined {
        const symbol = Object.getOwnPropertySymbols(table).find(
            (candidate) => candidate.toString() === "Symbol(drizzle:Name)",
        );
        return symbol ? (table as Record<symbol, string>)[symbol] : undefined;
    }
    function cellId(
        value: unknown,
        seen = new WeakSet<object>(),
    ): string | undefined {
        if (typeof value === "string" && value.startsWith("cell-"))
            return value;
        if (!value || typeof value !== "object" || seen.has(value))
            return undefined;
        seen.add(value);
        for (const child of Object.values(value)) {
            const found = cellId(child, seen);
            if (found) return found;
        }
        return undefined;
    }
    const noOpWhere = { where: vi.fn(async () => undefined) };
    const transactionDb = {
        delete: vi.fn(() => noOpWhere),
        insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    };
    return {
        db: {
            select: vi.fn(() => ({
                from: vi.fn((table: object) => ({
                    where: vi.fn(async () =>
                        tableName(table) === "dataset_items"
                            ? executionMocks.items
                            : [],
                    ),
                })),
            })),
            update: vi.fn((table: object) => ({
                set: vi.fn((payload: Record<string, unknown>) => ({
                    where: vi.fn(async (condition: unknown) => {
                        if (tableName(table) === "runs" && payload.status)
                            executionMocks.runStatus = String(payload.status);
                        if (tableName(table) === "run_cells") {
                            const id = cellId(condition);
                            const cell = executionMocks.cells.find(
                                (candidate) => candidate.id === id,
                            );
                            if (cell) Object.assign(cell, payload);
                        }
                    }),
                })),
            })),
            transaction: vi.fn(
                async (run: (tx: typeof transactionDb) => unknown) =>
                    run(transactionDb),
            ),
        },
    };
});
vi.mock("./service", async (importOriginal) => {
    const actual = (await importOriginal()) as object;
    return {
        ...actual,
        getRun: vi.fn(async () => executionMocks.run),
        getRunModels: vi.fn(async () => executionMocks.runModels),
        getRunCells: vi.fn(async () => executionMocks.cells),
        getScoredRunCellIds: vi.fn(async () => executionMocks.scoredCellIds),
        findCachedCell: vi.fn(async () => undefined),
        claimRunCells: vi.fn(async () => {
            if (executionMocks.recoverScoring) return [];
            for (const cell of executionMocks.cells) cell.status = "running";
            return executionMocks.cells;
        }),
    };
});
vi.mock("../judges/service", () => ({
    getJudgePromptVersion: vi.fn(),
}));
vi.mock("../prompts/service", () => ({
    getPromptSchemaVersion: vi.fn(async () => undefined),
    getPromptVersion: vi.fn(async () => ({ content: "Prompt" })),
}));
vi.mock("../datasets/service", () => ({
    getDatasetSchema: vi.fn(async () => undefined),
    getLabelsForItems: vi.fn(async () => new Map()),
}));
vi.mock("../pipelines/service", async (importOriginal) => {
    const actual = (await importOriginal()) as object;
    return {
        ...actual,
        getPipeline: vi.fn(async () => undefined),
        getPipelineForDataset: vi.fn(async () => undefined),
    };
});
vi.mock("../audio/transcription", () => ({
    getOrCreateAudioTranscriptArtifactWithProvenance: async (
        input: unknown,
    ) => ({
        artifact:
            await executionMocks.getOrCreateAudioTranscriptArtifact(input),
        cacheHit: false,
        lookupLatencyMs: 0,
    }),
}));
vi.mock("../audio/transliteration", () => ({
    getOrCreateTransliteration: vi.fn(),
}));
vi.mock("../audio/customEvaluators", () => ({
    runTranscriptEvaluator: executionMocks.runTranscriptEvaluator,
}));
vi.mock("../jobs/runOrchestrator", () => ({
    executeCell: executionMocks.executeCell,
}));
vi.mock("../secrets/resolveApiKeys", () => ({
    resolveApiKeys: vi.fn(async () => ({
        apiKeys: {},
        sttProviderKeys: { soniox: "soniox-key" },
    })),
}));
vi.mock("../llm/pricing", () => ({
    resolvePricingFor: vi.fn(async () => ({})),
}));
vi.mock("../scoring/scoreOutput", () => ({
    scoreOutput: vi.fn(async () => ({})),
}));
vi.mock("../scoring/judge", () => ({ runJudge: vi.fn() }));

import { contentFingerprintForItem } from "./service";
import { getJudgePromptVersion } from "../judges/service";
import {
    audioFingerprintStorageKey,
    fieldConfigsForRunScoring,
    judgePromptVersionForRun,
    legacyJudgeRationale,
    loadJudgePromptForRun,
    stableConfigString,
    sttConfigForRunModel,
    structuredOutputFailureReason,
    executeRun,
} from "./executor";
import { resolveReasoningEffort } from "../llm/reasoningConfig";

describe("contentFingerprintForItem", () => {
    it("changes when input text changes", () => {
        expect(contentFingerprintForItem("before", "image-key")).not.toBe(
            contentFingerprintForItem("after", "image-key"),
        );
    });

    it("changes when image storage key changes", () => {
        expect(contentFingerprintForItem("same", "old-key")).not.toBe(
            contentFingerprintForItem("same", "new-key"),
        );
    });

    it("stays equal for identical content, independent of label edits", () => {
        expect(contentFingerprintForItem("same", "image-key")).toBe(
            contentFingerprintForItem("same", "image-key"),
        );
    });
});

describe("stableConfigString", () => {
    it("normalizes nested object key order for transcript cache identity", () => {
        expect(
            stableConfigString({
                prompt: "terms",
                providerOptions: {
                    beta: true,
                    alpha: { language: "hi", punctuation: false },
                },
            }),
        ).toBe(
            stableConfigString({
                providerOptions: {
                    alpha: { punctuation: false, language: "hi" },
                    beta: true,
                },
                prompt: "terms",
            }),
        );
    });

    it("preserves array order in config identity", () => {
        expect(stableConfigString({ languages: ["hi", "en"] })).not.toBe(
            stableConfigString({ languages: ["en", "hi"] }),
        );
    });
});

describe("audioFingerprintStorageKey", () => {
    const audioItem = {
        type: "audio",
        storageKey: "audio/sample.webm",
        mimeType: "audio/webm",
    } as never;
    const textItem = {
        type: "text",
        storageKey: null,
        mimeType: null,
    } as never;

    it("keeps non-audio fingerprints on the original storage key", () => {
        expect(
            audioFingerprintStorageKey(textItem, {
                modelId: "gpt-4o-mini-transcribe",
            }),
        ).toBeNull();
    });

    it("changes downstream eval cache identity when transcript variant changes", () => {
        const raw = audioFingerprintStorageKey(audioItem, {
            modelId: "gpt-4o-mini-transcribe",
            transcriptVariant: "raw",
        });
        const latin = audioFingerprintStorageKey(audioItem, {
            modelId: "gpt-4o-mini-transcribe",
            transcriptVariant: "latin",
            transliteration: {
                enabled: true,
                targetScript: "latin",
                modelId: "gpt-4o-mini",
            },
        });

        expect(raw).not.toBe(latin);
    });

    it("changes downstream eval cache identity when STT config changes", () => {
        const plain = audioFingerprintStorageKey(audioItem, {
            modelId: "soniox:stt-async-v5",
            config: { diarization: false },
        });
        const diarized = audioFingerprintStorageKey(audioItem, {
            modelId: "soniox:stt-async-v5",
            config: { diarization: true },
        });

        expect(plain).not.toBe(diarized);
    });

    it("changes downstream eval cache identity when provider route changes", () => {
        const direct = audioFingerprintStorageKey(audioItem, {
            modelId: "gpt-4o-transcribe",
            providerId: "openai",
            routeId: "openai-audio-transcriptions",
            canonicalModelId: "gpt-4o-transcribe",
        });
        const gateway = audioFingerprintStorageKey(audioItem, {
            modelId: "vercel:openai/gpt-4o-transcribe",
            providerId: "vercel-gateway",
            routeId: "vercel-ai-gateway-stt",
            canonicalModelId: "openai/gpt-4o-transcribe",
        });

        expect(direct).not.toBe(gateway);
    });

    it("does not collide when a field value contains colon separators", () => {
        const withColonInModel = audioFingerprintStorageKey(audioItem, {
            modelId: "provider:model:v1",
            providerId: "openai",
            routeId: "route",
        });
        const splitAcrossFields = audioFingerprintStorageKey(audioItem, {
            modelId: "model",
            providerId: "openai",
            routeId: "route:v1",
        });

        expect(withColonInModel).not.toBe(splitAcrossFields);
        expect(withColonInModel).toContain("[");
    });
});

describe("sttConfigForRunModel", () => {
    it("resolves same-model variants independently and preserves fingerprint identity", () => {
        const audioItem = {
            type: "audio",
            storageKey: "audio/sample.webm",
            mimeType: "audio/webm",
        } as never;
        const snapshot = {
            sttConfig: { modelId: "legacy-model" },
            sttVariants: {
                on: {
                    variantKey: "on",
                    label: "Diarization on",
                    config: {
                        modelId: "soniox:stt-async-v5",
                        config: { diarization: true },
                    },
                },
                off: {
                    variantKey: "off",
                    label: "Diarization off",
                    config: {
                        modelId: "soniox:stt-async-v5",
                        config: { diarization: false },
                    },
                },
            },
        };
        const on = sttConfigForRunModel(snapshot, "stt:soniox:stt-async-v5#on");
        const off = sttConfigForRunModel(
            snapshot,
            "stt:soniox:stt-async-v5#off",
        );

        expect(on?.config).toEqual({ diarization: true });
        expect(off?.config).toEqual({ diarization: false });
        expect(audioFingerprintStorageKey(audioItem, on)).not.toBe(
            audioFingerprintStorageKey(audioItem, off),
        );
        expect(
            contentFingerprintForItem(
                null,
                audioFingerprintStorageKey(audioItem, on),
            ),
        ).not.toBe(
            contentFingerprintForItem(
                null,
                audioFingerprintStorageKey(audioItem, off),
            ),
        );
    });

    it("falls back to the scalar config for historical runs", () => {
        const legacy = { modelId: "gpt-4o-mini-transcribe" };

        expect(
            sttConfigForRunModel(
                { sttConfig: legacy },
                "stt:gpt-4o-mini-transcribe",
            ),
        ).toBe(legacy);
    });
});

describe("resolveReasoningEffort", () => {
    it("returns a supported reasoning effort for reasoning models", () => {
        expect(resolveReasoningEffort("gpt-5.5", "high")).toBe("high");
    });

    it("omits reasoning effort for non-reasoning models", () => {
        expect(resolveReasoningEffort("gpt-4o", "high")).toBeUndefined();
    });

    it("omits unsupported effort levels for a reasoning model", () => {
        expect(resolveReasoningEffort("gpt-5.5", "minimal")).toBeUndefined();
    });

    it("falls back to the default effort for reasoning models", () => {
        expect(resolveReasoningEffort("gpt-5.5")).toBe("medium");
    });
});

describe("judgePromptVersionForRun", () => {
    it("uses a judge prompt version for new runs", () => {
        expect(
            judgePromptVersionForRun({
                judgeConfigId: null,
                judgePromptVersionId: "judge-pv-1",
            }),
        ).toBe("judge-pv-1");
    });

    it("keeps historical judge_config runs on the legacy path", () => {
        expect(
            judgePromptVersionForRun({
                judgeConfigId: "legacy-judge-1",
                judgePromptVersionId: "judge-pv-1",
            }),
        ).toBeUndefined();
    });
});

describe("loadJudgePromptForRun", () => {
    it("logs and omits a judge prompt when the fetch throws", async () => {
        vi.mocked(getJudgePromptVersion).mockRejectedValueOnce(
            new Error("database unavailable"),
        );
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);

        await expect(
            loadJudgePromptForRun({
                judgeConfigId: null,
                judgePromptVersionId: "judge-pv-1",
            }),
        ).resolves.toBeUndefined();

        expect(errorSpy).toHaveBeenCalledWith(
            "failed to load judge prompt version judge-pv-1:",
            expect.stringContaining("database unavailable"),
        );
        errorSpy.mockRestore();
    });

    it("redacts credentials from the logged error", async () => {
        vi.mocked(getJudgePromptVersion).mockRejectedValueOnce(
            new Error(
                "fetch failed with Authorization: Bearer sk-live-abcdef123456",
            ),
        );
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);

        await loadJudgePromptForRun({
            judgeConfigId: null,
            judgePromptVersionId: "judge-pv-1",
        });

        const logged = errorSpy.mock.calls.flat().map(String).join(" ");
        expect(logged).toContain("fetch failed");
        expect(logged).not.toContain("sk-live-abcdef123456");
        errorSpy.mockRestore();
    });
});

describe("fieldConfigsForRunScoring", () => {
    it("uses prompt-schema run snapshot field configs without a legacy pipeline", () => {
        const snapshot = [
            {
                field: "components",
                kind: "generative" as const,
                rubric: "Check visible food components.",
                modelId: "gpt-4o-mini",
            },
        ];

        expect(
            fieldConfigsForRunScoring({
                snapshotFieldConfigs: snapshot,
            }),
        ).toBe(snapshot);
    });

    it("falls back to dataset schema rules when no run snapshot config exists", () => {
        expect(
            fieldConfigsForRunScoring({
                datasetSchema: {
                    jsonSchema: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                        },
                    },
                    fieldRules: [
                        {
                            field: "title",
                            matcher: "exact",
                        },
                    ],
                },
            }),
        ).toEqual([
            {
                field: "title",
                kind: "factual",
                spec: {
                    matcher: "exact",
                },
            },
        ]);
    });
});

describe("legacyJudgeRationale", () => {
    it("keeps a successful judge rationale as is", () => {
        expect(
            legacyJudgeRationale({
                ok: true,
                score: 1,
                rationale: "matches the label",
                criteria: [],
                winner: "candidate",
            }),
        ).toBe("matches the label");
    });

    it("redacts credentials from a failed judge's provider error", () => {
        const rationale = legacyJudgeRationale({
            ok: false,
            error: "401 Incorrect API key provided: sk-proj-abcDEF1234567890",
        });

        expect(rationale).toContain("judge error: 401 Incorrect API key");
        expect(rationale).not.toContain("sk-proj-abcDEF1234567890");
    });
});

describe("structuredOutputFailureReason", () => {
    it("fails empty structured output instead of allowing a succeeded empty text cell", () => {
        expect(
            structuredOutputFailureReason({
                expectsStructuredOutput: true,
                parsedObject: undefined,
                schemaViolation: true,
                outputText: "",
            }),
        ).toBe("Model returned empty structured output.");
    });

    it("fails non-object structured output with a clear message", () => {
        expect(
            structuredOutputFailureReason({
                expectsStructuredOutput: true,
                parsedObject: undefined,
                schemaViolation: true,
                outputText: "[]",
            }),
        ).toBe("Model did not return a structured JSON object.");
    });

    it("uses schema validation errors when an object violates the schema", () => {
        expect(
            structuredOutputFailureReason({
                expectsStructuredOutput: true,
                parsedObject: { title: "Food" },
                schemaViolation: true,
                outputText: '{"title":"Food"}',
                schemaError: "components is required",
            }),
        ).toBe("components is required");
    });

    it("does not fail freeform output", () => {
        expect(
            structuredOutputFailureReason({
                expectsStructuredOutput: false,
                parsedObject: undefined,
                schemaViolation: true,
                outputText: "",
            }),
        ).toBeUndefined();
    });
});

describe("executeRun STT variants", () => {
    beforeEach(() => {
        executionMocks.runModels = [
            runModel("rm-a", "stt:soniox:stt-async-v5#on"),
            runModel("rm-b", "stt:soniox:stt-async-v5#off"),
        ];
        executionMocks.cells = [
            runCell("cell-a", "rm-a"),
            runCell("cell-b", "rm-b"),
        ];
        executionMocks.items = [
            {
                id: "item-1",
                type: "audio",
                inputText: null,
                storageKey: "audio.wav",
                mimeType: "audio/wav",
            },
        ];
        executionMocks.run = runWithVariants();
        executionMocks.runStatus = "pending";
        executionMocks.recoverScoring = false;
        executionMocks.scoredCellIds.clear();
        executionMocks.getOrCreateAudioTranscriptArtifact.mockReset();
        executionMocks.runTranscriptEvaluator.mockReset();
        executionMocks.runTranscriptEvaluator.mockResolvedValue({
            score: 1,
            details: { criteria: [] },
            rationale: "accurate",
        });
        executionMocks.executeCell.mockReset();
    });

    it("retains fresh transcription latency and usage in metric cells", async () => {
        const artifact = transcriptArtifact("hello", "config-hash");
        executionMocks.getOrCreateAudioTranscriptArtifact.mockResolvedValue({
            ...artifact,
            providerMetadata: {
                ...artifact.providerMetadata,
                latencyMsTotal: 1250,
                usage: { inputTokens: 80, outputTokens: 12, totalTokens: 92 },
            },
        });
        await executeRun("run-1");
        for (const cell of executionMocks.cells) {
            expect(cell).toMatchObject({
                status: "succeeded",
                latencyMs: 1250,
                promptTokens: 80,
                completionTokens: 12,
            });
        }
    });

    it("isolates a provider failure to one variant and terminalizes the run", async () => {
        executionMocks.getOrCreateAudioTranscriptArtifact.mockImplementation(
            async (input) => {
                if (input.config?.diarization)
                    throw new Error("variant A provider unavailable");
                return transcriptArtifact("plain transcript", "plain-hash");
            },
        );

        await executeRun("run-1");

        expect(executionMocks.cells).toEqual([
            expect.objectContaining({
                id: "cell-a",
                status: "failed",
                error: "variant A provider unavailable",
            }),
            expect.objectContaining({
                id: "cell-b",
                status: "succeeded",
                outputJson: expect.objectContaining({
                    transcript: "plain transcript",
                }),
            }),
        ]);
        expect(executionMocks.runStatus).toBe("partial");
    });

    it("redacts API keys from the persisted cell error", async () => {
        executionMocks.getOrCreateAudioTranscriptArtifact.mockImplementation(
            async (input) => {
                if (input.config?.diarization)
                    throw new Error(
                        "401 Incorrect API key provided: sk-proj-abcDEF1234567890",
                    );
                return transcriptArtifact("plain transcript", "plain-hash");
            },
        );

        await executeRun("run-1");

        const failed = executionMocks.cells.find(
            (cell) => cell.id === "cell-a",
        ) as { status: string; error: string } | undefined;
        expect(failed?.status).toBe("failed");
        expect(failed?.error).toContain("Incorrect API key provided");
        expect(failed?.error).not.toContain("sk-proj-abcDEF1234567890");
    });

    it("creates distinct transcripts and invokes the judge for every variant", async () => {
        executionMocks.getOrCreateAudioTranscriptArtifact.mockImplementation(
            async (input) =>
                input.config?.diarization
                    ? transcriptArtifact("speaker transcript", "speaker-hash")
                    : transcriptArtifact("plain transcript", "plain-hash"),
        );
        executionMocks.runTranscriptEvaluator.mockResolvedValue({
            score: 1,
            details: { criteria: [] },
            rationale: "accurate",
        });

        await executeRun("run-1");

        expect(
            executionMocks.getOrCreateAudioTranscriptArtifact,
        ).toHaveBeenCalledTimes(2);
        expect(
            executionMocks.cells.map(
                (cell) =>
                    (cell.outputJson as { transcript: string }).transcript,
            ),
        ).toEqual(["speaker transcript", "plain transcript"]);
        expect(executionMocks.runTranscriptEvaluator).toHaveBeenCalledTimes(2);
        expect(
            executionMocks.runTranscriptEvaluator.mock.calls.map(
                (call) => call[0].transcript,
            ),
        ).toEqual(["speaker transcript", "plain transcript"]);
        expect(executionMocks.runStatus).toBe("completed");
    });

    it("scores generated cells left unfinished by a dead worker", async () => {
        executionMocks.recoverScoring = true;
        for (const cell of executionMocks.cells) {
            cell.status = "succeeded";
            cell.outputJson = { transcript: "generated before worker exit" };
        }
        executionMocks.getOrCreateAudioTranscriptArtifact.mockResolvedValue(
            transcriptArtifact("recovered transcript", "recovered-hash"),
        );

        await executeRun("run-1");

        expect(executionMocks.runTranscriptEvaluator).toHaveBeenCalledTimes(2);
        expect(executionMocks.runStatus).toBe("completed");
    });
});

function runModel(id: string, modelId: string) {
    return {
        id,
        runId: "run-1",
        modelId,
        promptVersionId: null,
        schemaVersionId: null,
        promptSnapshot: null,
        reasoningConfig: null,
        isReference: false,
    };
}

function runCell(id: string, runModelId: string) {
    return {
        id,
        runId: "run-1",
        datasetItemId: "item-1",
        runModelId,
        status: "pending",
        outputJson: null,
    };
}

function runWithVariants() {
    const evaluator = {
        enabled: true,
        modelId: "gpt-4o-mini",
        rubricPrompt: "Judge transcript accuracy.",
    };
    return {
        id: "run-1",
        teamId: "team-1",
        datasetId: "dataset-1",
        pipelineId: null,
        judgeConfigId: null,
        judgePromptVersionId: null,
        configSnapshot: {
            maxTokens: 1024,
            fieldConfigs: [],
            models: [],
            sttVariants: {
                on: {
                    variantKey: "on",
                    label: "Diarization on",
                    config: {
                        modelId: "soniox:stt-async-v5",
                        config: { diarization: true },
                        evaluator,
                    },
                },
                off: {
                    variantKey: "off",
                    label: "Diarization off",
                    config: {
                        modelId: "soniox:stt-async-v5",
                        config: { diarization: false },
                        evaluator,
                    },
                },
            },
        },
    };
}

function transcriptArtifact(text: string, configHash: string) {
    return {
        text,
        segments: [],
        providerMetadata: {
            provider: "soniox",
            route: "soniox-async",
            configHash,
        },
    };
}
