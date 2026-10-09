import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@mosaic/llm-core";
import { getEvalProvider } from "@mosaic/llm-core";

const mocks = vi.hoisted(() => ({
    cachedRows: [] as Array<{ transcript: string }>,
    selectError: undefined as Error | undefined,
    complete: vi.fn(),
    onConflictDoUpdate: vi.fn(async () => undefined),
    insertValues: vi.fn(),
}));

vi.mock("@mosaic/llm-core", async (importActual) => {
    const actual = await importActual<typeof LlmCore>();
    return {
        ...actual,
        getEvalProvider: vi.fn(() => ({ complete: mocks.complete })),
    };
});

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

import { getOrCreateTransliteration } from "./transliteration";

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
        mocks.cachedRows = [{ transcript: "kya haal hai" }];

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
        ).resolves.toBe("kya haal hai");

        expect(mocks.complete).not.toHaveBeenCalled();
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
        ).resolves.toBe("kya haal hai");

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
            apiKeys: {
                openrouter: "or-test",
                openrouterBaseUrl: "https://stale.example.test/api/v1",
            },
        });

        expect(getEvalProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                openrouter: "or-test",
                openrouterBaseUrl: "https://openrouter.example.test/api/v1",
            }),
            { provider: "openrouter" },
        );
        expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                providerMetadata: expect.objectContaining({
                    providerMode: "openrouter",
                    providerBaseUrl: "https://openrouter.example.test/api/v1",
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
});
