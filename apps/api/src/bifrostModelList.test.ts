import { afterEach, describe, expect, it, vi } from "vitest";
import { MODEL_REGISTRY } from "@flash-evals/llm-core";
import {
    bifrostIdsByRegistryModel,
    bifrostModelList,
    resetBifrostModelListCache,
    withListedBifrostId,
} from "./bifrostModelList.js";
import { availableModelOptions } from "./modelRegistry.js";

const keys = {
    bifrost: "bf-test",
    bifrostBaseUrl: "https://gateway.example.test",
};

afterEach(() => resetBifrostModelListCache());

describe("Bifrost model list", () => {
    it("is fetched once and reused", async () => {
        const list = vi.fn().mockResolvedValue([{ id: "openai/gpt-4o" }]);
        expect(await bifrostModelList(keys, { list })).toEqual({
            ids: ["openai/gpt-4o"],
        });
        await bifrostModelList(keys, { list });
        expect(list).toHaveBeenCalledTimes(1);
        expect(await bifrostModelList({}, { list })).toBeUndefined();
    });

    it("says plainly when the list can't be fetched, and retries later", async () => {
        let now = 0;
        const list = vi.fn().mockRejectedValue(new Error("connect refused"));
        const result = await bifrostModelList(keys, { list, now: () => now });
        expect(result).toEqual({
            error: "Bifrost is set up (gateway.example.test) but its model list couldn't be fetched (connect refused). No model is offered on Bifrost until it can be: check BIFROST_BASE_URL and the Bifrost key, then reload.",
        });
        now = 61_000;
        await bifrostModelList(keys, { list, now: () => now });
        expect(list).toHaveBeenCalledTimes(2);
    });

    it("offers each registry model under the id Bifrost lists for it", () => {
        const byModel = bifrostIdsByRegistryModel([
            "openrouter/openai/gpt-4o",
            "openai/gpt-4o",
            "openrouter/google/gemini-2.5-flash",
            "gemini/gemini-2.5-flash",
        ]);
        // The registry's own Bifrost id wins; else an openrouter/ id.
        expect(byModel.get("gpt-4o")).toBe("openai/gpt-4o");
        expect(byModel.get("google/gemini-2.5-flash")).toBe(
            "openrouter/google/gemini-2.5-flash",
        );
        const gpt = MODEL_REGISTRY.find((entry) => entry.id === "gpt-4o")!;
        const listed = withListedBifrostId(gpt, new Map());
        expect(listed.transports.bifrost).toBeUndefined();
    });

    it("lists models on Bifrost only under Bifrost's own ids", async () => {
        const { models } = await availableModelOptions(keys, {
            bifrostList: {
                list: vi
                    .fn()
                    .mockResolvedValue([
                        { id: "openrouter/google/gemini-2.5-flash" },
                    ]),
            },
        });
        const gemini = models.find(
            (model) => model.id === "google/gemini-2.5-flash",
        );
        expect(
            gemini?.providers?.find((offer) => offer.transport === "bifrost"),
        ).toMatchObject({
            modelId: "openrouter/google/gemini-2.5-flash",
            keySaved: true,
        });
        expect(gemini?.transports).toContain("bifrost");
        const gpt = models.find((model) => model.id === "gpt-4o");
        expect(gpt?.transports ?? []).not.toContain("bifrost");
    });

    it("prices a Bifrost offer at Bifrost's list price, before the registry's", async () => {
        const pricing = {
            promptPricePerToken: 0.0000006,
            completionPricePerToken: 0.0000022,
        };
        const list = vi
            .fn()
            .mockResolvedValue([
                { id: "openrouter/z-ai/glm-5.2", pricing },
                { id: "openai/gpt-4o" },
            ]);
        expect(await bifrostModelList(keys, { list })).toEqual({
            ids: ["openrouter/z-ai/glm-5.2", "openai/gpt-4o"],
            pricing: { "openrouter/z-ai/glm-5.2": pricing },
        });
        const { models } = await availableModelOptions(keys, {
            bifrostList: { list },
        });
        const offer = (id: string) =>
            models
                .find((model) => model.id === id)
                ?.providers?.find(
                    (candidate) => candidate.transport === "bifrost",
                );
        // The registry gives GLM 5.2 no price; Bifrost's list does.
        expect(offer("openrouter/z-ai/glm-5.2")).toMatchObject({
            modelId: "openrouter/z-ai/glm-5.2",
            inputPerMillion: 0.6,
            outputPerMillion: 2.2,
        });
        // Without a list price, the registry's list price stands.
        const gpt = MODEL_REGISTRY.find((entry) => entry.id === "gpt-4o")!;
        expect(offer("gpt-4o")?.inputPerMillion).toBeCloseTo(
            gpt.pricing!.promptPricePerToken * 1_000_000,
        );
    });

    it("offers nothing on Bifrost and reports why when its list fails", async () => {
        const result = await availableModelOptions(keys, {
            bifrostList: { list: vi.fn().mockRejectedValue(new Error("401")) },
        });
        expect(result.bifrostModelListError).toContain(
            "its model list couldn't be fetched (401)",
        );
        expect(
            result.models.some((model) => model.transports.includes("bifrost")),
        ).toBe(false);
    });
});
