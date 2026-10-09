import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@mosaic/llm-core";
import {
    listAvailableModelMetadata,
    providerModeFromEnv,
} from "@mosaic/llm-core";
import { MODEL_REGISTRY } from "./modelRegistry";
import { getAvailableModels, type IResolvedModel } from "./availableModels";

vi.mock("@mosaic/llm-core", async (importOriginal) => {
    const actual = await importOriginal<typeof LlmCore>();
    return {
        ...actual,
        listAvailableModelMetadata: vi.fn(),
        providerModeFromEnv: vi.fn(),
    };
});

const mockList = vi.mocked(listAvailableModelMetadata);
const mockProviderModeFromEnv = vi.mocked(providerModeFromEnv);
const ALL_IDS = MODEL_REGISTRY.map((e) => e.id);
const ALL_GATEWAY_IDS = MODEL_REGISTRY.map((e) => e.gatewayModelId);
const OPENAI_IDS = MODEL_REGISTRY.filter((e) => e.supportsOpenAI).map(
    (e) => e.id,
);

function find(
    models: IResolvedModel[],
    id: string,
): IResolvedModel | undefined {
    return models.find((m) => m.id === id);
}

let n = 0;
function freshKey() {
    n += 1;
    return { openai: `sk-test-${n}` };
}

beforeEach(() => {
    mockList.mockReset();
    mockProviderModeFromEnv.mockReset();
});

describe("getAvailableModels", () => {
    it("flags curated models available when the key returns them", async () => {
        mockList.mockResolvedValue([{ id: "gpt-4o" }, { id: "gpt-4o-mini" }]);

        const { models, degraded } = await getAvailableModels(freshKey());

        expect(degraded).toBe(false);
        expect(find(models, "gpt-4o")?.available).toBe(true);
        expect(find(models, "gpt-4o-mini")?.available).toBe(true);
        expect(find(models, "gpt-5.5")?.available).toBe(false);
        expect(models).toHaveLength(OPENAI_IDS.length);
        expect(mockList).toHaveBeenCalledWith(
            expect.objectContaining({ openai: expect.any(String) }),
            { provider: "openai" },
        );
    });

    it("marks everything available when the key returns a superset", async () => {
        mockList.mockResolvedValue([
            ...ALL_IDS.map((id) => ({ id })),
            { id: "some-other-model" },
        ]);

        const { models, degraded } = await getAvailableModels(freshKey());

        expect(degraded).toBe(false);
        expect(models.every((m) => m.available)).toBe(true);
    });

    it("resolves Gateway model ids when Gateway mode is active", async () => {
        mockProviderModeFromEnv.mockReturnValue("gateway");
        mockList.mockResolvedValue([
            { id: "openai/gpt-4o" },
            { id: "openai/gpt-4o-mini" },
        ]);

        const { models, degraded } = await getAvailableModels({
            gateway: "vck-test",
        });

        expect(degraded).toBe(false);
        expect(find(models, "gpt-4o")?.available).toBe(true);
        expect(find(models, "gpt-4o-mini")?.available).toBe(true);
        expect(find(models, "gpt-5.5")?.available).toBe(false);
        expect(mockList).toHaveBeenCalledWith(
            expect.objectContaining({ gateway: "vck-test" }),
            { provider: "gateway" },
        );
    });

    it("marks everything available when Gateway returns a mapped superset", async () => {
        mockProviderModeFromEnv.mockReturnValue("gateway");
        mockList.mockResolvedValue([
            ...ALL_GATEWAY_IDS.map((id) => ({ id })),
            { id: "anthropic/other" },
        ]);

        const { models, degraded } = await getAvailableModels({
            gateway: "vck-test-gateway-superset",
        });

        expect(degraded).toBe(false);
        expect(models.every((m) => m.available)).toBe(true);
    });

    it("includes live Gateway language models that are not in the curated registry", async () => {
        mockProviderModeFromEnv.mockReturnValue("gateway");
        mockList.mockResolvedValue([
            {
                id: "google/gemini-new-live",
                pricing: {
                    promptPricePerToken: 1 / 1_000_000,
                    completionPricePerToken: 2 / 1_000_000,
                },
            },
        ]);

        const { models, degraded } = await getAvailableModels({
            gateway: "vck-test-live-extra",
        });

        const live = find(models, "google/gemini-new-live");
        expect(degraded).toBe(false);
        expect(live).toMatchObject({
            id: "google/gemini-new-live",
            providerLabel: "Gemini",
            available: true,
            structuredOutput: true,
            judgeSuitable: true,
        });
        expect(live?.pricing?.promptPricePerToken).toBe(1 / 1_000_000);
    });

    it("uses the canonical OpenAI label for live Gateway OpenAI models", async () => {
        mockProviderModeFromEnv.mockReturnValue("gateway");
        mockList.mockResolvedValue([{ id: "openai/gpt-new-live" }]);

        const { models, degraded } = await getAvailableModels({
            gateway: "vck-test-live-openai",
        });

        expect(degraded).toBe(false);
        expect(find(models, "gpt-new-live")).toMatchObject({
            id: "gpt-new-live",
            providerLabel: "OpenAI",
            available: true,
            structuredOutput: true,
            judgeSuitable: true,
        });
    });

    it("marks curated models unavailable while retaining listed live models", async () => {
        mockList.mockResolvedValue([
            { id: "text-embedding-3-small" },
            { id: "whisper-1" },
        ]);

        const { models, degraded } = await getAvailableModels(freshKey());

        expect(degraded).toBe(false);
        expect(OPENAI_IDS.every((id) => !find(models, id)?.available)).toBe(
            true,
        );
        expect(find(models, "text-embedding-3-small")?.available).toBe(true);
        expect(find(models, "whisper-1")?.available).toBe(true);
    });

    it("degrades to the provider-scoped curated list when the API call fails", async () => {
        mockList.mockRejectedValue(new Error("network down"));

        const { models, degraded } = await getAvailableModels(freshKey());

        expect(degraded).toBe(true);
        expect(models).toHaveLength(OPENAI_IDS.length);
        expect(models.every((m) => m.available)).toBe(true);
    });

    it("throws when provider env parsing fails", async () => {
        mockProviderModeFromEnv.mockImplementation(() => {
            throw new Error("invalid provider");
        });

        await expect(getAvailableModels(freshKey())).rejects.toThrow(
            /invalid provider/,
        );

        expect(mockList).not.toHaveBeenCalled();
    });

    it("throws missing provider keys instead of marking every model available", async () => {
        mockProviderModeFromEnv.mockReturnValue("gateway");
        mockList.mockRejectedValue(
            new Error("Please add your AI Gateway API key to list models."),
        );

        await expect(getAvailableModels({})).rejects.toThrow(
            /AI Gateway API key/,
        );
    });

    it("orders available models before unavailable ones", async () => {
        mockList.mockResolvedValue([{ id: "gpt-5.4-nano" }]); // a single, alphabetically-late id

        const { models } = await getAvailableModels(freshKey());

        const firstUnavailable = models.findIndex((m) => !m.available);
        const lastAvailable = models.map((m) => m.available).lastIndexOf(true);
        expect(lastAvailable).toBeLessThan(firstUnavailable);
        expect(models[0]?.id).toBe("gpt-5.4-nano");
    });

    it("caches a successful resolution for the same key", async () => {
        mockList.mockResolvedValue([{ id: "gpt-4o" }]);
        const key = freshKey();

        await getAvailableModels(key);
        await getAvailableModels(key);

        expect(mockList).toHaveBeenCalledTimes(1);
    });

    it("does not cache the degraded fallback, so it self-heals", async () => {
        mockList
            .mockRejectedValueOnce(new Error("transient"))
            .mockResolvedValue([{ id: "gpt-4o" }]);
        const key = freshKey();

        const first = await getAvailableModels(key);
        const second = await getAvailableModels(key);

        expect(first.degraded).toBe(true);
        expect(second.degraded).toBe(false);
        expect(mockList).toHaveBeenCalledTimes(2);
    });

    it("overlays live Gateway pricing onto curated entries", async () => {
        mockProviderModeFromEnv.mockReturnValue("gateway");
        mockList.mockResolvedValue([
            {
                id: "anthropic/claude-sonnet-4.5",
                pricing: {
                    promptPricePerToken: 3 / 1_000_000,
                    completionPricePerToken: 15 / 1_000_000,
                },
            },
        ]);

        const { models } = await getAvailableModels({
            gateway: "vck-test-priced",
        });

        expect(
            find(models, "anthropic/claude-sonnet-4.5")?.pricing,
        ).toMatchObject({
            promptPricePerToken: 3 / 1_000_000,
            completionPricePerToken: 15 / 1_000_000,
        });
    });
});
