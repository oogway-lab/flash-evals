import {
    benchmarkPathSegments,
    itemFilterMatches,
    valueAtBenchmarkPath,
    type ICountItemFilterMatchesRequest,
    type ICountItemFilterMatchesResponse,
    type ICreateRunRequest,
    type IRunItemFilter,
} from "@flash-evals/api-contract";
import type { IDb } from "../../db.js";
import { ApiBadRequestError, ApiNotFoundError } from "../../errors.js";

const MAX_FILTER_TEXT = 200;

/**
 * Checks a run's item filter and returns it with `path` set: a `taskKey`
 * names a benchmark task with exactly one field, whose path is used.
 * Undefined when the run has no filter.
 */
export function resolveItemFilter(
    input: Pick<ICreateRunRequest, "itemFilter" | "benchmark" | "audioRunMode">,
): IRunItemFilter | undefined {
    const filter = input.itemFilter as unknown;
    if (filter === undefined) return undefined;
    if (!filter || typeof filter !== "object" || Array.isArray(filter))
        throw new ApiBadRequestError(
            "itemFilter must be an object with equals and a taskKey or path.",
        );
    const { taskKey, path, equals } = filter as Record<string, unknown>;
    if (!isFilterValue(equals))
        throw new ApiBadRequestError(
            "itemFilter.equals must be a non-empty text, a number or true/false.",
        );
    for (const [name, value] of [
        ["taskKey", taskKey],
        ["path", path],
    ] as const)
        if (value !== undefined && typeof value !== "string")
            throw new ApiBadRequestError(`itemFilter.${name} must be text.`);
    if (taskKey !== undefined && input.audioRunMode === "stt_metrics")
        throw new ApiBadRequestError(
            'Speech-to-text metrics runs have no benchmark tasks: filter them with itemFilter.path, e.g. { path: "$.language", equals: "hindi" }.',
        );
    return withPath(input.benchmark, {
        taskKey: taskKey as string | undefined,
        path: path as string | undefined,
        equals,
    });
}

function isFilterValue(value: unknown): value is IRunItemFilter["equals"] {
    if (typeof value === "string")
        return value.trim() !== "" && value.length <= MAX_FILTER_TEXT;
    return (
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
    );
}

/** The filter with `path` resolved from its task, checked. */
function withPath(
    benchmark: ICreateRunRequest["benchmark"],
    { taskKey, path, equals }: IRunItemFilter,
): IRunItemFilter {
    const resolvedPath = taskKey ? taskFieldPath(benchmark, taskKey) : path;
    if (!resolvedPath)
        throw new ApiBadRequestError(
            "itemFilter needs a taskKey (a benchmark task) or a path into the stored answer.",
        );
    if (path !== undefined && path !== resolvedPath)
        throw new ApiBadRequestError(
            `itemFilter.path ${path} is not task ${taskKey}'s field (${resolvedPath}).`,
        );
    if (!benchmarkPathSegments(resolvedPath))
        throw new ApiBadRequestError(
            `itemFilter.path "${resolvedPath}" is not a $.field path.`,
        );
    return {
        ...(taskKey ? { taskKey } : {}),
        path: resolvedPath,
        equals,
    };
}

function taskFieldPath(
    benchmark: ICreateRunRequest["benchmark"],
    taskKey: string,
): string {
    const task = benchmark?.taskMap.tasks.find(
        (entry) => entry.key === taskKey,
    );
    if (!task)
        throw new ApiBadRequestError(
            `itemFilter.taskKey "${taskKey}" is not a task in the run's benchmark.`,
        );
    if (task.method !== "agreement" || task.fields.length !== 1)
        throw new ApiBadRequestError(
            `itemFilter.taskKey "${taskKey}" must be a task that compares one field.`,
        );
    return task.fields[0]!.path;
}

/**
 * The items whose stored answer matches the filter, in their order. Items
 * without a stored answer never match. Refuses a filter no item matches.
 */
export async function filterItemsByLabel<T extends { id: string }>(
    db: IDb,
    items: T[],
    filter: IRunItemFilter | undefined,
): Promise<T[]> {
    if (!filter?.path || items.length === 0) return items;
    const matching = await matchingItemIds(
        db,
        items,
        filter.path,
        filter.equals,
    );
    const kept = items.filter((item) => matching.has(item.id));
    if (kept.length === 0)
        throw new ApiBadRequestError(
            `No item's stored answer has ${filter.path} equal to "${String(filter.equals)}".`,
        );
    return kept;
}

/** Ids of the items whose stored answer has `equals` at `path`. */
async function matchingItemIds(
    db: IDb,
    items: Array<{ id: string }>,
    path: string,
    equals: IRunItemFilter["equals"],
): Promise<Set<string>> {
    const labels = await db.query<{
        dataset_item_id: string;
        label_json: unknown;
    }>(
        `select dataset_item_id, label_json from labels
        where dataset_item_id = any($1::uuid[])`,
        [items.map((item) => item.id)],
    );
    return new Set(
        labels.rows
            .filter((row) =>
                itemFilterMatches(
                    valueAtBenchmarkPath(row.label_json, path),
                    equals,
                ),
            )
            .map((row) => row.dataset_item_id),
    );
}

/**
 * How many of a dataset's items a filter keeps, by the same rule run
 * creation uses, so a cost estimate can count only those. A count of 0 is
 * returned, not refused: creating the run is what refuses it.
 */
export async function countItemFilterMatchesPayload(
    db: IDb,
    input: ICountItemFilterMatchesRequest,
): Promise<ICountItemFilterMatchesResponse> {
    const filter = resolveItemFilter({
        itemFilter: { path: input.path, equals: input.equals },
    });
    const dataset = await db.query<{ id: string }>(
        `select id from datasets
        where id = $1 and team_id = $2 and project_id = $3
            and archived_at is null
        limit 1`,
        [input.datasetId, input.teamId, input.projectId],
    );
    if (!dataset.rows[0]) throw new ApiNotFoundError("Dataset not found");
    const items = await db.query<{ id: string }>(
        `select id from dataset_items where dataset_id = $1`,
        [input.datasetId],
    );
    if (!filter?.path || items.rows.length === 0)
        return { matching: 0, total: items.rows.length };
    const matching = await matchingItemIds(
        db,
        items.rows,
        filter.path,
        filter.equals,
    );
    return { matching: matching.size, total: items.rows.length };
}
