import { describe, expect, it, vi } from "vitest";
import {
    parseModelCatalog,
    readCatalogSnapshot,
    mergeModelCatalogs,
    orderCatalogSnapshots,
    fetchModelCatalog,
    type ICatalogModel,
} from "./catalog.js";
import {
    createCatalogLoader,
    loadModelCatalog,
    refreshModelCatalog,
} from "./catalogStore.js";
import {
    installModelCatalogs,
    MODEL_REGISTRY,
    registryEntryFor,
    type IModelRegistryEntry,
} from "./registry.js";
import bundledCatalogs from "./catalog.snapshot.json" with { type: "json" };

const model: ICatalogModel = {
    id: "google/gemini-3.5-flash-lite",
    transport: "openrouter",
    name: "Gemini 3.5 Flash Lite",
    family: "gemini",
    reasoning: true,
    vision: true,
    structuredOutput: true,
};
const now = new Date("2026-10-14T00:00:00Z");
const catalog = {
    version: 1 as const,
    source: "openrouter" as const,
    fetchedAt: now.toISOString(),
    models: [model],
};
function officialModel(id = model.id) {
    return {
        id,
        name: model.name,
        architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
        },
        supported_parameters: ["response_format", "reasoning"],
        pricing: { prompt: "0.0000001", completion: "0.0000004" },
    };
}

describe("model catalogs", () => {
    it("normalizes provider IDs and per-token OpenRouter pricing", () => {
        expect(
            parseModelCatalog("openrouter", { data: [officialModel()] }, now)
                .models[0],
        ).toMatchObject({
            ...model,
            pricing: {
                promptPricePerToken: 0.0000001,
                completionPricePerToken: 0.0000004,
            },
        });
    });
    it("converts models.dev prices per million tokens, including free models", () => {
        const raw = {
            id: "new-model",
            name: "New",
            modalities: { input: ["text"], output: ["text"] },
            structured_output: true,
            cost: { input: 0, output: 2 },
        };
        const provider = { models: { "new-model": raw } };
        const result = parseModelCatalog(
            "models.dev",
            { openai: provider, openrouter: provider, vercel: provider },
            now,
        );
        expect(result.models).toHaveLength(3);
        expect(result.models[0]?.pricing).toEqual({
            promptPricePerToken: 0,
            completionPricePerToken: 0.000002,
        });
    });
    it("filters embeddings, speech and image generation out of text evals", () => {
        const data = [
            officialModel(),
            { ...officialModel("embed-v1"), type: "embedding" },
            {
                ...officialModel("image-v1"),
                architecture: {
                    input_modalities: ["text"],
                    output_modalities: ["image"],
                },
            },
            officialModel("whisper-large"),
        ];
        expect(
            parseModelCatalog("openrouter", { data }, now).models.map(
                (m) => m.id,
            ),
        ).toEqual([model.id]);
    });
    it.each([{}, { data: [] }, { data: [{ id: "broken" }] }])(
        "rejects unusable listings %j",
        (payload) => {
            expect(() =>
                parseModelCatalog("openrouter", payload, now),
            ).toThrow();
        },
    );
    it("validates persisted snapshots and refuses malformed pricing and reasoning levels", () => {
        expect(readCatalogSnapshot(catalog)).toEqual(catalog);
        expect(
            readCatalogSnapshot({
                ...catalog,
                models: [
                    {
                        ...model,
                        pricing: {
                            promptPricePerToken: "0.1",
                            completionPricePerToken: 0,
                        },
                    },
                ],
            }),
        ).toBeUndefined();
        expect(
            readCatalogSnapshot({
                ...catalog,
                models: [
                    {
                        ...model,
                        reasoningEffort: {
                            supportedLevels: ["made-up"],
                            defaultLevel: "made-up",
                        },
                    },
                ],
            }),
        ).toBeUndefined();
    });
    it("adds a model without code changes and merges provider-specific prices", () => {
        const gateway = {
            ...catalog,
            source: "gateway" as const,
            models: [
                {
                    ...model,
                    transport: "gateway" as const,
                    pricing: {
                        promptPricePerToken: 0.1,
                        completionPricePerToken: 0.2,
                    },
                },
            ],
        };
        const openrouter = {
            ...catalog,
            models: [
                {
                    ...model,
                    pricing: {
                        promptPricePerToken: 0.3,
                        completionPricePerToken: 0.4,
                    },
                },
            ],
        };
        const entries = mergeModelCatalogs([], [gateway, openrouter]);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            id: model.id,
            transports: { gateway: model.id, openrouter: model.id },
            pricingByTransport: {
                gateway: gateway.models[0]?.pricing,
                openrouter: openrouter.models[0]?.pricing,
            },
        });
    });
    it("keeps existing canonical IDs and reasoning defaults", () => {
        const previous = mergeModelCatalogs(
            [],
            [
                {
                    ...catalog,
                    models: [
                        {
                            ...model,
                            id: "openai/gpt-fixture",
                            family: "gpt",
                            transport: "openrouter",
                            reasoningEffort: {
                                supportedLevels: ["low", "high"],
                                defaultLevel: "high",
                            },
                        },
                    ],
                },
            ],
        );
        const updated = mergeModelCatalogs(previous, [
            {
                ...catalog,
                models: [
                    {
                        ...model,
                        id: "openai/gpt-fixture",
                        family: "gpt",
                        reasoningEffort: {
                            supportedLevels: ["low"],
                            defaultLevel: "low",
                        },
                    },
                ],
            },
        ]);
        expect(updated[0]?.id).toBe("gpt-fixture");
        expect(updated[0]?.reasoningEffort?.defaultLevel).toBe("high");
    });
    it("keeps hand-set capability flags on static entries", () => {
        const pinned: IModelRegistryEntry = {
            id: model.id,
            gatewayModelId: model.id,
            label: "Pinned label",
            family: "gemini",
            provider: "google",
            providerLabel: "Gemini",
            reasoning: false,
            vision: false,
            structuredOutput: true,
            judgeSuitable: true,
            supportsOpenAI: false,
            supportsGateway: true,
            transports: { gateway: model.id },
            pricing: { promptPricePerToken: 1, completionPricePerToken: 2 },
        };
        const [entry] = mergeModelCatalogs(
            [pinned],
            [
                {
                    ...catalog,
                    models: [
                        {
                            ...model,
                            structuredOutput: false,
                            reasoningEffort: {
                                supportedLevels: ["low"],
                                defaultLevel: "low",
                            },
                            pricing: {
                                promptPricePerToken: 3,
                                completionPricePerToken: 4,
                            },
                        },
                    ],
                },
            ],
        );
        expect(entry).toMatchObject({
            label: "Pinned label",
            reasoning: false,
            vision: false,
            structuredOutput: true,
            judgeSuitable: true,
            pricing: pinned.pricing,
            transports: { gateway: model.id, openrouter: model.id },
            pricingByTransport: {
                openrouter: {
                    promptPricePerToken: 3,
                    completionPricePerToken: 4,
                },
            },
        });
        expect(entry?.reasoningEffort).toBeUndefined();
    });
    it("keeps reasoning effort when a later source lacks reasoning data", () => {
        const effort = {
            supportedLevels: ["low", "high"] as const,
            defaultLevel: "high" as const,
        };
        const [entry] = mergeModelCatalogs(
            [],
            [
                {
                    ...catalog,
                    source: "models.dev",
                    models: [{ ...model, reasoningEffort: effort }],
                },
                { ...catalog, models: [{ ...model, reasoning: false }] },
            ],
        );
        expect(entry?.reasoning).toBe(true);
        expect(entry?.reasoningEffort).toEqual(effort);
    });
    it("re-installing the bundled snapshots leaves the registry unchanged", () => {
        const before = JSON.stringify(MODEL_REGISTRY);
        const snapshots = bundledCatalogs.flatMap((value) => {
            const snapshot = readCatalogSnapshot(value);
            return snapshot
                ? [{ ...snapshot, fetchedAt: "2029-01-01T00:00:00Z" }]
                : [];
        });
        installModelCatalogs([...snapshots].reverse());
        expect(JSON.stringify(MODEL_REGISTRY)).toBe(before);
        expect(
            orderCatalogSnapshots(snapshots).map((snapshot) => snapshot.source),
        ).toEqual(["models.dev", "openrouter", "gateway"]);
    });
    it("fails closed on HTTP errors", async () => {
        const fetcher = vi.fn(
            async () => new Response("down", { status: 503 }),
        );
        await expect(fetchModelCatalog("openrouter", fetcher)).rejects.toThrow(
            "503",
        );
    });
});

describe("catalog persistence", () => {
    it("loads new database models into the active registry", async () => {
        const snapshot = {
            ...catalog,
            fetchedAt: "2030-01-01T00:00:00Z",
            models: [{ ...model, id: "fixture/new-catalog-model" }],
        };
        await loadModelCatalog({
            read: async () => [snapshot],
            write: async () => undefined,
        });
        expect(registryEntryFor("fixture/new-catalog-model")).toMatchObject({
            transports: { openrouter: "fixture/new-catalog-model" },
            structuredOutput: true,
        });
    });
    it("does not overwrite last good data when sources fail", async () => {
        const write = vi.fn(async () => undefined);
        const store = { read: vi.fn(async () => [catalog]), write };
        const result = await refreshModelCatalog(
            store,
            vi.fn(async () => new Response("{}")),
        );
        expect(result.every((source) => !source.ok)).toBe(true);
        expect(write).not.toHaveBeenCalled();
    });
    it("refreshes healthy sources independently and retains failed sources", async () => {
        const write = vi.fn(async () => undefined);
        const result = await refreshModelCatalog(
            { read: async () => [], write },
            vi.fn(async (url) =>
                String(url).includes("openrouter.ai")
                    ? Response.json({ data: [officialModel()] })
                    : new Response("down", { status: 503 }),
            ),
        );
        expect(
            result.find((source) => source.source === "openrouter")?.ok,
        ).toBe(true);
        expect(write).toHaveBeenCalledTimes(1);
    });
    it("coalesces concurrent reads and retains the fallback during DB outages", async () => {
        const read = vi.fn(async () => {
            throw new Error("database unavailable");
        });
        const load = createCatalogLoader({
            read,
            write: async () => undefined,
        });
        await Promise.all([load(), load(), load()]);
        await load();
        expect(read).toHaveBeenCalledTimes(1);
    });
    it("reloads in the background after the first load", async () => {
        let release!: () => void;
        const read = vi
            .fn<() => Promise<unknown[]>>()
            .mockResolvedValueOnce([])
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        release = () => resolve([]);
                    }),
            );
        const load = createCatalogLoader(
            { read, write: async () => undefined },
            0,
        );
        await load();
        await new Promise((resolve) => setTimeout(resolve, 1));
        // The second read never settles until released, yet the caller is not blocked.
        await load();
        expect(read).toHaveBeenCalledTimes(2);
        release();
    });
});
