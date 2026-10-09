import { describe, expect, it } from "vitest";
import { guidanceForModel, optimizePrompt } from "./optimizer";

describe("guidanceForModel", () => {
    it("uses GPT-5 guidance for GPT-5 family models", () => {
        const guidance = guidanceForModel("gpt-5.4-mini");

        expect(guidance.source.title).toContain("GPT-5");
        expect(guidance.text).toContain("JSON Schema");
    });

    it("uses GPT-5 guidance for unregistered GPT-5 variants", () => {
        const guidance = guidanceForModel("gpt-5.5-mini");

        expect(guidance.source.title).toContain("GPT-5");
    });

    it("uses GPT-4.1 guidance for GPT-4.1 family models", () => {
        const guidance = guidanceForModel("gpt-4.1-mini");

        expect(guidance.source.title).toContain("GPT-4.1");
    });

    it("uses provider-specific guidance for Claude, Gemini, and Mistral", () => {
        expect(guidanceForModel("anthropic/claude-sonnet-4.5").source.title)
            .toContain("Anthropic Claude");
        expect(guidanceForModel("google/gemini-3-pro-preview").source.title)
            .toContain("Gemini");
        expect(guidanceForModel("mistral/mistral-large-3").source.title)
            .toContain("Mistral");
    });

    it("uses generic guidance for providers without verified sources", () => {
        const guidance = guidanceForModel("meta/llama-4-maverick");

        expect(guidance.source.title).toBe(
            "Flash Evals generic prompt optimization guidance",
        );
        expect(guidance.source.url).toBe("internal://mosaic/prompt-optimization");
    });
});

describe("optimizePrompt", () => {
    it("delegates to an injected optimizer call", async () => {
        const result = await optimizePrompt({
            prompt: "extract food",
            schema: {
                type: "object",
                additionalProperties: false,
                required: ["dish"],
                properties: { dish: { type: "string" } },
            },
            targetModelId: "gpt-4o",
            apiKeys: { openai: "test" },
            callOptimizer: async (input) => ({
                proposedPrompt: `${input.prompt}\nReturn JSON only.`,
                rationale: input.guidance,
                fitTags: [input.targetModelId],
                structuredOutputNotes: ["Requires bare JSON output."],
                guidanceSource: guidanceForModel(input.targetModelId).source,
            }),
        });

        expect(result.proposedPrompt).toContain("Return JSON only");
        expect(result.fitTags).toEqual(["gpt-4o"]);
        expect(result.structuredOutputNotes).toEqual([
            "Requires bare JSON output.",
        ]);
    });
});
