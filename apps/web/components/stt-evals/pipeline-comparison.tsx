import type { Route } from "next";
import Link from "next/link";
import type { IPipelineComparison, RunStatus } from "@flash-evals/api-contract";
import { SectionTitle } from "@/components/layout/section-title";
import { ModelsTable } from "@/components/runs/models-table";
import { RunAnswer } from "@/components/runs/run-answer";
import {
    buildPipelineComparisonResults,
    describeRunAnswer,
} from "@/components/runs/run-results";
import { runTitle } from "@/components/runs/run-title";
import { TaskGrid } from "@/components/runs/task-grid";
import type { IModelInfo } from "@/server/runs/modelInfo";
import { plural } from "@/lib/format";
import { describeDataRules } from "./run-settings";

/**
 * A pipeline run compared with an eval run: the eval run page's answer,
 * task grid and models table, with the pipeline as the one candidate and
 * the eval run's reference shown as "Reference". Sits above the item
 * outputs.
 */
export function PipelineComparison({
    comparison,
    pipelineName,
    referenceName,
    referenceInfo,
    runStatus,
}: {
    comparison: IPipelineComparison;
    pipelineName: string;
    referenceName?: string;
    referenceInfo?: IModelInfo;
    runStatus: RunStatus;
}) {
    const results = buildPipelineComparisonResults({
        comparison,
        pipelineName,
        ...(referenceName ? { referenceName } : {}),
        ...(referenceInfo ? { referenceInfo } : {}),
    });
    const active = runStatus === "pending" || runStatus === "running";
    const answer = describeRunAnswer({
        results,
        leaderboard: [],
        comparison: comparison.summary,
        active,
    });
    const title = runTitle(comparison.run.id, comparison.run.noteTitle);
    const reference = results.find((result) => result.isReference);
    const judgeRules = comparison.judgeDataPolicy
        ? describeDataRules(comparison.judgeDataPolicy)
        : "";
    return (
        <section
            aria-labelledby="pipeline-comparison"
            className="flex flex-col gap-6"
        >
            <SectionTitle
                id="pipeline-comparison"
                description={
                    <>
                        {`Each item's final answer against ${
                            reference
                                ? `${reference.name}'s answers in `
                                : "the stored answers used by "
                        }`}
                        {comparison.run.status ? (
                            <Link
                                href={`/runs/${comparison.run.id}` as Route}
                                className="text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            >
                                {title}
                            </Link>
                        ) : (
                            title
                        )}
                        {`, with that run's Task Map, targets and judge${
                            judgeRules
                                ? ` (judge data rules: ${judgeRules})`
                                : ""
                        }. Cost per call is one item's cost, the sum of its steps, averaged over the compared items, failed ones included, for both rows.`}
                    </>
                }
            >
                {`Compared with ${title}`}
            </SectionTitle>
            {!comparison.run.status && (
                <p role="status" className="text-copy-14 text-muted-foreground">
                    That run has since been deleted, so its reference answers
                    are no longer shown.
                </p>
            )}
            {comparison.unscoredItems > 0 && (
                <p role="status" className="text-copy-14 text-muted-foreground">
                    {`${plural(comparison.unscoredItems, "final answer")} not compared yet. ${
                        active
                            ? "They are scored once every item has finished."
                            : "Resume the run to compare them."
                    }`}
                </p>
            )}
            <RunAnswer answer={answer} />
            <div className="flex flex-col gap-4">
                <SectionTitle
                    as="h3"
                    description="The pipeline's result on each task, against the task's target."
                >
                    Task by task
                </SectionTitle>
                <TaskGrid results={results} benchmark={comparison.benchmark} />
            </div>
            <div className="flex flex-col gap-4">
                <SectionTitle as="h3">Pipeline and reference</SectionTitle>
                <ModelsTable results={results} runStatus={runStatus} />
            </div>
        </section>
    );
}
