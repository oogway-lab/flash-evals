import { describe, expect, it, vi } from "vitest";
import type { IBenchmarkRubricTask } from "@flash-evals/api-contract";
import { scoreAgainstBenchmark } from "./benchmark";
import {
    parseRubricReply,
    rubricPrompt,
    rubricResponseSchema,
    scoreRubricTask,
    type RubricJudgeFn,
} from "./rubric";

// Synthetic task and answer; not client data.
const task: IBenchmarkRubricTask = {
    key: "quality",
    name: "Call notes",
    description: "Notes a sales manager reads on a phone.",
    method: "rubric",
    paths: ["$.summary", "$.products"],
    criteria: [
        {
            key: "grounded",
            name: "Grounded",
            description: "Nothing invented.",
        },
        { key: "numbers", name: "Numbers right" },
    ],
    instructions: "Official products: Acme Tea, Acme Salt.",
};
const answer = {
    summary: "The shop owner asked for Acme Tea at ₹82.65.",
    products: ["Acme Tea"],
    other: "not sent to the judge",
};
const judge = { modelId: "judge-model" };

describe("rubricPrompt", () => {
    it("lists the criteria, notes, input and only the task's fields", () => {
        const { system, prompt } = rubricPrompt({
            task,
            inputText: "transcript text",
            answer: { "$.summary": answer.summary },
        });
        expect(system).toContain("1 (poor) to 5 (excellent)");
        expect(prompt).toContain("- grounded (Grounded): Nothing invented.");
        expect(prompt).toContain("- numbers (Numbers right)");
        expect(prompt).toContain("Official products: Acme Tea, Acme Salt.");
        expect(prompt).toContain("<input>\ntranscript text\n</input>");
        expect(prompt).toContain("₹82.65");
    });

    it("limits the reply to the task's criterion keys", () => {
        const schema = rubricResponseSchema(task).schema;
        expect(schema.properties.criteria.items.properties.key.enum).toEqual([
            "grounded",
            "numbers",
        ]);
    });
});

describe("parseRubricReply", () => {
    it("returns scores in the task's order", () => {
        expect(
            parseRubricReply(task, {
                criteria: [
                    {
                        key: "numbers",
                        score: 3,
                        reasoning: "One price merged.",
                    },
                    { key: "grounded", score: 5, reasoning: "" },
                ],
            }),
        ).toEqual([
            { key: "grounded", score: 5 },
            { key: "numbers", score: 3, reasoning: "One price merged." },
        ]);
    });

    it("rejects a skipped criterion or a score outside 1–5", () => {
        expect(
            parseRubricReply(task, {
                criteria: [{ key: "grounded", score: 4 }],
            }),
        ).toBe("Judge skipped numbers");
        expect(
            parseRubricReply(task, {
                criteria: [
                    { key: "grounded", score: 0 },
                    { key: "numbers", score: 3 },
                ],
            }),
        ).toBe('Judge gave "grounded" 0, not a whole-number score from 1 to 5');
        expect(parseRubricReply(task, {})).toBe("Judge returned no criteria");
    });

    it("rejects scores that are not whole numbers instead of rounding them", () => {
        const reply = (score: unknown) =>
            parseRubricReply(task, {
                criteria: [
                    { key: "grounded", score },
                    { key: "numbers", score: 3 },
                ],
            });
        expect(reply(2.5)).toBe(
            'Judge gave "grounded" 2.5, not a whole-number score from 1 to 5',
        );
        expect(reply(true)).toBe(
            'Judge gave "grounded" no number, not a whole-number score from 1 to 5',
        );
        expect(reply("4")).toBe(
            'Judge gave "grounded" no number, not a whole-number score from 1 to 5',
        );
        expect(reply(4)).toEqual([
            { key: "grounded", score: 4 },
            { key: "numbers", score: 3 },
        ]);
    });
});

describe("scoreRubricTask", () => {
    it("scales the mean score to 0–1 and keeps the cost", async () => {
        const fake: RubricJudgeFn = vi.fn(async () => ({
            ok: true as const,
            criteria: [
                { key: "grounded", score: 5 },
                { key: "numbers", score: 2 },
            ],
            costUsd: 0.002,
        }));
        const result = await scoreRubricTask(
            task,
            answer,
            { apiKeys: {}, judge },
            fake,
        );
        expect(result).toMatchObject({
            key: "quality",
            method: "rubric",
            agreement: (1 + 0.25) / 2,
            judgeCostUsd: 0.002,
        });
        expect(vi.mocked(fake).mock.calls[0]![0].answer).toEqual({
            "$.summary": answer.summary,
            "$.products": answer.products,
        });
    });

    it("leaves the agreement unset when the judge fails", async () => {
        const result = await scoreRubricTask(
            task,
            answer,
            { apiKeys: {}, judge },
            async () => ({ ok: false, error: "timeout", costUsd: 0.001 }),
        );
        expect(result).toEqual({
            key: "quality",
            method: "rubric",
            error: "timeout",
            judgeCostUsd: 0.001,
        });
        expect(
            await scoreRubricTask(task, answer, { apiKeys: {} }, vi.fn()),
        ).toMatchObject({ error: "No judge model is configured" });
    });
});

describe("scoreAgainstBenchmark with a rubric", () => {
    it("scores an answer with no yardstick, so today's model is scored too", async () => {
        const fake: RubricJudgeFn = async () => ({
            ok: true,
            criteria: [
                { key: "grounded", score: 5 },
                { key: "numbers", score: 5 },
            ],
        });
        const { score, details } = await scoreAgainstBenchmark(
            {
                taskMap: { tasks: [task] },
                candidate: answer,
                cellId: "cell-1",
                judge,
                apiKeys: {},
            },
            undefined,
            fake,
        );
        expect(score).toBe(1);
        expect(details.tasks[0]!.criteria).toHaveLength(2);
    });
});
