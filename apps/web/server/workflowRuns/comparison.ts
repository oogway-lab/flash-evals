import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { ApiKeys } from "@flash-evals/llm-core";
import {
    benchmarkUsesSource,
    type IBenchmarkCellDetails,
    type IPipelineComparisonConfig,
} from "@flash-evals/api-contract";
import { db } from "../db/client";
import {
    datasetItems,
    labels,
    runCells,
    workflowRunAnswers,
} from "../db/schema";
import type { LabelJson, OutputJson } from "../db/jsonTypes";
import { forEachPool } from "../lib/concurrency";
import { scoreAgainstBenchmark } from "../scoring/benchmark";
import {
    benchmarkForCell,
    benchmarkJudge,
    benchmarkJudgePricing,
} from "../runs/executor";
import type { IRunStopGuard } from "../runs/runStop";
import { logWorkerEvent, safeWorkerError } from "../jobs/workerObservability";

interface IUnscoredAnswer {
    id: string;
    datasetItemId: string;
    answer: Record<string, unknown> | null;
}

/** A scored answer whose judge failed on at least one task. */
export interface IAnswerToRejudge extends IUnscoredAnswer {
    previous: IBenchmarkCellDetails;
    scoredAt: Date;
}

/** The reads and writes scoring needs; replaced in tests. */
export interface IPipelineComparisonStore {
    /** Complete final answers not scored since they were last recorded. */
    unscoredAnswers(workflowRunId: string): Promise<IUnscoredAnswer[]>;
    /**
     * Complete answers scored with a judge call that failed on a task (a
     * provider refusal, a spending cap, an answer cut off).
     */
    answersToRejudge(workflowRunId: string): Promise<IAnswerToRejudge[]>;
    /** Of these items, the ones the eval run has. */
    evalItemIds(runId: string, itemIds: string[]): Promise<Set<string>>;
    /** The reference model's successful answers in the eval run, by item. */
    referenceOutputs(
        runId: string,
        referenceRunModelId: string,
        itemIds: string[],
    ): Promise<Map<string, OutputJson | null>>;
    /** When the reference model's cell for each item was last claimed. */
    referenceClaimedAt(
        runId: string,
        referenceRunModelId: string,
        itemIds: string[],
    ): Promise<Map<string, Date>>;
    storedAnswers(itemIds: string[]): Promise<Map<string, LabelJson>>;
    inputTexts(itemIds: string[]): Promise<Map<string, string>>;
    saveScore(
        answerId: string,
        result: {
            score: number | null;
            details?: IBenchmarkCellDetails;
            judgeCostUsd?: number;
        },
    ): Promise<void>;
}

const dbStore: IPipelineComparisonStore = {
    async unscoredAnswers(workflowRunId) {
        return db
            .select({
                id: workflowRunAnswers.id,
                datasetItemId: workflowRunAnswers.datasetItemId,
                answer: workflowRunAnswers.answer,
            })
            .from(workflowRunAnswers)
            .where(
                and(
                    eq(workflowRunAnswers.workflowRunId, workflowRunId),
                    eq(workflowRunAnswers.status, "complete"),
                    isNull(workflowRunAnswers.benchmarkScoredAt),
                ),
            );
    },
    async answersToRejudge(workflowRunId) {
        const rows = await db
            .select({
                id: workflowRunAnswers.id,
                datasetItemId: workflowRunAnswers.datasetItemId,
                answer: workflowRunAnswers.answer,
                previous: workflowRunAnswers.benchmarkDetails,
                scoredAt: workflowRunAnswers.benchmarkScoredAt,
            })
            .from(workflowRunAnswers)
            .where(
                and(
                    eq(workflowRunAnswers.workflowRunId, workflowRunId),
                    eq(workflowRunAnswers.status, "complete"),
                    isNotNull(workflowRunAnswers.benchmarkScoredAt),
                    sql`jsonb_path_exists(${workflowRunAnswers.benchmarkDetails}, '$.tasks[*] ? (exists(@.error))')`,
                ),
            );
        return rows.flatMap((row) =>
            row.previous && row.scoredAt
                ? [{ ...row, previous: row.previous, scoredAt: row.scoredAt }]
                : [],
        );
    },
    async evalItemIds(runId, itemIds) {
        if (itemIds.length === 0) return new Set();
        const rows = await db
            .selectDistinct({ datasetItemId: runCells.datasetItemId })
            .from(runCells)
            .where(
                and(
                    eq(runCells.runId, runId),
                    inArray(runCells.datasetItemId, itemIds),
                ),
            );
        return new Set(rows.map((row) => row.datasetItemId));
    },
    async referenceOutputs(runId, referenceRunModelId, itemIds) {
        if (itemIds.length === 0) return new Map();
        const rows = await db
            .select({
                datasetItemId: runCells.datasetItemId,
                outputJson: runCells.outputJson,
            })
            .from(runCells)
            .where(
                and(
                    eq(runCells.runId, runId),
                    eq(runCells.runModelId, referenceRunModelId),
                    inArray(runCells.status, ["succeeded", "cached"]),
                    inArray(runCells.datasetItemId, itemIds),
                ),
            );
        return new Map(
            rows.map((row) => [row.datasetItemId, row.outputJson ?? null]),
        );
    },
    async referenceClaimedAt(runId, referenceRunModelId, itemIds) {
        if (itemIds.length === 0) return new Map();
        const rows = await db
            .select({
                datasetItemId: runCells.datasetItemId,
                claimedAt: runCells.claimedAt,
            })
            .from(runCells)
            .where(
                and(
                    eq(runCells.runId, runId),
                    eq(runCells.runModelId, referenceRunModelId),
                    inArray(runCells.datasetItemId, itemIds),
                ),
            );
        return new Map(
            rows.flatMap((row) =>
                row.claimedAt
                    ? [[row.datasetItemId, row.claimedAt] as const]
                    : [],
            ),
        );
    },
    async storedAnswers(itemIds) {
        if (itemIds.length === 0) return new Map();
        const rows = await db
            .select({
                datasetItemId: labels.datasetItemId,
                labelJson: labels.labelJson,
            })
            .from(labels)
            .where(inArray(labels.datasetItemId, itemIds));
        return new Map(rows.map((row) => [row.datasetItemId, row.labelJson]));
    },
    async inputTexts(itemIds) {
        if (itemIds.length === 0) return new Map();
        const rows = await db
            .select({ id: datasetItems.id, inputText: datasetItems.inputText })
            .from(datasetItems)
            .where(inArray(datasetItems.id, itemIds));
        return new Map(
            rows.flatMap((row) =>
                row.inputText ? [[row.id, row.inputText] as const] : [],
            ),
        );
    },
    async saveScore(answerId, result) {
        await db
            .update(workflowRunAnswers)
            .set({
                benchmarkScore: result.score,
                benchmarkDetails: result.details ?? null,
                benchmarkScoredAt: new Date(),
                ...(result.judgeCostUsd !== undefined
                    ? {
                          judgeCostUsd: sql`coalesce(${workflowRunAnswers.judgeCostUsd}, 0) + ${result.judgeCostUsd}`,
                      }
                    : {}),
            })
            .where(eq(workflowRunAnswers.id, answerId));
    },
};

function concurrency(): number {
    return Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 5) || 1);
}

/**
 * Scores each recorded final answer against the chosen eval run's
 * yardsticks with the same per-cell scoring eval runs use: its Task Map,
 * its reference model's answer for the item and/or the item's stored
 * answer, and its judge under the combined data rules. Only items the eval
 * run has are scored; failed answers are not (they count as failures). A
 * stop (cancel or the spend limit) is checked before each item; answers
 * not reached stay unscored for a resume. An answer whose judge failed on a
 * task counts as not scored: a resume judges only the failed tasks again
 * and keeps the rest (see priorAnswerBenchmarkToKeep).
 */
export async function scorePipelineAnswers(
    input: {
        workflowRunId: string;
        comparison: IPipelineComparisonConfig;
        apiKeys: ApiKeys;
        stop: Pick<IRunStopGuard, "check">;
    },
    deps: {
        store?: IPipelineComparisonStore;
        score?: typeof scoreAgainstBenchmark;
    } = {},
): Promise<void> {
    const store = deps.store ?? dbStore;
    const score = deps.score ?? scoreAgainstBenchmark;
    const { comparison } = input;
    const config = comparison.benchmark;
    const [unscored, rejudge] = await Promise.all([
        store.unscoredAnswers(input.workflowRunId),
        store.answersToRejudge(input.workflowRunId),
    ]);
    const answers: Array<IUnscoredAnswer | IAnswerToRejudge> = [
        ...unscored,
        ...rejudge,
    ];
    if (answers.length === 0) return;
    const shared = await store.evalItemIds(
        comparison.runId,
        answers.map((answer) => answer.datasetItemId),
    );
    const toScore = answers.filter((answer) =>
        shared.has(answer.datasetItemId),
    );
    if (toScore.length === 0) return;
    const itemIds = toScore.map((answer) => answer.datasetItemId);
    const [references, stored, inputs, judgePricing, claimedAt] =
        await Promise.all([
            comparison.referenceRunModelId
                ? store.referenceOutputs(
                      comparison.runId,
                      comparison.referenceRunModelId,
                      itemIds,
                  )
                : Promise.resolve(new Map<string, OutputJson | null>()),
            store.storedAnswers(itemIds),
            store.inputTexts(itemIds),
            benchmarkJudgePricing(config, input.apiKeys),
            referenceClaimedAtFor(store, comparison, rejudge),
        ]);
    const judge = benchmarkJudge(config, comparison.judgeDataPolicy);
    await forEachPool(toScore, concurrency(), async (answer) => {
        if (await input.stop.check()) return;
        const itemId = answer.datasetItemId;
        try {
            const yardsticks = benchmarkForCell({
                config,
                isReference: false,
                referenceOutput: references.get(itemId) ?? undefined,
                hasReferenceOutput: references.has(itemId),
                label: stored.get(itemId),
            });
            if (!yardsticks) {
                // Nothing to compare with (the reference failed this item):
                // scored, with no tasks, as an eval cell would be.
                await store.saveScore(answer.id, { score: null });
                return;
            }
            const result = await score({
                taskMap: config.taskMap,
                source: config.source,
                candidate: (answer.answer ?? {}) as OutputJson,
                benchmark: yardsticks.modelAnswer,
                storedAnswer: yardsticks.storedAnswer,
                cellId: answer.id,
                inputText: inputs.get(itemId),
                judge,
                judgePricing,
                apiKeys: input.apiKeys,
                maxTokens: comparison.maxTokens,
                ...withPrevious(priorAnswerBenchmarkToKeep(answer, claimedAt)),
            });
            // Only what this pass's judging cost: saveScore adds it to the
            // answer's earlier judge cost, and kept tasks were paid for then.
            const { judgeCostUsd } = result;
            await store.saveScore(answer.id, {
                score: result.score,
                ...(result.details.tasks.length > 0
                    ? { details: result.details }
                    : {}),
                ...(judgeCostUsd !== undefined ? { judgeCostUsd } : {}),
            });
        } catch (error) {
            // Left unscored, so a resumed run tries it again.
            logWorkerEvent("error", "workflow_answer.scoring_failed", {
                workflowRunId: input.workflowRunId,
                phase: "comparison",
                ...safeWorkerError(error),
            });
        }
    });
}

function withPrevious(previous: IBenchmarkCellDetails | undefined): {
    previous?: IBenchmarkCellDetails;
} {
    return previous ? { previous } : {};
}

/**
 * When the reference cells for answers being judged again were last
 * claimed; empty when no task reads the reference model's answer.
 */
async function referenceClaimedAtFor(
    store: IPipelineComparisonStore,
    comparison: IPipelineComparisonConfig,
    rejudge: IAnswerToRejudge[],
): Promise<Map<string, Date>> {
    if (
        rejudge.length === 0 ||
        !comparison.referenceRunModelId ||
        !benchmarkUsesSource(comparison.benchmark, "model")
    )
        return new Map();
    return store.referenceClaimedAt(
        comparison.runId,
        comparison.referenceRunModelId,
        rejudge.map((answer) => answer.datasetItemId),
    );
}

/**
 * The earlier benchmark details to keep for an answer judged again only
 * because a judge call failed. A changed answer is never here: recording it
 * clears its score and details (see recordFinalAnswers), so it is scored
 * from scratch. One whose reference answer was generated again after it was
 * scored is scored from scratch too: its old verdicts no longer apply.
 */
export function priorAnswerBenchmarkToKeep(
    answer: IUnscoredAnswer | IAnswerToRejudge,
    referenceClaimedAt: Map<string, Date>,
): IBenchmarkCellDetails | undefined {
    if (!("previous" in answer)) return undefined;
    const claimed = referenceClaimedAt.get(answer.datasetItemId);
    if (claimed && claimed.getTime() > answer.scoredAt.getTime())
        return undefined;
    return answer.previous;
}
