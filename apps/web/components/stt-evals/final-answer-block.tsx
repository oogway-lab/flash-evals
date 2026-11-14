"use client";

import type { IWorkflowRunAnswer } from "@flash-evals/api-contract";
import { Badge } from "@/components/ui/badge";
import { JsonBlock } from "@/components/ui/json-block";
import { Num } from "@/components/ui/num";
import { fmtScore, type formatCostColumn } from "@/lib/format";
import { formatPossiblyPartialCost } from "@/components/runs/stt-variant-display";

/** One item's final answer under its steps: the JSON, its schema check and cost. */
export function FinalAnswerBlock({
    answer,
    fmtCost,
    costIncomplete = false,
}: {
    answer: IWorkflowRunAnswer | undefined;
    fmtCost: ReturnType<typeof formatCostColumn>;
    /** Some step's cost is unknown, so the total is a lower bound. */
    costIncomplete?: boolean;
}) {
    return (
        <section
            aria-label="Final answer"
            className="flex flex-col gap-2 px-4 pb-4"
        >
            <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-label-14 text-on-surface">Final answer</h4>
                {answer?.status === "failed" ? (
                    <Badge variant="danger">A step failed</Badge>
                ) : null}
                {answer?.schemaErrors?.length ? (
                    <Badge variant="warning">
                        Doesn&apos;t match the schema
                    </Badge>
                ) : null}
                {answer?.costUsd !== undefined ? (
                    <span className="text-label-12 text-muted-foreground">
                        <Num>
                            {formatPossiblyPartialCost(
                                answer.costUsd,
                                costIncomplete,
                                fmtCost,
                            )}
                        </Num>{" "}
                        for all steps
                    </span>
                ) : null}
                {answer?.benchmarkScore !== undefined ? (
                    <span className="text-label-12 text-muted-foreground">
                        Score against the reference{" "}
                        <Num>{fmtScore(answer.benchmarkScore)}</Num>
                        {answer.judgeCostUsd !== undefined ? (
                            <>
                                {" "}
                                (judging{" "}
                                <Num>{fmtCost(answer.judgeCostUsd)}</Num>)
                            </>
                        ) : null}
                    </span>
                ) : null}
            </div>
            {answer?.answer ? (
                <JsonBlock data={answer.answer} collapsible />
            ) : (
                <p className="text-copy-14 text-muted-foreground">
                    Appears when every step for this item has finished.
                </p>
            )}
            {answer?.schemaErrors?.length ? (
                <ul className="flex list-disc flex-col gap-1 pl-4 text-copy-14 text-muted-foreground">
                    {answer.schemaErrors.map((error) => (
                        <li key={`${error.path}:${error.message}`}>
                            <span className="text-mono-13">{error.path}</span>{" "}
                            {error.message}
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}
