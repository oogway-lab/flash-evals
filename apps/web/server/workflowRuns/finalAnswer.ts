import { sql } from "drizzle-orm";
import {
    assembleFinalAnswer,
    stepAnswerValue,
    templatePlaceholderList,
    templateStepKey,
    type FinalAnswerFallback,
    type IFinalAnswerStepResult,
    type IWorkflowRunAnswer,
} from "@flash-evals/api-contract";
import { db } from "../db/client";
import { workflowRunAnswers, type workflowRunCells } from "../db/schema";
import type { IWorkflowSnapshot, JsonSchemaObject } from "../db/jsonTypes";
import { validateDataAgainstSchema } from "../prompts/schemaValidation";

type WorkflowCell = Pick<
    typeof workflowRunCells.$inferSelect,
    "nodeKey" | "status" | "outputJson" | "costUsd" | "latencyMs"
>;

function stepResult(cell: WorkflowCell): IFinalAnswerStepResult {
    if (cell.status === "succeeded" || cell.status === "cached")
        return {
            status: "succeeded",
            answer: stepAnswerValue(
                (cell.outputJson ?? { text: "" }) as {
                    text?: string;
                    json?: Record<string, unknown>;
                },
            ),
        };
    if (cell.status === "skipped" || cell.status === "failed")
        return { status: cell.status };
    return { status: "pending" };
}

function sum(values: Array<number | null>): number | undefined {
    const known = values.filter((value): value is number => value !== null);
    return known.length > 0
        ? known.reduce((total, value) => total + value, 0)
        : undefined;
}

/** Node types that score a pipeline's answers rather than produce them. */
const SCORING_NODE_TYPES = new Set(["judge", "metric_compare"]);

/**
 * The steps the final answer reads: each field's step, the steps its rules
 * check and the steps its fallback and empty-value templates name (by key
 * or label). A step that failed upstream of them marks them failed too.
 */
function answerStepKeys(
    finalAnswer: NonNullable<IWorkflowSnapshot["finalAnswer"]>,
    steps: ReadonlyMap<string, { label?: string }>,
): Set<string> {
    const templateSteps = (fallback: FinalAnswerFallback | undefined) =>
        fallback && "template" in fallback
            ? templatePlaceholderList(fallback.template).flatMap(
                  (placeholder) => {
                      const key =
                          placeholder.step &&
                          templateStepKey(steps, placeholder.step);
                      return key ? [key] : [];
                  },
              )
            : [];
    return new Set(
        finalAnswer.fields.flatMap((field) => [
            field.stepKey,
            ...(field.setWhen ?? []).map((rule) => rule.when.stepKey),
            ...templateSteps(field.fallback),
            ...templateSteps(field.whenEmpty),
        ]),
    );
}

/**
 * One item's final answer from its step cells, or undefined while any step
 * is still pending or running. It fails only when a step it reads failed;
 * a failed scoring step (judge, metric) does not change the answer unless
 * the answer reads it. Cost and latency add up the steps that make the
 * answer (skipped steps cost nothing; scoring steps are left out, except
 * those the answer reads, which also decide its status). The schema check
 * is reported, not
 * enforced: fields of skipped steps without a fallback are left out, which
 * a schema may not allow.
 */
export function finalAnswerForItem(
    finalAnswer: NonNullable<IWorkflowSnapshot["finalAnswer"]>,
    cells: WorkflowCell[],
    /** Step labels by node key, which fallback templates may use. */
    labels: ReadonlyMap<string, string> = new Map(),
    /** Node keys of steps that score answers (judge, metric). */
    scoringSteps: ReadonlySet<string> = new Set(),
): Omit<IWorkflowRunAnswer, "datasetItemId"> | undefined {
    const steps = new Map(
        cells.map((cell) => {
            const label = labels.get(cell.nodeKey);
            return [
                cell.nodeKey,
                { ...stepResult(cell), ...(label ? { label } : {}) },
            ];
        }),
    );
    if ([...steps.values()].some((step) => step.status === "pending"))
        return undefined;
    const answer = assembleFinalAnswer(finalAnswer, steps);
    const checked = finalAnswer.schema
        ? validateDataAgainstSchema(
              finalAnswer.schema.schema as JsonSchemaObject,
              answer,
          )
        : { ok: true as const };
    const read = answerStepKeys(finalAnswer, steps);
    const answerCells = cells.filter(
        (cell) => !scoringSteps.has(cell.nodeKey) || read.has(cell.nodeKey),
    );
    const costUsd = sum(answerCells.map((cell) => cell.costUsd));
    const latencyMs = sum(answerCells.map((cell) => cell.latencyMs));
    return {
        answer,
        status: [...steps].some(
            ([nodeKey, step]) => read.has(nodeKey) && step.status === "failed",
        )
            ? "failed"
            : "complete",
        ...(checked.ok
            ? {}
            : {
                  schemaErrors: checked.errors.map(({ path, message }) => ({
                      path,
                      message,
                  })),
              }),
        ...(costUsd !== undefined ? { costUsd } : {}),
        ...(latencyMs !== undefined ? { latencyMs } : {}),
    };
}

/** Records the final answer of every item whose steps have all finished. */
export async function recordFinalAnswers(input: {
    workflowRunId: string;
    snapshot: IWorkflowSnapshot;
    cells: Array<WorkflowCell & { datasetItemId: string }>;
}): Promise<void> {
    const finalAnswer = input.snapshot.finalAnswer;
    if (!finalAnswer) return;
    const labels = new Map(
        input.snapshot.nodes.map((node) => [node.nodeKey, node.label]),
    );
    const scoringSteps = new Set(
        input.snapshot.nodes
            .filter((node) => SCORING_NODE_TYPES.has(node.nodeType ?? ""))
            .map((node) => node.nodeKey),
    );
    const byItem = new Map<string, WorkflowCell[]>();
    for (const cell of input.cells)
        byItem.set(cell.datasetItemId, [
            ...(byItem.get(cell.datasetItemId) ?? []),
            cell,
        ]);
    for (const [datasetItemId, cells] of byItem) {
        const result = finalAnswerForItem(
            finalAnswer,
            cells,
            labels,
            scoringSteps,
        );
        if (!result) continue;
        const values = {
            answer: result.answer ?? null,
            status: result.status,
            schemaErrors: result.schemaErrors ?? null,
            costUsd: result.costUsd ?? null,
            latencyMs: result.latencyMs ?? null,
        };
        await db
            .insert(workflowRunAnswers)
            .values({
                workflowRunId: input.workflowRunId,
                datasetItemId,
                ...values,
            })
            .onConflictDoUpdate({
                target: [
                    workflowRunAnswers.workflowRunId,
                    workflowRunAnswers.datasetItemId,
                ],
                set: {
                    ...values,
                    // A changed answer (a resumed run re-ran a failed step)
                    // is compared again; an unchanged one keeps its score.
                    ...Object.fromEntries(
                        (
                            [
                                "benchmarkScore",
                                "benchmarkDetails",
                                "benchmarkScoredAt",
                            ] as const
                        ).map((column) => [
                            column,
                            sql`case when ${workflowRunAnswers.answer} is not distinct from excluded.answer and ${workflowRunAnswers.status} = excluded.status then ${workflowRunAnswers[column]} else null end`,
                        ]),
                    ),
                    updatedAt: sql`now()`,
                },
            });
    }
}
