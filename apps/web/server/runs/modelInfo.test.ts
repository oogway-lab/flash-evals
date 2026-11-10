import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/llm/catalog", () => ({
    ensureModelCatalog: vi.fn(async () => undefined),
}));
vi.mock("@/server/llm/modelRegistry", () => ({
    registryModelFor: (modelId: string) =>
        modelId === "known" || modelId === "openrouter/acme/known"
            ? {
                  label: "Known Model",
                  pricing: {
                      promptPricePerToken: 0.0000001,
                      completionPricePerToken: 0.0000005,
                  },
              }
            : modelId === "glm"
              ? {
                    label: "GLM 5.2",
                    pricing: {
                        promptPricePerToken: 0.0000008,
                        completionPricePerToken: 0.00000255,
                    },
                    pricingByTransport: {
                        gateway: {
                            promptPricePerToken: 0.0000008,
                            completionPricePerToken: 0.00000255,
                        },
                        openrouter: {
                            promptPricePerToken: 0.000000006,
                            completionPricePerToken: 0.0000068,
                        },
                    },
                }
              : modelId === "unpriced"
                ? { label: "Unpriced Model" }
                : undefined,
}));

import { modelInfoFor, runModelProviders } from "./modelInfo";

describe("modelInfoFor", () => {
    it("gives readable names and list prices per million tokens", async () => {
        const info = await modelInfoFor(["known", "unpriced", "mystery"]);
        expect(info.known?.label).toBe("Known Model");
        expect(info.known?.inputPerMillion).toBeCloseTo(0.1);
        expect(info.known?.outputPerMillion).toBeCloseTo(0.5);
        expect(info.unpriced).toEqual({ label: "Unpriced Model" });
        expect(info.mystery).toBeUndefined();
    });

    it("names a Bifrost id by the registry model behind it", async () => {
        const info = await modelInfoFor(["openrouter/acme/known"]);
        expect(info["openrouter/acme/known"]?.label).toBe("Known Model");
    });

    it("uses the price of the provider the run sent the model through", async () => {
        const info = await modelInfoFor(["glm"], { glm: "openrouter" });
        expect(info.glm?.provider).toBe("openrouter");
        expect(info.glm?.inputPerMillion).toBeCloseTo(0.006);
        expect(info.glm?.outputPerMillion).toBeCloseTo(6.8);
        const unknown = await modelInfoFor(["glm"], { glm: "bifrost" });
        expect(unknown.glm).toEqual({ label: "GLM 5.2", provider: "bifrost" });
    });

    it("reads each model's provider from a run's saved settings", () => {
        expect(
            runModelProviders({
                models: [
                    { modelId: "glm", transport: "openrouter" },
                    { modelId: "luna" },
                    { modelId: "odd", transport: "elsewhere" },
                    "junk",
                ],
            }),
        ).toEqual({ glm: "openrouter" });
        expect(runModelProviders({})).toEqual({});
    });
});
