import { describe, expect, it, vi } from "vitest";
import { GatewayEvalProvider } from "./gateway.js";

describe("Gateway route forwarding", () => {
    it("preserves legacy retries by default and honors workflow explicit zero", async () => {
        const generate = vi.fn().mockResolvedValue({
            text: "ok",
            output: undefined,
            usage: {
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
                inputTokenDetails: {},
                outputTokenDetails: {},
            },
        });
        const provider = new GatewayEvalProvider("secret", {
            generateText: generate,
            modelFor: () => ({}) as never,
        });
        const request = {
            model: "gpt-4o",
            prompt: "hi",
            maxTokens: 10,
        };

        await provider.complete(request);
        await provider.complete({ ...request, maxRetries: 0 });

        expect(generate.mock.calls[0]?.[0]).toMatchObject({ maxRetries: 2 });
        expect(generate.mock.calls[1]?.[0]).toMatchObject({ maxRetries: 0 });
    });
});
