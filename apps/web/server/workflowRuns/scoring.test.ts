import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    scoreOutput: vi.fn(),
    inserted: [] as Array<unknown>,
    deleted: 0,
    itemScores: [] as Array<Record<string, unknown>>,
    itemUpdates: [] as Array<Record<string, unknown>>,
    itemUpdateConditions: [] as unknown[],
    ownsLease: true,
    runTranscriptEvaluator: vi.fn(),
    executeWorkflowLlmInvocation: vi.fn(),
}));

vi.mock("../db/client", () => ({
    db: {
        transaction: vi.fn(async (callback: (tx: any) => Promise<void>) =>
            callback({
                select: vi.fn(() => ({
                    from: vi.fn(() => ({
                        where: vi.fn(() => ({
                            for: vi.fn(() => ({
                                limit: vi.fn(async () =>
                                    mocks.ownsLease ? [{ id: "item-1" }] : [],
                                ),
                            })),
                        })),
                    })),
                })),
                delete: vi.fn(() => ({
                    where: vi.fn(async () => {
                        mocks.deleted += 1;
                    }),
                })),
                insert: vi.fn(() => ({
                    values: vi.fn((rows: unknown) => {
                        mocks.inserted.push(rows);
                        return {
                            onConflictDoUpdate: vi.fn(async () => {
                                mocks.itemScores.push(
                                    rows as Record<string, unknown>,
                                );
                            }),
                        };
                    }),
                })),
            }),
        ),
        insert: vi.fn(() => ({
            values: vi.fn((row: Record<string, unknown>) => ({
                onConflictDoUpdate: vi.fn(async () => {
                    mocks.itemScores.push(row);
                }),
            })),
        })),
        update: vi.fn(() => ({
            set: vi.fn((payload: Record<string, unknown>) => ({
                where: vi.fn(async (condition: unknown) => {
                    mocks.itemUpdates.push(payload);
                    mocks.itemUpdateConditions.push(condition);
                }),
            })),
        })),
    },
}));
vi.mock("../scoring/scoreOutput", () => ({ scoreOutput: mocks.scoreOutput }));
vi.mock("../audio/customEvaluators", () => ({
    runTranscriptEvaluator: mocks.runTranscriptEvaluator,
}));
vi.mock("./llmInvocation", () => ({
    executeWorkflowLlmInvocation: mocks.executeWorkflowLlmInvocation,
}));

import {
    scoreWorkflowCell,
    scoreWorkflowTranscriptItem,
    type IWorkflowScoringContext,
} from "./scoring";
import type { IJudgePromptScoringConfig } from "../scoring/scoreOutput";

const judgePrompt: IJudgePromptScoringConfig = {
    modelId: "judge-model",
    rubricPrompt: "Judge it",
    declaredInputs: ["task_input", "candidate_output"],
};
const context: IWorkflowScoringContext = {
    labelsByItemId: new Map(),
    judgePromptsByNodeKey: new Map([["a", judgePrompt]]),
};

describe("scoreWorkflowCell", () => {
    beforeEach(() => {
        mocks.scoreOutput.mockReset();
        mocks.inserted.length = 0;
        mocks.deleted = 0;
        mocks.itemScores.length = 0;
        mocks.itemUpdates.length = 0;
        mocks.itemUpdateConditions.length = 0;
        mocks.ownsLease = true;
        mocks.runTranscriptEvaluator.mockReset();
        mocks.executeWorkflowLlmInvocation.mockReset();
    });

    it("replaces prior scores with the judge score and rationale", async () => {
        const provenance = {
            actual: { status: "resolved" },
            attempts: [],
        };
        mocks.executeWorkflowLlmInvocation.mockResolvedValue({
            artifact: {
                json: { score: 0.75, criteria: [] },
                executionProvenance: provenance,
            },
            latencyMs: 10,
        });
        mocks.scoreOutput.mockImplementation(async (_input, explicitJudge) => {
            await explicitJudge({
                judgeModelId: "judge-model",
                rubricPrompt: "Judge it",
                apiKeys: {},
                hasImage: false,
                output: { text: "candidate" },
            });
            return {
                judge: {
                    score: 0.75,
                    rationale: "Mostly correct",
                    details: { passed: true },
                },
            };
        });

        await scoreWorkflowCell({
            cellId: "cell-1",
            node: {
                id: "node-a",
                nodeKey: "a",
                label: "A",
                promptVersionId: "pv-a",
                promptContent: "Do A",
                modelId: "judge-model",
                resolvedLlmExecution: {
                    route: {
                        modelId: "judge-model",
                        generation: { maxOutputTokens: 4000 },
                    },
                } as never,
                evalConfig: { type: "judge", judgeConfigId: "judge-1" },
            },
            item: { id: "item-1", inputText: "input" },
            output: { text: "candidate" },
            apiKeys: {},
            context,
            teamId: "team-1",
            projectId: "project-1",
        });

        expect(mocks.deleted).toBe(1);
        expect(mocks.inserted).toEqual([
            [
                expect.objectContaining({
                    workflowRunCellId: "cell-1",
                    scorerType: "judge",
                    score: 0.75,
                    rationale: "Mostly correct",
                    detailsJson: {
                        passed: true,
                        executionProvenance: provenance,
                    },
                }),
            ],
        ]);
    });

    it("does nothing when evaluation is disabled", async () => {
        await scoreWorkflowCell({
            cellId: "cell-1",
            node: {
                id: "node-a",
                nodeKey: "a",
                label: "A",
                promptVersionId: "pv-a",
                promptContent: "Do A",
                modelId: "model",
                evalConfig: { type: "none" },
            },
            item: { id: "item-1" },
            output: { text: "candidate" },
            apiKeys: {},
            context,
        });

        expect(mocks.scoreOutput).not.toHaveBeenCalled();
        expect(mocks.inserted).toHaveLength(0);
    });
});

describe("scoreWorkflowTranscriptItem", () => {
    beforeEach(() => {
        mocks.itemScores.length = 0;
        mocks.itemUpdates.length = 0;
        mocks.itemUpdateConditions.length = 0;
        mocks.ownsLease = true;
        mocks.runTranscriptEvaluator.mockReset();
    });

    it("scores the matching Latin reference with canonical metrics and segments", async () => {
        const transcriptContext: IWorkflowScoringContext = {
            labelsByItemId: new Map([
                [
                    "item-1",
                    {
                        expectedTranscript: "native script",
                        expectedTranscriptLatin: "hello world",
                        expectedSpeakerTurns: [
                            { speaker: "A", text: "hello world" },
                        ],
                    },
                ],
            ]),
            judgePromptsByNodeKey: new Map(),
        };

        await scoreWorkflowTranscriptItem({
            ownership: {
                workflowRunItemId: "workflow-item-1",
                leaseOwner: "lease-1",
            },
            candidate: {
                itemId: "item-1",
                transcript: "hello world",
                variant: "latin",
                artifact: {
                    text: "hello world",
                    segments: [{ text: "hello world", speaker: "A" }],
                    speakers: [{ id: "A" }],
                    warnings: [],
                },
            },
            model: {
                sttModelId: "stt-model",
                providerId: "openai",
                routeId: "direct",
                configHash: "hash",
            },
            provenance: {},
            evaluator: undefined,
            apiKeys: {},
            context: transcriptContext,
        });

        expect(mocks.itemScores).toContainEqual(
            expect.objectContaining({
                scorerType: "transcript_metric",
                status: "completed",
                score: 1,
                detailsJson: expect.objectContaining({
                    transcriptVariant: "latin",
                    referenceField: "expectedTranscriptLatin",
                    diarization: expect.any(Object),
                }),
            }),
        );
        expect(mocks.itemUpdates).toContainEqual(
            expect.objectContaining({ evaluationStatus: "completed" }),
        );
    });

    it("records missing mechanical coverage and fails closed for an unresolved transcript judge", async () => {
        mocks.runTranscriptEvaluator.mockResolvedValue({
            score: 0.8,
            rationale: "clear",
            details: {
                metricKind: "llm_judge",
                modelId: "judge",
                rubricPrompt: "clarity",
            },
        });

        await scoreWorkflowTranscriptItem({
            ownership: {
                workflowRunItemId: "workflow-item-1",
                leaseOwner: "lease-1",
            },
            candidate: {
                itemId: "item-1",
                transcript: "candidate",
                variant: "raw",
                artifact: {
                    text: "candidate",
                    segments: [],
                    speakers: [],
                    warnings: [],
                },
            },
            model: {
                sttModelId: "stt-model",
                providerId: "openai",
                routeId: "direct",
                configHash: "hash",
            },
            provenance: {},
            evaluator: {
                enabled: true,
                modelId: "judge",
                rubricPrompt: "clarity",
            },
            apiKeys: {},
            context: {
                labelsByItemId: new Map(),
                judgePromptsByNodeKey: new Map(),
            },
        });

        expect(mocks.itemScores).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    scorerType: "transcript_metric",
                    status: "skipped",
                }),
                expect.objectContaining({
                    scorerType: "transcript_judge",
                    status: "error",
                    error: expect.stringContaining(
                        "requires an explicit evaluator route",
                    ),
                }),
            ]),
        );
        expect(mocks.runTranscriptEvaluator).not.toHaveBeenCalled();
    });

    it("marks the item partial when the transcript judge returns an error", async () => {
        mocks.runTranscriptEvaluator.mockResolvedValue({
            score: null,
            rationale: "judge unavailable",
            details: {
                metricKind: "llm_judge",
                modelId: "judge",
                rubricPrompt: "clarity",
                error: "Judge timed out",
            },
        });

        await scoreWorkflowTranscriptItem({
            ownership: {
                workflowRunItemId: "workflow-item-1",
                leaseOwner: "lease-1",
            },
            candidate: {
                itemId: "item-1",
                transcript: "candidate",
                variant: "raw",
                artifact: {
                    text: "candidate",
                    segments: [],
                    speakers: [],
                    warnings: [],
                },
            },
            model: {
                sttModelId: "stt-model",
                providerId: "openai",
                routeId: "direct",
                configHash: "hash",
            },
            provenance: {},
            evaluator: {
                enabled: true,
                modelId: "judge",
                rubricPrompt: "clarity",
            },
            apiKeys: {},
            context: {
                labelsByItemId: new Map([
                    ["item-1", { expectedTranscript: "candidate" }],
                ]),
                judgePromptsByNodeKey: new Map(),
            },
        });

        expect(mocks.itemScores).toContainEqual(
            expect.objectContaining({
                scorerType: "transcript_judge",
                status: "error",
                error: expect.stringContaining(
                    "requires an explicit evaluator route",
                ),
            }),
        );
        expect(mocks.runTranscriptEvaluator).not.toHaveBeenCalled();
        expect(mocks.itemUpdates).toContainEqual(
            expect.objectContaining({ evaluationStatus: "partial" }),
        );
        expect(
            mocks.itemUpdateConditions.some((condition) =>
                containsValue(condition, "lease-1"),
            ),
        ).toBe(true);
    });

    it("does not replace scores after losing the evaluation lease", async () => {
        mocks.ownsLease = false;

        await scoreWorkflowTranscriptItem({
            ownership: {
                workflowRunItemId: "workflow-item-1",
                leaseOwner: "stale-lease",
            },
            candidate: {
                itemId: "item-1",
                transcript: "candidate",
                variant: "raw",
                artifact: {
                    text: "candidate",
                    segments: [],
                    speakers: [],
                    warnings: [],
                },
            },
            model: {
                sttModelId: "stt-model",
                providerId: "openai",
                routeId: "direct",
                configHash: "hash",
            },
            provenance: {},
            evaluator: undefined,
            apiKeys: {},
            context: {
                labelsByItemId: new Map(),
                judgePromptsByNodeKey: new Map(),
            },
        });

        expect(mocks.itemScores).toHaveLength(0);
    });
});

function containsValue(
    value: unknown,
    expected: string,
    seen = new WeakSet<object>(),
): boolean {
    if (value === expected) return true;
    if (!value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).some((child) =>
        containsValue(child, expected, seen),
    );
}
