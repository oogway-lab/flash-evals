import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as RunStopModule from "./runStop";
import type * as JudgeCostModule from "./judgeCost";
import type * as BenchmarkModule from "../scoring/benchmark";
import type * as TransliterationModule from "../audio/transliteration";

const executionMocks = vi.hoisted(() => ({
    run: undefined as any,
    runModels: [] as Array<Record<string, any>>,
    cells: [] as Array<Record<string, any>>,
    items: [] as Array<Record<string, any>>,
    runStatus: "pending",
    recoverScoring: false,
    scoredCellIds: new Set<string>(),
    benchmarkToRetry: new Map<string, Record<string, any>>(),
    getOrCreateAudioTranscriptArtifact: vi.fn(),
    runTranscriptEvaluator: vi.fn(),
    executeCell: vi.fn(),
    scoreInserts: [] as Array<Record<string, any>>,
    scoreAgainstBenchmark: vi.fn(),
    labels: new Map<string, Record<string, unknown>>(),
    // Cancel requested after this many stop checks (undefined: never).
    cancelAfterChecks: undefined as number | undefined,
    stopChecks: 0,
    stopReason: undefined as string | undefined,
    spendAfterChecks: undefined as number | undefined,
    recordJudgeCost: vi.fn(async () => undefined),
    existingScores: [] as Array<Record<string, any>>,
    /** What the transcription cost now (0: reused from the cache). */
    transcriptIncurredCostUsd: undefined as number | undefined,
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
        if (
            typeof value === "string" &&
            executionMocks.cells.some((cell) => cell.id === value)
        )
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
    const update = vi.fn((table: object) => ({
        set: vi.fn((payload: Record<string, unknown>) => ({
            where: vi.fn(async (condition: unknown) => {
                // Only a finished run (see markLateAnswerUnscored).
                const lateAnswer =
                    tableName(table) === "runs" &&
                    new PgDialect()
                        .sqlToQuery(condition as never)
                        .params.includes("completed") &&
                    !["completed", "failed"].includes(executionMocks.runStatus);
                if (
                    tableName(table) === "runs" &&
                    payload.status &&
                    !lateAnswer
                )
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
    }));
    const transactionDb = {
        update,
        delete: vi.fn(() => noOpWhere),
        insert: vi.fn(() => ({
            values: vi.fn(async (values: Record<string, any>) => {
                executionMocks.scoreInserts.push(values);
            }),
        })),
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
            update,
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
        getBenchmarkDetailsToRetry: vi.fn(
            async () => executionMocks.benchmarkToRetry,
        ),
        findCachedCell: vi.fn(async () => undefined),
        getScoresForCells: vi.fn(async (ids: string[]) =>
            executionMocks.existingScores.filter((row) =>
                ids.includes(row.runCellId),
            ),
        ),
        claimRunCells: vi.fn(async () => {
            if (executionMocks.recoverScoring) return [];
            for (const cell of executionMocks.cells) cell.status = "running";
            return executionMocks.cells;
        }),
    };
});
vi.mock("./runStop", async (importOriginal) => {
    const actual = await importOriginal<typeof RunStopModule>();
    return {
        ...actual,
        createRunStopGuard: (
            runId: string,
            options: { maxCostUsd?: number } = {},
        ) =>
            actual.createRunStopGuard(runId, {
                ...options,
                pollMs: 0,
                // Spend reaches 1 USD after this many checks.
                readSpend: async () =>
                    executionMocks.stopChecks >
                    (executionMocks.spendAfterChecks ?? Infinity)
                        ? 1
                        : 0,
                read: async () => {
                    executionMocks.stopChecks += 1;
                    const after = executionMocks.cancelAfterChecks;
                    return {
                        cancelRequested:
                            after !== undefined &&
                            executionMocks.stopChecks > after,
                    };
                },
            }),
        releaseUnstartedCell: async (cellId: string) => {
            const cell = executionMocks.cells.find((c) => c.id === cellId);
            if (cell?.status === "running") cell.status = "pending";
        },
        finishStoppedRun: async (_runId: string, reason: string) => {
            for (const cell of executionMocks.cells)
                if (cell.status === "running") cell.status = "pending";
            executionMocks.runStatus = "cancelled";
            executionMocks.stopReason = reason;
        },
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
    getLabelsForItems: vi.fn(async () => executionMocks.labels),
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
        cacheHit: executionMocks.transcriptIncurredCostUsd === 0,
        lookupLatencyMs: 0,
        incurredCostUsd: executionMocks.transcriptIncurredCostUsd,
    }),
}));
vi.mock("../audio/transliteration", async (importOriginal) => ({
    ...(await importOriginal<typeof TransliterationModule>()),
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
vi.mock("../scoring/benchmark", async (importOriginal) => ({
    benchmarkJudgeCostUsd: (await importOriginal<typeof BenchmarkModule>())
        .benchmarkJudgeCostUsd,
    scoreAgainstBenchmark: executionMocks.scoreAgainstBenchmark,
}));
vi.mock("./judgeCost", async (importOriginal) => {
    const actual = await importOriginal<typeof JudgeCostModule>();
    return {
        ...actual,
        recordJudgeCost: executionMocks.recordJudgeCost,
    };
});

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
    evalConcurrency,
} from "./executor";
import { resolveReasoningEffort } from "../llm/reasoningConfig";
import { scoreOutput } from "../scoring/scoreOutput";
import {
    getOrCreateTransliteration,
    TransliterationFailedError,
} from "../audio/transliteration";

beforeEach(() => {
    executionMocks.cancelAfterChecks = undefined;
    executionMocks.stopChecks = 0;
    executionMocks.stopReason = undefined;
    executionMocks.spendAfterChecks = undefined;
});

describe("evalConcurrency", () => {
    it("uses the default for an empty or malformed setting", () => {
        expect(evalConcurrency("")).toBe(5);
        expect(evalConcurrency("3x")).toBe(5);
        expect(evalConcurrency(undefined)).toBe(5);
        expect(evalConcurrency("2")).toBe(2);
    });
});

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

    it("keeps fingerprints without levelling and separates levelled audio", () => {
        const base = { modelId: "elevenlabs:scribe_v2" };
        const plain = audioFingerprintStorageKey(audioItem, base);
        expect(
            audioFingerprintStorageKey(audioItem, {
                ...base,
                levelVolume: false,
            }),
        ).toBe(plain);
        expect(JSON.parse(plain as string)).toHaveLength(9);
        expect(
            audioFingerprintStorageKey(audioItem, {
                ...base,
                levelVolume: true,
            }),
        ).not.toBe(plain);
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

    it("sends a stored level for a Bifrost id, as its registry model takes it", () => {
        for (const [modelId, level] of [
            ["openrouter/anthropic/claude-sonnet-5.5", "medium"],
            ["openrouter/openai/gpt-6-luna", "low"],
            ["openrouter/deepseek/deepseek-v4.1-flash", "none"],
            ["openrouter/google/gemini-3.5-flash-lite", "high"],
            ["openrouter/anthropic/claude-haiku-5.5", "none"],
            ["openrouter/anthropic/claude-sonnet-4.6", "medium"],
            ["openrouter/google/gemma-4-31b-it", "medium"],
            ["openrouter/z-ai/glm-5.2", "low"],
            ["openrouter/minimax/minimax-m3", "high"],
        ] as const)
            expect(resolveReasoningEffort(modelId, level), modelId).toBe(level);
        expect(resolveReasoningEffort("openrouter/google/gemma-4-31b-it")).toBe(
            "none",
        );
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

        const logged = String(errorSpy.mock.calls[0]?.[0]);
        expect(JSON.parse(logged)).toMatchObject({
            service: "flash-evals-worker",
            event: "judge_prompt.load_failed",
            errorName: "Error",
        });
        expect(logged).not.toContain("database unavailable");
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
        expect(logged).not.toContain("sk-live-abcdef123456");
        expect(logged).not.toContain("fetch failed");
        expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toMatchObject({
            service: "flash-evals-worker",
            event: "judge_prompt.load_failed",
            errorName: "Error",
        });
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
            error: "401 Incorrect API key provided: sk-proj-aaaaaaaaaaaaaaaa",
        });

        expect(rationale).toContain("judge error: 401 Incorrect API key");
        expect(rationale).not.toContain("sk-proj-aaaaaaaaaaaaaaaa");
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

    it.each(["completed", "partial", "failed"])(
        "does not execute a %s run again for a late or duplicate job",
        async (status) => {
            executionMocks.run = { ...runWithVariants(), status };
            executionMocks.runStatus = status;

            await executeRun("run-1");

            expect(
                executionMocks.getOrCreateAudioTranscriptArtifact,
            ).not.toHaveBeenCalled();
            expect(executionMocks.runStatus).toBe(status);
            expect(
                executionMocks.cells.every((cell) => cell.status !== "running"),
            ).toBe(true);
        },
    );

    it("cancels a run before claiming any cell when a cancel is already asked for", async () => {
        executionMocks.cancelAfterChecks = 0;

        await executeRun("run-1");

        expect(
            executionMocks.getOrCreateAudioTranscriptArtifact,
        ).not.toHaveBeenCalled();
        expect(executionMocks.runStatus).toBe("cancelled");
        expect(executionMocks.stopReason).toBe("cancelled");
        expect(executionMocks.cells.map((cell) => cell.status)).toEqual([
            "pending",
            "pending",
        ]);
    });

    it("stops claiming new cells once cancelled and leaves unstarted cells not run", async () => {
        executionMocks.getOrCreateAudioTranscriptArtifact.mockResolvedValue(
            transcriptArtifact("hello", "config-hash"),
        );
        // One cell at a time: the start check passes, the first cell
        // starts, then the cancel lands before the second.
        vi.stubEnv("EVAL_CONCURRENCY", "1");
        executionMocks.cancelAfterChecks = 2;

        await executeRun("run-1");
        vi.unstubAllEnvs();

        expect(
            executionMocks.getOrCreateAudioTranscriptArtifact,
        ).toHaveBeenCalledTimes(1);
        expect(executionMocks.cells.map((cell) => cell.status)).toEqual([
            "succeeded",
            "pending",
        ]);
        expect(executionMocks.runStatus).toBe("cancelled");
        // The stopped run is not scored further (no judge spend after cancel).
        expect(executionMocks.runTranscriptEvaluator).not.toHaveBeenCalled();
    });

    it("stops starting cells once the run's spend reaches its limit", async () => {
        executionMocks.getOrCreateAudioTranscriptArtifact.mockResolvedValue(
            transcriptArtifact("hello", "config-hash"),
        );
        const run = runWithVariants();
        executionMocks.run = {
            ...run,
            configSnapshot: { ...run.configSnapshot, maxCostUsd: 0.5 },
        };
        vi.stubEnv("EVAL_CONCURRENCY", "1");
        executionMocks.spendAfterChecks = 2;

        await executeRun("run-1");
        vi.unstubAllEnvs();

        expect(executionMocks.cells.map((cell) => cell.status)).toEqual([
            "succeeded",
            "pending",
        ]);
        expect(executionMocks.runStatus).toBe("cancelled");
        expect(executionMocks.stopReason).toBe("spend_cap");
    });

    it("stops starting cells and leaves the run alone once its lease is lost", async () => {
        executionMocks.getOrCreateAudioTranscriptArtifact.mockResolvedValue(
            transcriptArtifact("hello", "config-hash"),
        );
        vi.stubEnv("EVAL_CONCURRENCY", "1");
        let lost = false;
        executionMocks.getOrCreateAudioTranscriptArtifact.mockImplementation(
            async () => {
                lost = true;
                return transcriptArtifact("hello", "config-hash");
            },
        );

        await executeRun("run-1", { leaseLost: () => lost });
        vi.unstubAllEnvs();

        expect(executionMocks.cells.map((cell) => cell.status)).toEqual([
            "succeeded",
            "pending",
        ]);
        // Neither finished nor cancelled: the new owner finishes it.
        expect(executionMocks.runStatus).toBe("running");
        expect(executionMocks.runTranscriptEvaluator).not.toHaveBeenCalled();
        // The answer came after the takeover: left for scoring.
        expect(executionMocks.cells[0]!.error).toContain(
            "another worker took over",
        );
    });

    it("leaves an answer written after the new pass finished the run for Retry to score", async () => {
        vi.stubEnv("EVAL_CONCURRENCY", "1");
        executionMocks.getOrCreateAudioTranscriptArtifact.mockImplementation(
            async () => {
                // Taken over, and the new pass finished while this call ran.
                lost = true;
                executionMocks.runStatus = "completed";
                return transcriptArtifact("hello", "config-hash");
            },
        );
        let lost = false;

        await executeRun("run-1", { leaseLost: () => lost });
        vi.unstubAllEnvs();

        expect(executionMocks.cells[0]).toMatchObject({
            status: "succeeded",
            error: expect.stringContaining("Retry scores it"),
        });
        expect(executionMocks.runStatus).toBe("partial");
    });

    it.each([
        ["reused from the cache", 0, 0],
        ["made now", 0.05, 0.05],
    ])(
        "counts a transcript %s as spend of what it cost now",
        async (_case, incurred, spent) => {
            executionMocks.transcriptIncurredCostUsd = incurred;
            const artifact = transcriptArtifact("hello", "config-hash");
            executionMocks.getOrCreateAudioTranscriptArtifact.mockResolvedValue(
                {
                    ...artifact,
                    providerMetadata: {
                        ...artifact.providerMetadata,
                        costUsd: 0.05,
                    },
                },
            );

            await executeRun("run-1");
            executionMocks.transcriptIncurredCostUsd = undefined;

            for (const cell of executionMocks.cells) {
                // The list cost stays on the cell for display.
                expect(cell.costUsd).toBe(0.05);
                expect(
                    new PgDialect().sqlToQuery(cell.incurredCostUsd).params,
                ).toEqual([spent]);
            }
        },
    );

    it("ignores spend when the run has no limit", async () => {
        executionMocks.getOrCreateAudioTranscriptArtifact.mockResolvedValue(
            transcriptArtifact("hello", "config-hash"),
        );
        executionMocks.spendAfterChecks = 0;

        await executeRun("run-1");

        expect(executionMocks.runStatus).toBe("completed");
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

    it("charges transcription paid before it failed to the cell, once", async () => {
        executionMocks.getOrCreateAudioTranscriptArtifact.mockImplementation(
            async (input) => {
                if (input.config?.diarization) {
                    // Two chunks paid, then the provider fails.
                    await input.onCostIncurred(0.02);
                    await input.onCostIncurred(0.01);
                    throw new Error("chunk 3 failed");
                }
                return transcriptArtifact("plain transcript", "plain-hash");
            },
        );

        await executeRun("run-1");

        const [failed, ok] = executionMocks.cells;
        expect(failed).toMatchObject({ status: "failed" });
        expect(
            new PgDialect().sqlToQuery(failed!.incurredCostUsd).params,
        ).toEqual([0.03]);
        expect(new PgDialect().sqlToQuery(ok!.incurredCostUsd).params).toEqual([
            0,
        ]);
    });

    it("charges a paid but failed transliteration to the cell, once", async () => {
        const run = runWithVariants();
        run.configSnapshot.sttVariants.on.config = {
            ...run.configSnapshot.sttVariants.on.config,
            transcriptVariant: "latin",
            transliteration: {
                enabled: true,
                targetScript: "latin",
                modelId: "gpt-4o-mini",
            },
        } as never;
        executionMocks.run = run;
        executionMocks.getOrCreateAudioTranscriptArtifact.mockImplementation(
            async (input) => {
                await input.onCostIncurred(0.01);
                return transcriptArtifact("transcript", "hash");
            },
        );
        vi.mocked(getOrCreateTransliteration).mockRejectedValueOnce(
            new TransliterationFailedError("cut off", 0.004),
        );

        await executeRun("run-1");

        const [failed] = executionMocks.cells;
        expect(failed).toMatchObject({ status: "failed" });
        // The transcription plus the paid transliteration reply.
        expect(
            new PgDialect().sqlToQuery(failed!.incurredCostUsd).params,
        ).toEqual([0.014]);
    });

    it("redacts API keys from the persisted cell error", async () => {
        executionMocks.getOrCreateAudioTranscriptArtifact.mockImplementation(
            async (input) => {
                if (input.config?.diarization)
                    throw new Error(
                        "401 Incorrect API key provided: sk-proj-aaaaaaaaaaaaaaaa",
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
        expect(failed?.error).not.toContain("sk-proj-aaaaaaaaaaaaaaaa");
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

    function paidJudgeCosts() {
        return (
            executionMocks.recordJudgeCost.mock.calls as unknown as Array<
                [unknown, string, number | undefined]
            >
        )
            .filter(([, , cost]) => cost !== undefined)
            .map(([, cellId, cost]) => [cellId, cost]);
    }

    it("charges each variant's transcript judge call to its cell", async () => {
        executionMocks.recordJudgeCost.mockClear();
        executionMocks.getOrCreateAudioTranscriptArtifact.mockResolvedValue(
            transcriptArtifact("hello", "config-hash"),
        );
        executionMocks.runTranscriptEvaluator.mockResolvedValue({
            score: 1,
            details: { criteria: [] },
            rationale: "accurate",
            costUsd: 0.01,
        });

        await executeRun("run-1");

        expect(paidJudgeCosts().sort()).toEqual([
            ["cell-a", 0.01],
            ["cell-b", 0.01],
        ]);
    });

    it("charges a transcript judge shared by an item's cells once", async () => {
        executionMocks.recordJudgeCost.mockClear();
        executionMocks.recoverScoring = true;
        executionMocks.runModels = [
            runModel("rm-x", "openai/gpt-4o"),
            runModel("rm-y", "google/gemma-4"),
        ];
        executionMocks.cells = [
            {
                ...runCell("cell-x", "rm-x"),
                status: "succeeded",
                outputJson: { text: "x" },
            },
            {
                ...runCell("cell-y", "rm-y"),
                status: "succeeded",
                outputJson: { text: "y" },
            },
        ];
        const run = runWithVariants();
        executionMocks.run = {
            ...run,
            configSnapshot: {
                ...run.configSnapshot,
                sttConfig: run.configSnapshot.sttVariants.on.config,
            },
        };
        executionMocks.getOrCreateAudioTranscriptArtifact.mockResolvedValue(
            transcriptArtifact("hello", "config-hash"),
        );
        executionMocks.runTranscriptEvaluator.mockResolvedValue({
            score: 1,
            details: { criteria: [] },
            rationale: "accurate",
            costUsd: 0.01,
        });

        await executeRun("run-1");

        expect(executionMocks.runTranscriptEvaluator).toHaveBeenCalledOnce();
        expect(paidJudgeCosts()).toEqual([[expect.any(String), 0.01]]);
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

describe("executeRun benchmark comparison", () => {
    const taskMap = {
        tasks: [
            {
                key: "sales",
                name: "Sales call",
                method: "agreement" as const,
                fields: [{ path: "$.is_sales", matcher: "exact" as const }],
            },
        ],
    };

    beforeEach(() => {
        executionMocks.runModels = [
            {
                ...runModel("rm-bench", "anthropic/claude-sonnet-5.5"),
                isReference: true,
            },
            runModel("rm-cheap", "google/gemma-4"),
        ];
        executionMocks.items = [
            {
                id: "item-1",
                type: "text",
                inputText: "call one",
                storageKey: null,
            },
            {
                id: "item-2",
                type: "text",
                inputText: "call two",
                storageKey: null,
            },
        ];
        // Generation already happened; this exercises the scoring phase only.
        executionMocks.recoverScoring = true;
        executionMocks.cells = [
            {
                ...runCell("bench-1", "rm-bench"),
                status: "succeeded",
                outputJson: { is_sales: true },
            },
            {
                ...runCell("cheap-1", "rm-cheap"),
                status: "succeeded",
                outputJson: { is_sales: false },
            },
            {
                ...runCell("bench-2", "rm-bench"),
                datasetItemId: "item-2",
                status: "failed",
            },
            {
                ...runCell("cheap-2", "rm-cheap"),
                datasetItemId: "item-2",
                status: "succeeded",
                outputJson: { is_sales: true },
            },
        ];
        executionMocks.run = {
            id: "run-1",
            status: "pending",
            teamId: "team-1",
            datasetId: "dataset-1",
            pipelineId: null,
            judgeConfigId: null,
            judgePromptVersionId: null,
            configSnapshot: {
                maxTokens: 1024,
                fieldConfigs: [],
                models: [],
                benchmark: {
                    taskMap,
                    judge: {
                        modelId: "openai/gpt-5.5",
                        transport: "openrouter",
                    },
                },
            },
        };
        executionMocks.scoredCellIds.clear();
        executionMocks.benchmarkToRetry.clear();
        executionMocks.scoreInserts = [];
        executionMocks.existingScores = [];
        executionMocks.labels = new Map();
        executionMocks.runTranscriptEvaluator.mockReset();
        executionMocks.runTranscriptEvaluator.mockResolvedValue(undefined);
        executionMocks.scoreAgainstBenchmark.mockReset();
        executionMocks.scoreAgainstBenchmark.mockResolvedValue({
            score: 0,
            details: {
                tasks: [{ key: "sales", method: "agreement", agreement: 0 }],
            },
        });
    });

    it("scores non-benchmark cells against the benchmark output for the same item", async () => {
        await executeRun("run-1");

        // Only cheap-1: the benchmark cells are not compared with themselves,
        // and item-2 has no benchmark output to compare with.
        expect(executionMocks.scoreAgainstBenchmark).toHaveBeenCalledTimes(1);
        expect(
            executionMocks.scoreAgainstBenchmark.mock.calls[0]![0],
        ).toMatchObject({
            taskMap,
            candidate: { is_sales: false },
            benchmark: { is_sales: true },
            cellId: "cheap-1",
            inputText: "call one",
            judge: { modelId: "openai/gpt-5.5", transport: "openrouter" },
        });
        expect(
            executionMocks.scoreInserts.filter(
                (row) => row.scorerType === "benchmark",
            ),
        ).toEqual([
            {
                runCellId: "cheap-1",
                scorerType: "benchmark",
                score: 0,
                detailsJson: {
                    tasks: [
                        { key: "sales", method: "agreement", agreement: 0 },
                    ],
                },
                rationale: null,
            },
        ]);
    });

    it("adds the benchmark judge's cost to the cell it scored", async () => {
        executionMocks.recordJudgeCost.mockClear();
        executionMocks.scoreAgainstBenchmark.mockResolvedValue({
            score: 1,
            details: {
                tasks: [
                    {
                        key: "sales",
                        method: "head_to_head",
                        verdict: "win",
                        judgeCostUsd: 0.004,
                    },
                    {
                        key: "tone",
                        method: "rubric",
                        agreement: 1,
                        judgeCostUsd: 0.006,
                    },
                ],
            },
            judgeCostUsd: 0.01,
        });

        await executeRun("run-1");

        const paid = (
            executionMocks.recordJudgeCost.mock.calls as unknown as Array<
                [unknown, string, number | undefined]
            >
        ).filter(([, , cost]) => cost !== undefined);
        expect(paid).toHaveLength(1);
        expect(paid[0]![1]).toBe("cheap-1");
        expect(paid[0]![2]).toBeCloseTo(0.01);
    });

    it("scores a cell again when its judge failed, keeping the earlier details", async () => {
        const earlier = {
            tasks: [{ key: "sales", method: "agreement", error: "402 budget" }],
        };
        executionMocks.scoredCellIds.add("cheap-1").add("cheap-2");
        executionMocks.benchmarkToRetry.set("cheap-1", earlier);

        await executeRun("run-1");

        // cheap-2 was judged without errors, so it is left alone.
        expect(executionMocks.scoreAgainstBenchmark).toHaveBeenCalledTimes(1);
        expect(
            executionMocks.scoreAgainstBenchmark.mock.calls[0]![0],
        ).toMatchObject({ cellId: "cheap-1", previous: earlier });
    });

    it("keeps the answer and the judge spend when scoring crashes", async () => {
        executionMocks.recordJudgeCost.mockClear();
        vi.mocked(scoreOutput).mockImplementation(async (args) =>
            (args.output as { is_sales?: boolean } | null)?.is_sales === false
                ? { judge: { score: 1, rationale: "fine", costUsd: 0.02 } }
                : {},
        );
        executionMocks.scoreAgainstBenchmark.mockRejectedValueOnce(
            new Error("benchmark scorer crashed"),
        );

        await executeRun("run-1");

        const cheap = executionMocks.cells.find(
            (cell) => cell.id === "cheap-1",
        );
        expect(cheap).toMatchObject({
            status: "succeeded",
            outputJson: { is_sales: false },
            error: "scoring failed: benchmark scorer crashed",
        });
        const paid = (
            executionMocks.recordJudgeCost.mock.calls as unknown as Array<
                [unknown, string, number | undefined]
            >
        ).filter(([, , cost]) => cost !== undefined);
        expect(paid).toEqual([[expect.anything(), "cheap-1", 0.02]]);
        // Not a model failure, but not fully scored either.
        expect(executionMocks.runStatus).toBe("partial");
        vi.mocked(scoreOutput).mockResolvedValue({});
    });

    it("scores an answer whose scoring crashed again, without generating it", async () => {
        executionMocks.scoredCellIds.add("cheap-1").add("cheap-2");
        executionMocks.cells[1]!.error = "scoring failed: earlier crash";
        executionMocks.executeCell.mockClear();

        await executeRun("run-1");

        expect(executionMocks.executeCell).not.toHaveBeenCalled();
        expect(
            executionMocks.scoreAgainstBenchmark.mock.calls.map(
                ([args]) => args.cellId,
            ),
        ).toEqual(["cheap-1"]);
        expect(executionMocks.cells[1]!.error).toBeNull();
    });

    describe("retrying failed benchmark tasks", () => {
        const judgePrompt = {
            modelId: "openai/gpt-5.5",
            rubricPrompt: "Rate it.",
            declaredInputs: [],
        };
        const judgeRow = (score: number | null) => ({
            runCellId: "cheap-1",
            scorerType: "judge",
            score,
            detailsJson: null,
            rationale: score === null ? "judge error: 429" : "good",
        });

        beforeEach(() => {
            executionMocks.run.judgePromptVersionId = "judge-pv-1";
            vi.mocked(getJudgePromptVersion).mockResolvedValue(
                judgePrompt as never,
            );
            vi.mocked(scoreOutput).mockClear();
            executionMocks.scoredCellIds
                .add("bench-1")
                .add("cheap-1")
                .add("cheap-2");
            executionMocks.benchmarkToRetry.set("cheap-1", {
                tasks: [{ key: "sales", method: "agreement", error: "402" }],
            });
        });

        it("keeps a judge verdict that succeeded instead of paying for it again", async () => {
            executionMocks.existingScores = [judgeRow(0.8)];

            await executeRun("run-1");

            expect(vi.mocked(scoreOutput)).toHaveBeenCalledOnce();
            expect(
                vi.mocked(scoreOutput).mock.calls[0]![0].judgePrompt,
            ).toBeUndefined();
            expect(
                executionMocks.scoreInserts.filter(
                    (row) => row.scorerType === "judge",
                ),
            ).toEqual([
                {
                    runCellId: "cheap-1",
                    scorerType: "judge",
                    score: 0.8,
                    detailsJson: null,
                    rationale: "good",
                },
            ]);
        });

        it("asks a judge that failed again", async () => {
            executionMocks.existingScores = [judgeRow(null)];

            await executeRun("run-1");

            expect(
                vi.mocked(scoreOutput).mock.calls[0]![0].judgePrompt,
            ).toMatchObject({ rubricPrompt: "Rate it." });
        });
    });

    describe("keeping paid judge verdicts", () => {
        const judgeRow = {
            runCellId: "cheap-1",
            scorerType: "judge",
            score: 0.8,
            detailsJson: null,
            rationale: "good",
        };

        beforeEach(() => {
            executionMocks.run.judgePromptVersionId = "judge-pv-1";
            vi.mocked(getJudgePromptVersion).mockResolvedValue({
                modelId: "openai/gpt-5.5",
                rubricPrompt: "Rate it.",
                declaredInputs: [],
            } as never);
            vi.mocked(scoreOutput).mockClear();
            executionMocks.scoredCellIds.add("bench-1").add("cheap-1");
        });

        it("keeps a verdict when scoring crashed, instead of paying again", async () => {
            executionMocks.cells[1]!.error = "scoring failed: earlier crash";
            executionMocks.existingScores = [judgeRow];

            await executeRun("run-1");

            const calls = vi.mocked(scoreOutput).mock.calls;
            const cheap = calls.find(
                ([args]) =>
                    (args.output as { is_sales?: boolean }).is_sales === false,
            );
            expect(cheap![0].judgePrompt).toBeUndefined();
            expect(executionMocks.scoreInserts).toContainEqual(judgeRow);
        });

        it("asks again when the reference answer was regenerated", async () => {
            executionMocks.recoverScoring = false;
            executionMocks.existingScores = [judgeRow];
            executionMocks.executeCell.mockResolvedValue({
                outputText: "",
                parsed: { is_sales: true },
                schemaViolation: false,
                usage: { promptTokens: 1, completionTokens: 1 },
                latencyMs: 1,
                costSource: "unavailable",
            });

            for (const rm of executionMocks.runModels)
                rm.promptVersionId = "pv-1";

            await executeRun("run-1");

            const calls = vi.mocked(scoreOutput).mock.calls;
            expect(calls.length).toBeGreaterThan(0);
            for (const [args] of calls)
                expect(args.judgePrompt).toMatchObject({
                    rubricPrompt: "Rate it.",
                });
        });

        it("saves a verdict paid before a later scoring step crashed", async () => {
            vi.mocked(scoreOutput).mockImplementation(async (args) =>
                (args.output as { is_sales?: boolean } | null)?.is_sales ===
                false
                    ? { judge: { score: 1, rationale: "fine", costUsd: 0.02 } }
                    : {},
            );
            executionMocks.scoredCellIds.clear();
            executionMocks.scoreAgainstBenchmark.mockRejectedValueOnce(
                new Error("benchmark scorer crashed"),
            );

            await executeRun("run-1");
            vi.mocked(scoreOutput).mockResolvedValue({});

            expect(executionMocks.scoreInserts).toContainEqual({
                runCellId: "cheap-1",
                scorerType: "judge",
                score: 1,
                detailsJson: null,
                rationale: "fine",
            });
            expect(executionMocks.cells[1]!.error).toBe(
                "scoring failed: benchmark scorer crashed",
            );
        });
    });

    it("leaves fully judged cells alone on resume", async () => {
        executionMocks.scoredCellIds.add("cheap-1").add("cheap-2");

        await executeRun("run-1");

        expect(executionMocks.scoreAgainstBenchmark).not.toHaveBeenCalled();
    });

    it("applies the run's data rules to the benchmark judge", async () => {
        executionMocks.run.configSnapshot.dataPolicy = {
            onlyHosts: ["vertex"],
            zeroDataRetention: true,
        };
        await executeRun("run-1");
        expect(
            executionMocks.scoreAgainstBenchmark.mock.calls[0]![0].judge,
        ).toMatchObject({
            modelId: "openai/gpt-5.5",
            transport: "openrouter",
            dataPolicy: { onlyHosts: ["vertex"], zeroDataRetention: true },
        });
    });

    it("scores the reference model on tasks that use stored answers", async () => {
        const mixed = {
            tasks: [
                ...taskMap.tasks,
                {
                    key: "label",
                    name: "Checked label",
                    method: "agreement" as const,
                    fields: [{ path: "$.is_sales", matcher: "exact" as const }],
                    source: "labels" as const,
                },
            ],
        };
        executionMocks.run.configSnapshot.benchmark.taskMap = mixed;
        executionMocks.labels = new Map([["item-1", { is_sales: true }]]);
        executionMocks.scoreAgainstBenchmark.mockImplementation(
            async (args: { benchmark?: unknown; storedAnswer?: unknown }) => ({
                score: 1,
                details: {
                    tasks: [
                        ...(args.benchmark !== undefined
                            ? [{ key: "sales", method: "agreement" }]
                            : []),
                        ...(args.storedAnswer !== undefined
                            ? [{ key: "label", method: "agreement" }]
                            : []),
                    ],
                },
            }),
        );
        await executeRun("run-1");

        const calls = executionMocks.scoreAgainstBenchmark.mock.calls.map(
            ([args]) => args,
        );
        // item-2 has neither a benchmark answer nor a stored one, so
        // cheap-2 is not compared at all.
        expect(calls).toHaveLength(2);
        expect(calls).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    cellId: "bench-1",
                    taskMap: mixed,
                    storedAnswer: { is_sales: true },
                    benchmark: undefined,
                }),
                expect.objectContaining({
                    cellId: "cheap-1",
                    benchmark: { is_sales: true },
                    storedAnswer: { is_sales: true },
                }),
            ]),
        );
        expect(
            executionMocks.scoreInserts
                .filter((row) => row.scorerType === "benchmark")
                .map((row) => row.runCellId)
                .sort(),
        ).toEqual(["bench-1", "cheap-1"]);
    });

    it("writes no benchmark score when no task applied to the cell", async () => {
        executionMocks.scoreAgainstBenchmark.mockResolvedValue({
            score: null,
            details: { tasks: [] },
        });
        await executeRun("run-1");
        expect(executionMocks.scoreAgainstBenchmark).toHaveBeenCalledTimes(1);
        expect(
            executionMocks.scoreInserts.some(
                (row) => row.scorerType === "benchmark",
            ),
        ).toBe(false);
    });

    it("writes no benchmark scores on runs without benchmark settings", async () => {
        delete executionMocks.run.configSnapshot.benchmark;
        await executeRun("run-1");
        expect(executionMocks.scoreAgainstBenchmark).not.toHaveBeenCalled();
        expect(
            executionMocks.scoreInserts.some(
                (row) => row.scorerType === "benchmark",
            ),
        ).toBe(false);
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
        status: "pending",
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
