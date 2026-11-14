"use client";

import { useState } from "react";
import type { IRunBenchmarkConfig } from "@flash-evals/api-contract";
import {
    DisagreementReview,
    type DecideDisagreement,
    type IDisagreementTarget,
    type LoadDisagreements,
} from "./disagreement-review";
import type { IModelResult } from "./run-results";
import { TaskGrid } from "./task-grid";

/** The task grid, where each result opens the transcripts behind it. */
export function TaskGridWithReview({
    runId,
    results,
    benchmark,
    loadAction,
    decideAction,
}: {
    runId: string;
    results: IModelResult[];
    benchmark: IRunBenchmarkConfig;
    loadAction: LoadDisagreements;
    decideAction: DecideDisagreement;
}) {
    const [target, setTarget] = useState<IDisagreementTarget>();
    const reference = results.find((result) => result.isReference);
    return (
        <>
            <TaskGrid
                results={results}
                benchmark={benchmark}
                onOpenCell={(model, task) =>
                    setTarget({
                        runModelId: model.runModelId,
                        taskKey: task.key,
                        modelName: model.name,
                        taskName: task.name,
                    })
                }
            />
            <DisagreementReview
                runId={runId}
                target={target}
                referenceName={reference?.name}
                onClose={() => setTarget(undefined)}
                loadAction={loadAction}
                decideAction={decideAction}
            />
        </>
    );
}
