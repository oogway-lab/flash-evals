import {
    benchmarkUsesSource,
    type IBenchmarkCellDetails,
    type IRunBenchmarkConfig,
} from "@flash-evals/api-contract";

/**
 * Cells the scoring phase handles: ones this pass generated, ones never
 * scored (a worker died between phases), and, on benchmark runs, every
 * candidate for an item whose benchmark answer was just regenerated.
 */
export function cellsToScore<
    T extends {
        id: string;
        datasetItemId: string;
        runModelId: string;
        status: string;
    },
>(input: {
    cells: T[];
    claimed: Array<Pick<T, "id" | "datasetItemId" | "runModelId">>;
    scoredCellIds: Set<string>;
    referenceModelId: string | undefined;
    benchmark: IRunBenchmarkConfig | undefined;
}): T[] {
    const claimedIds = new Set(input.claimed.map((cell) => cell.id));
    const rebenchmarkedItems = rebenchmarkedItemIds(input);
    return input.cells.filter(
        (cell) =>
            (claimedIds.has(cell.id) ||
                !input.scoredCellIds.has(cell.id) ||
                rebenchmarkedItems.has(cell.datasetItemId)) &&
            (cell.status === "succeeded" || cell.status === "cached"),
    );
}

interface IScoringSelection {
    claimed: Array<{ id: string; datasetItemId: string; runModelId: string }>;
    referenceModelId: string | undefined;
    benchmark: IRunBenchmarkConfig | undefined;
}

/** Items whose benchmark answer this pass regenerated. */
function rebenchmarkedItemIds(input: IScoringSelection): Set<string> {
    return new Set(
        input.benchmark && benchmarkUsesSource(input.benchmark, "model")
            ? input.claimed
                  .filter((cell) => cell.runModelId === input.referenceModelId)
                  .map((cell) => cell.datasetItemId)
            : [],
    );
}

/**
 * The earlier benchmark details to keep for a cell scored again only because
 * a judge call failed. A cell with a new answer, or whose item has a new
 * benchmark answer, is scored from scratch: its old verdicts no longer apply.
 */
export function priorBenchmarkToKeep(
    cell: { id: string; datasetItemId: string },
    input: IScoringSelection & { toRetry: Map<string, IBenchmarkCellDetails> },
): IBenchmarkCellDetails | undefined {
    const previous = input.toRetry.get(cell.id);
    if (!previous) return undefined;
    if (input.claimed.some((claimedCell) => claimedCell.id === cell.id))
        return undefined;
    if (rebenchmarkedItemIds(input).has(cell.datasetItemId)) return undefined;
    return previous;
}

/**
 * Whether a cell's earlier judge verdicts still apply when it is scored
 * again (a failed benchmark task, a scoring crash, a pass that died between
 * phases): its answer was not regenerated this pass, nor was the reference
 * answer its judges compared it with.
 */
export function paidVerdictsStillApply(
    cell: { id: string; datasetItemId: string },
    input: Pick<IScoringSelection, "claimed" | "referenceModelId">,
): boolean {
    return !input.claimed.some(
        (claimedCell) =>
            claimedCell.id === cell.id ||
            (input.referenceModelId !== undefined &&
                claimedCell.runModelId === input.referenceModelId &&
                claimedCell.datasetItemId === cell.datasetItemId),
    );
}

interface IStoredScore {
    scorerType: string;
    score: number | null;
    detailsJson: unknown;
    rationale: string | null;
}

/**
 * The paid verdicts to keep when a cell is scored again with the same answer
 * (see paidVerdictsStillApply): a judge or transcript judge that gave a
 * score. Failed ones (no score) are asked again; free scorers are recomputed.
 */
export function paidScoresToKeep<T extends IStoredScore>(
    scores: T[],
): { judge?: T; transcriptJudge?: T } {
    const succeeded = (type: string) =>
        scores.find((row) => row.scorerType === type && row.score !== null);
    const judge = succeeded("judge");
    const transcriptJudge = succeeded("transcript_judge");
    return {
        ...(judge ? { judge } : {}),
        ...(transcriptJudge ? { transcriptJudge } : {}),
    };
}
