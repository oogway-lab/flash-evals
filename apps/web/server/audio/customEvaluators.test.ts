import { describe, expect, it, vi } from "vitest";

vi.mock("../scoring/judge", () => ({
    runJudge: vi.fn(),
}));

import { runJudge } from "../scoring/judge";
import { runTranscriptEvaluator } from "./customEvaluators";

describe("runTranscriptEvaluator", () => {
    it("runs the transcript judge with reference label context", async () => {
        vi.mocked(runJudge).mockResolvedValueOnce({
            ok: true,
            score: 0.72,
            rationale: "semantic_accuracy: mostly correct",
            winner: "tie",
            criteria: [
                {
                    name: "semantic_accuracy",
                    reasoning: "mostly correct",
                    score: 0.72,
                },
            ],
        });

        const result = await runTranscriptEvaluator({
            config: {
                enabled: true,
                modelId: "gpt-4o-mini",
                rubricPrompt: "Score semantic accuracy.",
            },
            transcript: "namaste duniya",
            label: {
                referenceKind: "silver",
                expectedTranscriptLatin: "namaste duniya",
            },
            apiKeys: { openai: "sk-test" },
            maxTokens: 1000,
        });

        expect(runJudge).toHaveBeenCalledWith(
            expect.objectContaining({
                judgeModelId: "gpt-4o-mini",
                rubricPrompt: "Score semantic accuracy.",
                inputText: "Transcribe the supplied audio verbatim.",
                output: "namaste duniya",
                reference: expect.objectContaining({
                    referenceKind: "silver",
                    expectedTranscriptLatin: "namaste duniya",
                }),
            }),
        );
        expect(result).toMatchObject({
            score: 0.72,
            details: {
                metricKind: "llm_judge",
                modelId: "gpt-4o-mini",
                referenceKind: "silver",
            },
        });
    });

    it("skips disabled or incomplete evaluator configs", async () => {
        await expect(
            runTranscriptEvaluator({
                config: {
                    enabled: false,
                    modelId: "gpt-4o-mini",
                    rubricPrompt: "",
                },
                transcript: "hello",
                label: undefined,
                apiKeys: {},
                maxTokens: 1000,
            }),
        ).resolves.toBeUndefined();
        await expect(
            runTranscriptEvaluator({
                config: {
                    enabled: true,
                    modelId: "gpt-4o-mini",
                    rubricPrompt: "",
                },
                transcript: "hello",
                label: undefined,
                apiKeys: {},
                maxTokens: 1000,
            }),
        ).resolves.toBeUndefined();
    });

    it("returns an error metric when the judge fails", async () => {
        vi.mocked(runJudge).mockResolvedValueOnce({
            ok: false,
            error: "provider unavailable",
        });

        const result = await runTranscriptEvaluator({
            config: {
                enabled: true,
                modelId: "gpt-4o-mini",
                rubricPrompt: "Score semantic accuracy.",
            },
            transcript: "hello",
            label: undefined,
            apiKeys: {},
            maxTokens: 1000,
        });

        expect(result).toMatchObject({
            score: null,
            rationale: "transcript judge error: provider unavailable",
            details: {
                metricKind: "llm_judge",
                error: "provider unavailable",
            },
        });
    });
});
