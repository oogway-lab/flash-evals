import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
    canonicalJsonString,
    WORKFLOW_JUDGE_SCHEMA_DIGEST,
} from "@mosaic/api-contract";
import type { CompletionRequest, CompletionResult } from "@mosaic/llm-core";
import type * as LlmCore from "@mosaic/llm-core";
import { getEvalProvider } from "@mosaic/llm-core";
import { JUDGE_RESPONSE_SCHEMA, runJudge, type JudgeWinner } from "./judge";

vi.mock("@mosaic/llm-core", async (importOriginal) => {
    const actual = await importOriginal<typeof LlmCore>();
    return {
        ...actual,
        getEvalProvider: vi.fn(),
    };
});

function providerComplete(parsed: {
    score: number;
    criteria?: unknown[];
    winner?: JudgeWinner;
}) {
    const normalized = { winner: "not_applicable" as const, ...parsed };
    const complete = vi.fn(
        async (_req: CompletionRequest): Promise<CompletionResult> => ({
            text: JSON.stringify(normalized),
            parsed: normalized,
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            latencyMs: 12,
        }),
    );
    vi.mocked(getEvalProvider).mockReturnValue({ complete });
    return complete;
}

const ONE_CRITERION = [
    { name: "accuracy", reasoning: "matches the reference", score: 0.76 },
];

it("keeps the frozen judge schema digest synchronized", () => {
    expect(
        `sha256:${createHash("sha256")
            .update(canonicalJsonString(JUDGE_RESPONSE_SCHEMA.schema))
            .digest("hex")}`,
    ).toBe(WORKFLOW_JUDGE_SCHEMA_DIGEST);
});

describe("runJudge", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("constructs the judge provider with the persisted transport", async () => {
        providerComplete({ score: 0.76, criteria: ONE_CRITERION });

        await runJudge({
            judgeModelId: "gpt-4o-mini",
            transport: "openrouter",
            rubricPrompt: "Score accuracy.",
            apiKeys: { openrouter: "or-test" },
            hasImage: false,
            output: { answer: "yes" },
        });

        expect(getEvalProvider).toHaveBeenCalledWith(
            expect.objectContaining({ openrouter: "or-test" }),
            { transport: "openrouter" },
        );
    });

    it("includes only declared candidate-output and reference sections", async () => {
        const complete = providerComplete({
            score: 0.76,
            criteria: ONE_CRITERION,
            winner: "tie",
        });

        const result = await runJudge({
            judgeModelId: "gpt-4o-mini",
            rubricPrompt: "Score semantic similarity.",
            apiKeys: { openai: "test" },
            inputText: "Hidden task input",
            hasImage: false,
            output: { answer: "carbonara" },
            label: { answer: "ignored label" },
            reference: { answer: "carbonara with cheese" },
            declaredInputs: ["candidate_output", "reference"],
        });

        expect(result).toEqual({
            ok: true,
            score: 0.76,
            rationale: "Winner: tie\naccuracy: matches the reference",
            criteria: ONE_CRITERION,
            winner: "tie",
        });
        const request = complete.mock.calls[0][0] as CompletionRequest;
        expect(request.prompt).toContain("# Model output");
        expect(request.prompt).toContain("# gpt-4o reference output");
        expect(request.prompt).not.toContain("# Input");
        expect(request.prompt).not.toContain("Ground-truth label");
        expect(request.prompt).not.toContain("Hidden task input");
    });

    it("declared task_input and candidate_output includes input and excludes reference", async () => {
        const complete = providerComplete({
            score: 0.7,
            criteria: ONE_CRITERION,
        });

        await runJudge({
            judgeModelId: "gpt-4o-mini",
            rubricPrompt: "Score answer quality.",
            apiKeys: { openai: "test" },
            inputText: "Visible task input",
            hasImage: false,
            output: { answer: "carbonara" },
            label: { answer: "ignored label" },
            reference: { answer: "hidden reference" },
            declaredInputs: ["task_input", "candidate_output"],
        });

        const request = complete.mock.calls[0][0] as CompletionRequest;
        expect(request.prompt).toContain("# Input");
        expect(request.prompt).toContain("Visible task input");
        expect(request.prompt).toContain("# Model output");
        expect(request.prompt).not.toContain("# gpt-4o reference output");
        expect(request.prompt).not.toContain("Ground-truth label");
    });

    it("returns a per-criterion breakdown and clamps each score 0-1", async () => {
        const result = await (async () => {
            providerComplete({
                score: 0.8,
                criteria: [
                    {
                        name: "correctness",
                        reasoning: "right answer",
                        score: 0.9,
                    },
                    { name: "format", reasoning: "valid json", score: 1.4 },
                ],
            });
            return runJudge({
                judgeModelId: "gpt-4o-mini",
                rubricPrompt: "Score quality.",
                apiKeys: { openai: "test" },
                hasImage: false,
                output: "candidate",
                declaredInputs: ["candidate_output"],
            });
        })();

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.criteria).toEqual([
            { name: "correctness", reasoning: "right answer", score: 0.9 },
            { name: "format", reasoning: "valid json", score: 1 }, // clamped
        ]);
        expect(result.score).toBe(0.8);
    });

    it("schema lists criteria before the overall score, reasoning before each criterion score, and guards bias", async () => {
        const complete = providerComplete({
            score: 0.5,
            criteria: ONE_CRITERION,
        });

        await runJudge({
            judgeModelId: "gpt-4o-mini",
            rubricPrompt: "Score quality.",
            apiKeys: { openai: "test" },
            hasImage: false,
            output: "candidate",
            declaredInputs: ["candidate_output"],
        });

        const request = complete.mock.calls[0][0] as CompletionRequest;
        const schema = (
            request.responseSchema as unknown as {
                schema: {
                    required: string[];
                    properties: {
                        criteria: {
                            items: { required: string[] };
                        };
                    };
                };
            }
        ).schema;
        expect(schema.required).toEqual(["criteria", "score", "winner"]);
        expect(schema.properties.criteria.items.required).toEqual([
            "name",
            "reasoning",
            "score",
        ]);
        expect(request.system).toMatch(/do not reward longer/i);
    });

    it("succeeds with empty criteria when the model returns none", async () => {
        providerComplete({ score: 0.6 });

        const result = await runJudge({
            judgeModelId: "gpt-4o-mini",
            rubricPrompt: "Score quality.",
            apiKeys: { openai: "test" },
            hasImage: false,
            output: "candidate",
            declaredInputs: ["candidate_output"],
        });

        expect(result).toEqual({
            ok: true,
            score: 0.6,
            rationale: "Winner: not_applicable",
            criteria: [],
            winner: "not_applicable",
        });
    });

    it("clamps the overall score to the 0-1 contract", async () => {
        providerComplete({ score: 1.7, criteria: ONE_CRITERION });

        const result = await runJudge({
            judgeModelId: "gpt-4o-mini",
            rubricPrompt: "Score quality.",
            apiKeys: { openai: "test" },
            hasImage: false,
            output: "candidate",
            declaredInputs: ["candidate_output"],
        });

        expect(result.ok).toBe(true);
        if (result.ok) expect(result.score).toBe(1);
    });
});
