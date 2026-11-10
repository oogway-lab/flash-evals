import {
    benchmarkPathSegments,
    benchmarkTaskSource,
    valueAtBenchmarkPath,
    type IAnswerDecision,
    type IBenchmarkCellDetails,
    type IBenchmarkRubricTask,
    type IBenchmarkRulesTask,
    type IBenchmarkTaskResult,
    type IDecideDisagreementRequest,
    type IDecideDisagreementResponse,
    type IRunBenchmarkConfig,
    type IRunDisagreement,
    type IRunDisagreementsResponse,
} from "@flash-evals/api-contract";
import {
    candidateGoesFirst,
    judgeOrderSeed,
} from "@flash-evals/llm-core/judge-order";
import { withTransaction, type IDb } from "../../db.js";
import { ApiBadRequestError, ApiNotFoundError } from "../../errors.js";

interface IRunRow {
    id: string;
    config_snapshot: { benchmark?: IRunBenchmarkConfig } | null;
}

interface ICellRow {
    id: string;
    dataset_item_id: string;
    source_name: string | null;
    input_text: string | null;
    status: string;
    error: string | null;
    output_json: unknown;
    details_json: IBenchmarkCellDetails | null;
}

interface IDecisionRow {
    dataset_item_id: string;
    path: string;
    choice: "candidate" | "benchmark";
    new_value: unknown;
    run_cell_id: string | null;
    created_at: Date | string;
}

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

async function benchmarkRun(
    db: IDb,
    input: { teamId: string; projectId: string; runId: string },
): Promise<{ run: IRunRow; benchmark: IRunBenchmarkConfig }> {
    const result = await db.query<IRunRow>(
        `select id, config_snapshot from runs
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [input.runId, input.teamId, input.projectId],
    );
    const run = result.rows[0];
    const benchmark = run?.config_snapshot?.benchmark;
    if (!run || !benchmark) throw new ApiNotFoundError();
    return { run, benchmark };
}

/**
 * The transcripts where a model and its yardstick differ on one task: the
 * fields that differ (agreement tasks), the judged losses (head-to-head),
 * the broken checks (rule checks) or the criteria scored below the
 * reference model (rubrics), with the stored answer now and any decision
 * already made.
 */
export async function runDisagreementsPayload(
    db: IDb,
    input: {
        teamId: string;
        projectId: string;
        runId: string;
        runModelId: string;
        taskKey: string;
    },
): Promise<IRunDisagreementsResponse> {
    const { benchmark } = await benchmarkRun(db, input);
    const task = benchmark.taskMap.tasks.find(
        (candidate) => candidate.key === input.taskKey,
    );
    if (!task) throw new ApiNotFoundError();
    const models = await db.query<{
        id: string;
        model_id: string;
        is_reference: boolean;
    }>(`select id, model_id, is_reference from run_models where run_id = $1`, [
        input.runId,
    ]);
    const model = models.rows.find((row) => row.id === input.runModelId);
    if (!model) throw new ApiNotFoundError();
    const reference = models.rows.find((row) => row.is_reference);

    const cells = await db.query<ICellRow>(
        `select c.id, c.dataset_item_id, i.source_name, i.input_text,
                c.status, c.error, c.output_json, s.details_json
        from run_cells c
        inner join dataset_items i on i.id = c.dataset_item_id
        left join cell_scores s
            on s.run_cell_id = c.id and s.scorer_type = 'benchmark'
        where c.run_id = $1 and c.run_model_id = $2
        order by i.created_at, i.id`,
        [input.runId, input.runModelId],
    );
    // Rubrics: the reference model's scores on the same transcripts.
    const referenceResults =
        task.method === "rubric" && reference && reference.id !== model.id
            ? await referenceTaskResults(
                  db,
                  input.runId,
                  reference.id,
                  task.key,
              )
            : new Map<string, IBenchmarkTaskResult>();
    const compared = cells.rows.filter(
        (cell) =>
            cell.status === "failed" ||
            cell.details_json?.tasks.some((result) => result.key === task.key),
    );
    const differing = compared.filter((cell) => {
        if (cell.status === "failed") return true;
        const result = cell.details_json?.tasks.find(
            (entry) => entry.key === task.key,
        );
        if (task.method === "rules")
            return (result?.rules ?? []).some((rule) => !rule.passed);
        if (task.method === "rubric")
            return (
                result?.error !== undefined ||
                scoredBelowReference(
                    result,
                    referenceResults.get(cell.dataset_item_id),
                )
            );
        return task.method === "head_to_head"
            ? result?.verdict === "loss"
            : (result?.fields ?? []).some((field) => field.score < 1);
    });
    const yardstick = benchmarkTaskSource(task, benchmark);
    const itemIds = [...new Set(differing.map((cell) => cell.dataset_item_id))];
    const [labels, decisions, referenceOutputs] = await Promise.all([
        db.query<{ dataset_item_id: string; label_json: unknown }>(
            `select dataset_item_id, label_json from labels
            where dataset_item_id = any($1::uuid[])`,
            [itemIds],
        ),
        db.query<IDecisionRow>(
            `select distinct on (dataset_item_id, path)
                dataset_item_id, path, choice, new_value, run_cell_id, created_at
            from label_corrections
            where dataset_item_id = any($1::uuid[])
            order by dataset_item_id, path, created_at desc`,
            [itemIds],
        ),
        ((task.method === "head_to_head" && yardstick === "model") ||
            task.method === "rubric") &&
        reference
            ? db.query<{ dataset_item_id: string; output_json: unknown }>(
                  `select dataset_item_id, output_json from run_cells
                  where run_id = $1 and run_model_id = $2
                    and dataset_item_id = any($3::uuid[])`,
                  [input.runId, reference.id, itemIds],
              )
            : Promise.resolve({ rows: [] }),
    ]);
    const labelByItem = new Map(
        labels.rows.map((row) => [row.dataset_item_id, row.label_json]),
    );
    const referenceByItem = new Map(
        referenceOutputs.rows.map((row) => [
            row.dataset_item_id,
            row.output_json,
        ]),
    );
    const cellIds = new Set(differing.map((cell) => cell.id));

    const disagreements = differing.map((cell): IRunDisagreement => {
        const result = cell.details_json?.tasks.find(
            (entry) => entry.key === task.key,
        );
        const stored = labelByItem.get(cell.dataset_item_id);
        const pick = (source: unknown, paths: string[]) =>
            Object.fromEntries(
                paths.map((path) => [path, valueAtBenchmarkPath(source, path)]),
            );
        const itemDecisions: IAnswerDecision[] = decisions.rows
            .filter((row) => row.dataset_item_id === cell.dataset_item_id)
            .map((row) => ({
                path: row.path,
                choice: row.choice,
                newValue: row.new_value,
                decidedAt: new Date(row.created_at).toISOString(),
                fromThisRun:
                    row.run_cell_id !== null && cellIds.has(row.run_cell_id),
            }));
        return {
            cellId: cell.id,
            itemId: cell.dataset_item_id,
            ...(cell.source_name ? { itemName: cell.source_name } : {}),
            ...(cell.input_text ? { inputText: cell.input_text } : {}),
            ...(cell.status === "failed"
                ? { failed: true, ...(cell.error ? { error: cell.error } : {}) }
                : {}),
            fields: (result?.fields ?? [])
                .filter((field) => field.score < 1)
                .map((field) => ({
                    path: field.path,
                    matcher: field.matcher,
                    score: field.score,
                    candidate: field.candidate,
                    benchmark: field.benchmark,
                    ...(stored !== undefined
                        ? {
                              storedNow: valueAtBenchmarkPath(
                                  stored,
                                  field.path,
                              ),
                          }
                        : {}),
                })),
            ...(task.method === "rules"
                ? { brokenRules: brokenRules(task, result) }
                : {}),
            ...(task.method === "rubric" && cell.status !== "failed"
                ? rubricExtras(
                      task,
                      result,
                      referenceResults.get(cell.dataset_item_id),
                      pick(cell.output_json, task.paths),
                      referenceByItem.has(cell.dataset_item_id)
                          ? pick(
                                referenceByItem.get(cell.dataset_item_id),
                                task.paths,
                            )
                          : undefined,
                  )
                : {}),
            ...(task.method === "head_to_head" && cell.status !== "failed"
                ? {
                      ...(result?.rationale
                          ? { rationale: result.rationale }
                          : {}),
                      candidateLetter: candidateGoesFirst(
                          judgeOrderSeed(cell.id, task.key),
                      )
                          ? "A"
                          : "B",
                      candidateAnswer: pick(cell.output_json, task.paths),
                      // What the judge compared against: the stored answer
                      // (as it is now) on a stored-answer task, else the
                      // reference model's answer.
                      benchmarkAnswer: pick(
                          yardstick === "labels"
                              ? stored
                              : referenceByItem.get(cell.dataset_item_id),
                          task.paths,
                      ),
                  }
                : {}),
            decisions: itemDecisions,
        };
    });

    return {
        runModelId: model.id,
        modelId: model.model_id,
        taskKey: task.key,
        taskName: task.name,
        method: task.method,
        yardstick,
        ...(reference ? { referenceModelId: reference.model_id } : {}),
        compared: compared.length,
        disagreements,
    };
}

/** Score at or below which a criterion is flagged when there is no reference score. */
const LOW_RUBRIC_SCORE = 2;

/**
 * A criterion the reference model outscored on this transcript; without a
 * reference score (the reference's own row, or its judge call failed), a
 * low score.
 */
function scoredBelowReference(
    result: IBenchmarkTaskResult | undefined,
    reference: IBenchmarkTaskResult | undefined,
): boolean {
    return (result?.criteria ?? []).some((criterion) => {
        const referenceScore = reference?.criteria?.find(
            (entry) => entry.key === criterion.key,
        )?.score;
        return referenceScore === undefined
            ? criterion.score <= LOW_RUBRIC_SCORE
            : criterion.score < referenceScore;
    });
}

/** A rubric transcript's scores, judge error and both answers. */
function rubricExtras(
    task: IBenchmarkRubricTask,
    result: IBenchmarkTaskResult | undefined,
    reference: IBenchmarkTaskResult | undefined,
    candidateAnswer: Record<string, unknown>,
    benchmarkAnswer: Record<string, unknown> | undefined,
): Partial<IRunDisagreement> {
    return {
        ...(result?.error ? { error: result.error } : {}),
        criterionScores: criterionScores(task, result, reference),
        candidateAnswer,
        ...(benchmarkAnswer ? { benchmarkAnswer } : {}),
    };
}

function criterionScores(
    task: IBenchmarkRubricTask,
    result: IBenchmarkTaskResult | undefined,
    reference: IBenchmarkTaskResult | undefined,
): NonNullable<IRunDisagreement["criterionScores"]> {
    return task.criteria.map((criterion) => {
        const own = result?.criteria?.find((c) => c.key === criterion.key);
        const theirs = reference?.criteria?.find(
            (c) => c.key === criterion.key,
        );
        return {
            key: criterion.key,
            name: criterion.name,
            ...(own ? { score: own.score } : {}),
            ...(theirs ? { referenceScore: theirs.score } : {}),
            ...(own?.reasoning ? { reasoning: own.reasoning } : {}),
        };
    });
}

async function referenceTaskResults(
    db: IDb,
    runId: string,
    referenceRunModelId: string,
    taskKey: string,
): Promise<Map<string, IBenchmarkTaskResult>> {
    const rows = await db.query<{
        dataset_item_id: string;
        details_json: IBenchmarkCellDetails | null;
    }>(
        `select c.dataset_item_id, s.details_json
        from run_cells c
        inner join cell_scores s
            on s.run_cell_id = c.id and s.scorer_type = 'benchmark'
        where c.run_id = $1 and c.run_model_id = $2`,
        [runId, referenceRunModelId],
    );
    const results = new Map<string, IBenchmarkTaskResult>();
    for (const row of rows.rows) {
        const result = row.details_json?.tasks.find(
            (entry) => entry.key === taskKey,
        );
        if (result) results.set(row.dataset_item_id, result);
    }
    return results;
}

function brokenRules(
    task: IBenchmarkRulesTask,
    result: IBenchmarkTaskResult | undefined,
): NonNullable<IRunDisagreement["brokenRules"]> {
    return (result?.rules ?? [])
        .filter((rule) => !rule.passed)
        .map((rule) => ({
            key: rule.key,
            name:
                task.rules.find((entry) => entry.key === rule.key)?.name ??
                rule.key,
            offending: rule.offending ?? [],
        }));
}

/** A copy of `source` with `value` at `path`, creating objects on the way. */
export function withValueAtPath(
    source: unknown,
    path: string,
    value: unknown,
): Record<string, unknown> {
    const segments = benchmarkPathSegments(path);
    if (
        !segments ||
        segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))
    )
        throw new ApiBadRequestError(`"${path}" is not a field path.`);
    const root: Record<string, unknown> = isPlainObject(source)
        ? structuredClone(source)
        : {};
    let node = root;
    for (const segment of segments.slice(0, -1)) {
        const next = node[segment];
        node[segment] = isPlainObject(next) ? next : {};
        node = node[segment] as Record<string, unknown>;
    }
    node[segments.at(-1)!] = value;
    return root;
}

/**
 * Record who was right on one field: the chosen value becomes the dataset's
 * stored answer for that transcript, and the change is logged.
 */
export async function decideDisagreementPayload(
    db: IDb,
    input: IDecideDisagreementRequest,
): Promise<IDecideDisagreementResponse> {
    if (input.choice !== "candidate" && input.choice !== "benchmark")
        throw new ApiBadRequestError(
            'choice must be "candidate" or "benchmark".',
        );
    const { benchmark } = await benchmarkRun(db, input);
    const task = benchmark.taskMap.tasks.find(
        (candidate) => candidate.key === input.taskKey,
    );
    if (!task || task.method !== "agreement")
        throw new ApiBadRequestError(
            "Only tasks compared field by field can be decided here.",
        );
    const cell = (
        await db.query<{
            dataset_item_id: string;
            details_json: IBenchmarkCellDetails | null;
        }>(
            `select c.dataset_item_id, s.details_json
            from run_cells c
            left join cell_scores s
                on s.run_cell_id = c.id and s.scorer_type = 'benchmark'
            where c.id = $1 and c.run_id = $2`,
            [input.cellId, input.runId],
        )
    ).rows[0];
    if (!cell) throw new ApiNotFoundError();
    const field = cell.details_json?.tasks
        .find((entry) => entry.key === task.key)
        ?.fields?.find((entry) => entry.path === input.path);
    if (!field)
        throw new ApiBadRequestError(
            `This answer has no compared value for ${input.path}.`,
        );
    const newValue =
        input.choice === "candidate" ? field.candidate : field.benchmark;
    if (newValue === undefined)
        throw new ApiBadRequestError("That answer has no value to save.");

    await withTransaction(db, async (tx) => {
        const current = (
            await tx.query<{ label_json: unknown }>(
                `select label_json from labels
                where dataset_item_id = $1
                for update`,
                [cell.dataset_item_id],
            )
        ).rows[0]?.label_json;
        const next = withValueAtPath(current, input.path, newValue);
        await tx.query(
            `insert into labels (dataset_item_id, label_json)
            values ($1, $2::jsonb)
            on conflict (dataset_item_id) do update set
                label_json = excluded.label_json`,
            [cell.dataset_item_id, JSON.stringify(next)],
        );
        await tx.query(
            `insert into label_corrections (
                dataset_item_id, path, previous_value, new_value,
                choice, task_key, run_cell_id, decided_by
            ) values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8)`,
            [
                cell.dataset_item_id,
                input.path,
                JSON.stringify(
                    valueAtBenchmarkPath(current, input.path) ?? null,
                ),
                JSON.stringify(newValue),
                input.choice,
                task.key,
                input.cellId,
                input.decidedBy || null,
            ],
        );
    });
    return { itemId: cell.dataset_item_id, path: input.path, newValue };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
