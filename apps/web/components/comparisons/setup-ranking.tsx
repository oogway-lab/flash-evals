import type {
    ISetupRanking,
    ISetupRankingRow,
    RunStatus,
} from "@flash-evals/api-contract";
import { SectionTitle } from "@/components/layout/section-title";
import { runPageHref } from "./comparison-members";
import { ModelsTable } from "@/components/runs/models-table";
import { RunAnswer } from "@/components/runs/run-answer";
import {
    buildSetupRankingResults,
    candidateNoun,
    describeRunAnswer,
} from "@/components/runs/run-results";
import { TaskGrid } from "@/components/runs/task-grid";
import type { IModelInfo } from "@/server/runs/modelInfo";

/** The run page a ranking row's answers come from. */
export function rankingRowHref(row: ISetupRankingRow): string {
    return runPageHref(
        row.runId,
        row.kind === "pipeline" ? row.workflowId : undefined,
    );
}

/**
 * Names the setups that stopped with fewer items finished than the others,
 * since they decide how many items every setup is compared on.
 */
export function finishedFewerNote(
    ranking: Pick<ISetupRanking, "finishedFewer">,
    results: ReadonlyArray<{ runModelId: string; name: string }>,
): string | undefined {
    const names = (ranking.finishedFewer ?? []).map(
        (id) => results.find((result) => result.runModelId === id)?.name ?? id,
    );
    if (names.length === 0) return undefined;
    return `${names.join(", ")} finished fewer items than the other setups (stopped early or ran on fewer items), so only those items are compared.`;
}

/**
 * Every setup of a comparison in one table: the answer from the eval run's
 * verdict code, the setups with accuracy, verdict, cost and progress (the
 * ones no other setup beats on accuracy and cost marked), and the task grid.
 */
export function SetupRanking({
    ranking,
    modelInfo,
    status,
}: {
    ranking: ISetupRanking;
    modelInfo: Record<string, IModelInfo>;
    status: RunStatus;
}) {
    const results = buildSetupRankingResults({
        ranking,
        modelInfo,
        hrefFor: rankingRowHref,
    });
    const active = status === "pending" || status === "running";
    const finishedFewer = finishedFewerNote(ranking, results);
    const answer = describeRunAnswer({
        results,
        leaderboard: [],
        comparison: ranking.summary,
        active,
        noun: candidateNoun(ranking.rows),
    });
    return (
        <section
            aria-labelledby="setup-ranking"
            className="flex flex-col gap-6"
        >
            <SectionTitle
                id="setup-ranking"
                description="Every setup against the model you use today, with the eval run's Task Map, targets and judge. A pipeline's cost per call is one item's cost, the sum of its steps."
            >
                Ranking
            </SectionTitle>
            <RunAnswer answer={answer} />
            <div className="flex flex-col gap-4">
                <ModelsTable
                    results={results}
                    runStatus={status}
                    rowLabel="Setup"
                />
                <p className="text-label-12 text-muted-foreground">
                    Accuracy is the average of a setup&apos;s task results
                    (agreement, or the won-or-tied rate for judged tasks);
                    today&apos;s model counts as 100% where it is the yardstick.
                    Not beaten on accuracy and cost: no other setup is at least
                    as accurate and costs no more per call while being better on
                    one of the two. Sorted by cost per call, cheapest first.
                    Accuracy, cost and time compare every setup on the same{" "}
                    {ranking.comparedItems}{" "}
                    {ranking.comparedItems === 1 ? "item" : "items"}: the ones
                    every setup with a result has finished.
                    {finishedFewer ? ` ${finishedFewer}` : null}
                </p>
            </div>
            <div className="flex flex-col gap-4">
                <SectionTitle
                    as="h3"
                    description="Each setup's result on each task, against the task's target."
                >
                    Task by task
                </SectionTitle>
                <TaskGrid results={results} benchmark={ranking.benchmark} />
            </div>
        </section>
    );
}
