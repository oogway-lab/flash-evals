import { describe, expect, it } from "vitest";
import { guidanceForModel } from "./promptGuidance.js";

describe("guidanceForModel", () => {
    it("keeps GPT-5 family guidance for registered and matching variants", () => {
        expect(guidanceForModel("gpt-5.4-mini").source.title).toContain("GPT-5");
        expect(guidanceForModel("gpt-5.5-mini").source.title).toContain("GPT-5");
    });

    it("keeps GPT-4.1 family guidance", () => {
        expect(guidanceForModel("gpt-4.1-mini").source.title).toContain(
            "GPT-4.1",
        );
    });

    it("uses general OpenAI guidance for other OpenAI registry models", () => {
        const guidance = guidanceForModel("gpt-4o");

        expect(guidance.source.title).toContain("OpenAI prompt engineering");
        expect(guidance.source.url).toContain("platform.openai.com");
    });

    it("uses official Claude guidance for Anthropic models", () => {
        const guidance = guidanceForModel("anthropic/claude-sonnet-4.5");

        expect(guidance.source.title).toContain("Anthropic Claude");
        expect(guidance.source.url).toContain("platform.claude.com");
        expect(guidance.text).toContain("XML-style tags");
    });

    it("uses official Gemini guidance for Google models", () => {
        const guidance = guidanceForModel("google/gemini-3-pro-preview");

        expect(guidance.source.title).toContain("Gemini");
        expect(guidance.source.url).toContain("ai.google.dev");
        expect(guidance.text).toContain("specific instructions");
    });

    it("uses provider guidance for known provider-prefixed gateway IDs", () => {
        expect(guidanceForModel("openai/gpt-5.6-mini").source.title).toContain(
            "GPT-5",
        );
        expect(guidanceForModel("openai/gpt-4.1-future").source.title).toContain(
            "GPT-4.1",
        );
        expect(guidanceForModel("google/gemini-new").source.title).toContain(
            "Gemini",
        );
        expect(guidanceForModel("anthropic/claude-new").source.title).toContain(
            "Anthropic Claude",
        );
    });

    it("uses official Mistral guidance for Mistral models", () => {
        const guidance = guidanceForModel("mistral/mistral-large-3");

        expect(guidance.source.title).toContain("Mistral");
        expect(guidance.source.url).toContain("docs.mistral.ai");
        expect(guidance.text).toContain("clear hierarchy");
    });

    it("uses generic internal guidance for providers without verified guidance", () => {
        const guidance = guidanceForModel("meta/llama-4-maverick");

        expect(guidance.source.title).toBe(
            "Flash Evals generic prompt optimization guidance",
        );
        expect(guidance.source.url).toBe("internal://mosaic/prompt-optimization");
        expect(guidance.text).toContain("provider-neutral");
    });

    it("uses generic internal guidance for unknown model IDs", () => {
        const guidance = guidanceForModel("unknown/model");

        expect(guidance.source.title).toBe(
            "Flash Evals generic prompt optimization guidance",
        );
        expect(guidance.source.url).toBe("internal://mosaic/prompt-optimization");
    });
});
