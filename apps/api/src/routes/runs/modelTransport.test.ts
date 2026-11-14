import { describe, expect, it } from "vitest";
import { assertModelMapsToTransport } from "./modelTransport.js";

describe("assertModelMapsToTransport", () => {
    it("accepts a model named by another provider's id when the app knows the mapping", () => {
        // OpenRouter's id; the gateway call is sent as "zai/glm-5.2".
        expect(() =>
            assertModelMapsToTransport("z-ai/glm-5.2", "gateway"),
        ).not.toThrow();
        expect(() =>
            assertModelMapsToTransport("zai/glm-5.2", "openrouter"),
        ).not.toThrow();
    });

    it("rejects a known model on a provider the app has no id for, naming where it is", () => {
        expect(() =>
            assertModelMapsToTransport("openrouter/z-ai/glm-5.2", "gateway", {
                allowUnlistedGateway: true,
            }),
        ).toThrow(
            "Model \"openrouter/z-ai/glm-5.2\" can't be sent through Vercel AI Gateway: the app doesn't know its Vercel AI Gateway model id. It is available through Bifrost.",
        );
    });

    it("lets a run model the registry doesn't know go to the gateway under its own id", () => {
        expect(() =>
            assertModelMapsToTransport("unknown-vendor/model-x", "gateway", {
                allowUnlistedGateway: true,
            }),
        ).not.toThrow();
        // A bare id is never a gateway id.
        expect(() =>
            assertModelMapsToTransport("model-x", "gateway", {
                allowUnlistedGateway: true,
            }),
        ).toThrow("Choose a model from that provider's list");
    });

    it("takes the Bifrost id picked from Bifrost's list for a registry model without one", () => {
        // The registry carries no Bifrost id for this model; Bifrost's list does.
        expect(() =>
            assertModelMapsToTransport(
                "anthropic/claude-sonnet-5.5",
                "bifrost",
            ),
        ).toThrow("the app doesn't know its Bifrost model id");
        expect(() =>
            assertModelMapsToTransport(
                "anthropic/claude-sonnet-5.5",
                "bifrost",
                { transportModelId: "openrouter/anthropic/claude-sonnet-5.5" },
            ),
        ).not.toThrow();
    });

    it("never lets a judge through without a mapping", () => {
        expect(() =>
            assertModelMapsToTransport("unknown-vendor/model-x", "gateway", {
                prefix: "benchmark: ",
            }),
        ).toThrow(
            'benchmark: Model "unknown-vendor/model-x" can\'t be sent through Vercel AI Gateway',
        );
    });
});
