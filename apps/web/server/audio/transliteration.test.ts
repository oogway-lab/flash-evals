import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@flash-evals/llm-core";
import { getEvalProvider } from "@flash-evals/llm-core";

const mocks = vi.hoisted(() => ({
    cachedRows: [] as Array<{
        transcript: string;
        providerMetadata?: Record<string, unknown> | null;
    }>,
    selectError: undefined as Error | undefined,
    complete: vi.fn(),
    onConflictDoUpdate: vi.fn(async () => undefined),
    insertValues: vi.fn(),
}));

vi.mock("@flash-evals/llm-core", async (importActual) => {
    const actual = await importActual<typeof LlmCore>();
    return {
        ...actual,
        getEvalProvider: vi.fn(() => ({ complete: mocks.complete })),
    };
});

vi.mock("../llm/pricing", () => ({
    resolvePricingFor: vi.fn(async () => ({
        promptPricePerToken: 0.000001,
        completionPricePerToken: 0.000002,
    })),
}));

vi.mock("../db/client", () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn(async () => {
                        if (mocks.selectError) throw mocks.selectError;
                        return mocks.cachedRows;
                    }),
                })),
            })),
        })),
        insert: vi.fn(() => ({
            values: mocks.insertValues,
        })),
    },
}));

import {
    bifrostModelIdFor,
    bifrostModelListKeyFor,
    installBifrostModelInfo,
} from "@flash-evals/llm-core";
import {
    getOrCreateTransliteration,
    transliterationFailureCostUsd,
    transliterationMaxTokens,
} from "./transliteration";
import { sttCellCostWithTransliteration } from "./transliterationCost";

beforeEach(() => {
    mocks.cachedRows = [];
    mocks.selectError = undefined;
    mocks.complete.mockReset();
    mocks.onConflictDoUpdate.mockClear();
    mocks.insertValues.mockReset();
    mocks.insertValues.mockReturnValue({
        onConflictDoUpdate: mocks.onConflictDoUpdate,
    });
});

describe("getOrCreateTransliteration", () => {
    it("returns a cached Latin transcript without calling the model", async () => {
        mocks.cachedRows = [
            {
                transcript: "kya haal hai",
                providerMetadata: { costUsd: 0.002, costSource: "computed" },
            },
        ];

        await expect(
            getOrCreateTransliteration({
                datasetItemId: "item-1",
                storageKey: "audio/key.webm",
                sourceTranscript: "क्या हाल है",
                config: {
                    enabled: true,
                    targetScript: "latin",
                    modelId: "gpt-4o-mini",
                },
                apiKeys: { openai: "sk-test" },
            }),
        ).resolves.toEqual({
            text: "kya haal hai",
            costUsd: 0.002,
            incurredCostUsd: 0,
            cacheHit: true,
        });

        expect(mocks.complete).not.toHaveBeenCalled();
    });

    it("makes again a variant saved before the cut-off check", async () => {
        // Legacy rows carry no costSource; they may have been cut off.
        mocks.cachedRows = [
            { transcript: "kya haal", providerMetadata: { costUsd: 0.002 } },
        ];
        mocks.complete.mockResolvedValue({
            text: "kya haal hai",
            usage: {},
            latencyMs: 100,
        });

        const result = await getOrCreateTransliteration({
            datasetItemId: "item-1",
            storageKey: "audio/key.webm",
            sourceTranscript: "क्या हाल है",
            config: {
                enabled: true,
                targetScript: "latin",
                modelId: "gpt-4o-mini",
            },
            apiKeys: { openai: "sk-test" },
        });

        expect(mocks.complete).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            text: "kya haal hai",
            cacheHit: false,
        });
        expect(mocks.onConflictDoUpdate).toHaveBeenCalled();
    });

    it("transliterates and caches a source transcript variant", async () => {
        mocks.complete.mockResolvedValue({
            text: " kya haal hai ",
            usage: {},
            latencyMs: 100,
        });

        await expect(
            getOrCreateTransliteration({
                datasetItemId: "item-1",
                storageKey: "audio/key.webm",
                sourceTranscript: "क्या हाल है",
                config: {
                    enabled: true,
                    targetScript: "latin",
                    targetLanguage: "hi-Latn",
                    modelId: "gpt-4o-mini",
                    prompt: "Keep English words as English.",
                    temperature: 0,
                },
                apiKeys: { openai: "sk-test" },
            }),
        ).resolves.toMatchObject({ text: "kya haal hai", cacheHit: false });

        // No provider mode in the config: the call uses "auto", as the
        // cached variant records, never FLASH_EVALS_LLM_PROVIDER.
        expect(getEvalProvider).toHaveBeenLastCalledWith(
            { openai: "sk-test" },
            { provider: "auto" },
        );
        expect(mocks.complete).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "gpt-4o-mini",
                system: "Keep English words as English.",
                prompt: expect.stringContaining(
                    "<transcript>\nक्या हाल है\n</transcript>",
                ),
                maxTokens: 4_000,
                temperature: 0,
            }),
        );
        expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                datasetItemId: "item-1",
                storageKey: "audio/key.webm",
                sourceTranscriptHash: expect.any(String),
                variantKind: "latin_transliteration",
                targetScript: "latin",
                targetLanguage: "hi-Latn",
                modelId: "gpt-4o-mini",
                promptHash: expect.any(String),
                prompt: "Keep English words as English.",
                transcript: "kya haal hai",
                providerMetadata: expect.objectContaining({
                    providerMode: "auto",
                }),
                status: "completed",
                error: null,
            }),
        );
        expect(mocks.onConflictDoUpdate).toHaveBeenCalled();
    });

    it("fails before provider execution when the variant schema is missing", async () => {
        mocks.selectError = Object.assign(new Error("relation missing"), {
            code: "42P01",
        });
        mocks.complete.mockResolvedValue({
            text: " kya haal hai ",
            usage: {},
            latencyMs: 100,
        });

        await expect(
            getOrCreateTransliteration({
                datasetItemId: "item-1",
                storageKey: "audio/key.webm",
                sourceTranscript: "क्या हाल है",
                config: {
                    enabled: true,
                    targetScript: "latin",
                    modelId: "gpt-4o-mini",
                },
                apiKeys: { openai: "sk-test" },
            }),
        ).rejects.toThrow("relation missing");

        expect(mocks.complete).not.toHaveBeenCalled();
    });

    it("fails when a completed transliteration cannot be persisted", async () => {
        mocks.onConflictDoUpdate.mockRejectedValueOnce(
            Object.assign(new Error("relation missing"), { code: "42P01" }),
        );
        mocks.complete.mockResolvedValue({
            text: " kya haal hai ",
            usage: {},
            latencyMs: 100,
        });

        await expect(
            getOrCreateTransliteration({
                datasetItemId: "item-1",
                storageKey: "audio/key.webm",
                sourceTranscript: "क्या हाल है",
                config: {
                    enabled: true,
                    targetScript: "latin",
                    modelId: "gpt-4o-mini",
                },
                apiKeys: { openai: "sk-test" },
            }),
        ).rejects.toThrow("relation missing");
    });

    it("uses the provider identity captured in the transliteration config", async () => {
        mocks.complete.mockResolvedValue({
            text: " kya haal hai ",
            usage: {},
            latencyMs: 100,
        });
        const apiKeys = {
            openrouter: "or-test",
            openrouterBaseUrl: "https://openrouter.example.test/api/v1/",
        };

        await getOrCreateTransliteration({
            datasetItemId: "item-1",
            storageKey: "audio/key.webm",
            sourceTranscript: "क्या हाल है",
            config: {
                enabled: true,
                targetScript: "latin",
                modelId: "google/gemini-2.5-flash",
                providerMode: "openrouter",
                providerBaseUrl: "https://openrouter.example.test/api/v1",
            },
            apiKeys,
        });

        expect(getEvalProvider).toHaveBeenCalledWith(apiKeys, {
            provider: "openrouter",
        });
        expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                providerMetadata: expect.objectContaining({
                    providerMode: "openrouter",
                    providerBaseUrl: "https://openrouter.example.test/api/v1",
                }),
            }),
        );
    });

    it("never sends the key to a recorded address other than its own", async () => {
        await expect(
            getOrCreateTransliteration({
                datasetItemId: "item-1",
                storageKey: "audio/key.webm",
                sourceTranscript: "क्या हाल है",
                config: {
                    enabled: true,
                    targetScript: "latin",
                    modelId: "google/gemini-2.5-flash",
                    providerMode: "openrouter",
                    // The operator's .env address, recorded at creation.
                    providerBaseUrl: "https://env-proxy.example.test/api/v1",
                },
                // The key now resolved goes with OpenRouter's own address.
                apiKeys: { openrouter: "or-team-key" },
            }),
        ).rejects.toThrow(/another OpenRouter address/);
        expect(mocks.complete).not.toHaveBeenCalled();
    });

    it("says why a recorded saved address can't be used now", async () => {
        const reason =
            "The saved provider base URL could not be resolved right now. Try again.";
        await expect(
            getOrCreateTransliteration({
                datasetItemId: "item-1",
                storageKey: "audio/key.webm",
                sourceTranscript: "क्या हाल है",
                config: {
                    enabled: true,
                    targetScript: "latin",
                    modelId: "google/gemini-2.5-flash",
                    providerMode: "openrouter",
                    providerBaseUrl: "https://team-proxy.example.test/api/v1",
                },
                // The saved URL failed its re-check: no key, a reason.
                apiKeys: { unusable: { openrouter: reason } },
            }),
        ).rejects.toThrow(reason);
        expect(mocks.complete).not.toHaveBeenCalled();
    });

    it("sends a gateway transliteration through the gateway key with no base URL", async () => {
        mocks.complete.mockResolvedValue({
            text: "kya haal hai",
            usage: {},
            latencyMs: 100,
        });
        const apiKeys = {
            gateway: "vck-test",
            bifrost: "bifrost-test",
            bifrostBaseUrl: "https://bifrost.example.test",
        };

        await getOrCreateTransliteration({
            datasetItemId: "item-1",
            storageKey: "audio/key.webm",
            sourceTranscript: "क्या हाल है",
            config: {
                enabled: true,
                targetScript: "latin",
                modelId: "google/gemini-3-flash",
                providerMode: "gateway",
            },
            apiKeys,
        });

        expect(getEvalProvider).toHaveBeenLastCalledWith(apiKeys, {
            provider: "gateway",
        });
        expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                providerMetadata: expect.objectContaining({
                    providerMode: "gateway",
                    providerBaseUrl: "",
                }),
            }),
        );
    });

    it("rejects invalid temperature before calling the provider", async () => {
        await expect(
            getOrCreateTransliteration({
                datasetItemId: "item-1",
                storageKey: "audio/key.webm",
                sourceTranscript: "क्या हाल है",
                config: {
                    enabled: true,
                    targetScript: "latin",
                    modelId: "gpt-4o-mini",
                    temperature: 3,
                },
                apiKeys: { openai: "sk-test" },
            }),
        ).rejects.toThrow(
            "Transliteration temperature must be a number between 0 and 2.",
        );

        expect(mocks.complete).not.toHaveBeenCalled();
        expect(mocks.insertValues).not.toHaveBeenCalled();
    });

    it("fails when the model returns empty text", async () => {
        mocks.complete.mockResolvedValue({
            text: "   ",
            usage: {},
            latencyMs: 100,
        });

        await expect(
            getOrCreateTransliteration({
                datasetItemId: "item-1",
                storageKey: "audio/key.webm",
                sourceTranscript: "क्या हाल है",
                config: {
                    enabled: true,
                    targetScript: "latin",
                    modelId: "gpt-4o-mini",
                },
                apiKeys: { openai: "sk-test" },
            }),
        ).rejects.toThrow("Transliteration returned empty text.");
        expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                transcript: "",
                status: "failed",
                error: "Transliteration returned empty text.",
            }),
        );
        expect(mocks.onConflictDoUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                set: expect.objectContaining({
                    transcript: "",
                    status: "failed",
                    error: "Transliteration returned empty text.",
                }),
            }),
        );
    });

    it("sizes the output limit from the transcript", () => {
        expect(transliterationMaxTokens("short")).toBe(4_000);
        expect(transliterationMaxTokens("a".repeat(9_000))).toBe(10_000);
        expect(transliterationMaxTokens("a".repeat(100_000))).toBe(16_000);
    });

    it("fails, without caching, when the reply reaches the output limit", async () => {
        const source = "क्या हाल है ".repeat(1_000);
        mocks.complete.mockResolvedValue({
            text: "kya haal hai (cut",
            usage: { completionTokens: transliterationMaxTokens(source) },
            latencyMs: 100,
        });

        await expect(
            getOrCreateTransliteration({
                datasetItemId: "item-1",
                storageKey: "audio/key.webm",
                sourceTranscript: source,
                config: {
                    enabled: true,
                    targetScript: "latin",
                    modelId: "gpt-4o-mini",
                },
                apiKeys: { openai: "sk-test" },
            }),
        ).rejects.toThrow(/output limit/);
        expect(mocks.complete).toHaveBeenCalledWith(
            expect.objectContaining({
                maxTokens: transliterationMaxTokens(source),
            }),
        );
        expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({ status: "failed" }),
        );
        expect(mocks.insertValues).not.toHaveBeenCalledWith(
            expect.objectContaining({ status: "completed" }),
        );
    });

    it("reports what a cut-off or empty reply cost before failing", async () => {
        const run = () =>
            getOrCreateTransliteration({
                datasetItemId: "item-1",
                storageKey: "audio/key.webm",
                sourceTranscript: "क्या हाल है",
                config: {
                    enabled: true,
                    targetScript: "latin",
                    modelId: "gpt-4o-mini",
                },
                apiKeys: { openai: "sk-test" },
            }).catch((error: unknown) => error);
        // 1,000 prompt + 4,000 completion tokens at the mocked prices.
        mocks.complete.mockResolvedValueOnce({
            text: "kya haal (cut",
            usage: { promptTokens: 1_000, completionTokens: 4_000 },
            latencyMs: 100,
        });
        const cut = await run();
        expect(String(cut)).toMatch(/output limit/);
        expect(transliterationFailureCostUsd(cut)).toBeCloseTo(0.009);
        mocks.complete.mockResolvedValueOnce({
            text: " ",
            usage: { promptTokens: 1_000, completionTokens: 1 },
            latencyMs: 100,
        });
        const empty = await run();
        expect(String(empty)).toMatch(/empty text/);
        expect(transliterationFailureCostUsd(empty)).toBeCloseTo(0.001002);
        expect(transliterationFailureCostUsd(new Error("x"))).toBeUndefined();
    });

    it("keeps the output limit within the model's own limit when known", async () => {
        expect(transliterationMaxTokens("a".repeat(9_000), 8_192)).toBe(8_192);
        expect(transliterationMaxTokens("short", 2_048)).toBe(2_048);
        expect(transliterationMaxTokens("short", undefined)).toBe(4_000);
        const apiKeys = {
            bifrost: "bf-test",
            bifrostBaseUrl: "https://bifrost.example.test",
        };
        installBifrostModelInfo(bifrostModelListKeyFor(apiKeys)!, [
            { id: bifrostModelIdFor("gpt-4o-mini"), maxOutputTokens: 2_048 },
        ]);
        mocks.complete.mockResolvedValueOnce({
            text: "kya haal hai",
            usage: { completionTokens: 5 },
            latencyMs: 100,
        });
        await getOrCreateTransliteration({
            datasetItemId: "item-1",
            storageKey: "audio/key.webm",
            sourceTranscript: "क्या हाल है",
            config: {
                enabled: true,
                targetScript: "latin",
                modelId: "gpt-4o-mini",
                providerMode: "bifrost",
                providerBaseUrl: "https://bifrost.example.test",
            },
            apiKeys,
        });
        expect(mocks.complete).toHaveBeenCalledWith(
            expect.objectContaining({ maxTokens: 2_048 }),
        );
    });

    it("records the call's cost and who served it", async () => {
        mocks.complete.mockResolvedValue({
            text: "kya haal hai",
            usage: { promptTokens: 10, completionTokens: 5 },
            latencyMs: 100,
            cost: { usd: 0.0031, source: "gateway" },
            providerMetadata: { servedBy: "vertex" },
        });

        await expect(
            getOrCreateTransliteration({
                datasetItemId: "item-1",
                storageKey: "audio/key.webm",
                sourceTranscript: "क्या हाल है",
                config: {
                    enabled: true,
                    targetScript: "latin",
                    modelId: "gpt-4o-mini",
                    providerMode: "gateway",
                },
                apiKeys: { gateway: "vck-test" },
            }),
        ).resolves.toEqual({
            text: "kya haal hai",
            costUsd: 0.0031,
            incurredCostUsd: 0.0031,
            cacheHit: false,
        });
        expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                providerMetadata: expect.objectContaining({
                    costUsd: 0.0031,
                    costSource: "computed",
                    servedBy: "vertex",
                }),
            }),
        );
    });

    it("does not reuse a long variant that the old 4,000-token limit may have cut", async () => {
        const hashFor = async (sourceTranscript: string) => {
            mocks.insertValues.mockClear();
            mocks.complete.mockResolvedValueOnce({
                text: "kya haal hai",
                usage: { completionTokens: 5 },
                latencyMs: 100,
            });
            await getOrCreateTransliteration({
                datasetItemId: "item-1",
                storageKey: "audio/key.webm",
                sourceTranscript,
                config: {
                    enabled: true,
                    targetScript: "latin",
                    modelId: "gpt-4o-mini",
                },
                apiKeys: { openai: "sk-test" },
            });
            return (
                mocks.insertValues.mock.calls[0]![0] as { promptHash: string }
            ).promptHash;
        };
        // The hash the identity had before the output limit was sized.
        const legacyHash = createHash("sha256")
            .update(
                JSON.stringify({
                    prompt: "Transliterate the transcript into Latin script. Keep existing English words as English. Preserve meaning, punctuation, numbers, and line breaks. Return only the transliterated transcript.",
                    providerMode: "auto",
                    providerBaseUrl: "",
                    temperature: null,
                }),
            )
            .digest("hex");
        expect(await hashFor("क्या हाल है")).toBe(legacyHash);
        expect(await hashFor("क".repeat(5_000))).not.toBe(legacyHash);
    });

    it("sends the run's data rules and keeps their variants apart", async () => {
        mocks.complete.mockResolvedValue({
            text: "kya haal hai",
            usage: {},
            latencyMs: 100,
        });
        const run = (dataPolicy?: { zeroDataRetention: boolean }) =>
            getOrCreateTransliteration({
                datasetItemId: "item-1",
                storageKey: "audio/key.webm",
                sourceTranscript: "क्या हाल है",
                config: {
                    enabled: true,
                    targetScript: "latin",
                    modelId: "gpt-4o-mini",
                    providerMode: "gateway",
                },
                apiKeys: { gateway: "vck-test" },
                ...(dataPolicy ? { dataPolicy } : {}),
            });

        await run();
        await run({ zeroDataRetention: true });

        expect(mocks.complete.mock.calls[0]![0]).not.toHaveProperty(
            "dataPolicy",
        );
        expect(mocks.complete.mock.calls[1]![0]).toMatchObject({
            dataPolicy: { zeroDataRetention: true },
        });
        const hashes = mocks.insertValues.mock.calls.map(
            (call) => (call[0] as { promptHash: string }).promptHash,
        );
        expect(hashes[0]).not.toBe(hashes[1]);
    });
});

describe("sttCellCostWithTransliteration", () => {
    it("adds the transliteration cost to the transcript cost", () => {
        expect(
            sttCellCostWithTransliteration(
                { costUsd: 0.01, costSource: "computed" },
                { costUsd: 0.002 },
            ),
        ).toEqual({ costUsd: 0.012, costSource: "computed" });
        expect(
            sttCellCostWithTransliteration(
                { costUsd: 0.01, costSource: "computed" },
                {},
            ),
        ).toEqual({ costSource: "unavailable" });
        expect(
            sttCellCostWithTransliteration(
                { costUsd: 0.01, costSource: "computed" },
                undefined,
            ),
        ).toEqual({ costUsd: 0.01, costSource: "computed" });
    });

    it("keeps a reused variant's unknown cost visible", () => {
        expect(
            sttCellCostWithTransliteration(
                { costUsd: 0.01, costSource: "computed" },
                { cacheHit: true } as { costUsd?: number },
            ),
        ).toEqual({ costSource: "unavailable" });
    });
});
