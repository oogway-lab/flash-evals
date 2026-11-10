import {
    DEFAULT_BENCHMARK_POLICY,
    isJudgedTask,
    isSelfScoredTask,
    type BenchmarkSource,
    type IBenchmarkPolicy,
    type IBenchmarkTask,
} from "@flash-evals/api-contract";

/**
 * True when today's model is scored on the task too (rule checks, rubrics,
 * and tasks against the stored answers), so other models are compared with
 * its own rate item by item.
 */
function referenceScoredToo(
    task: IBenchmarkTask,
    source: BenchmarkSource | undefined,
): boolean {
    return isSelfScoredTask(task) || source === "labels";
}

function fmtNumber(value: number): string {
    return String(Math.round(value * 10) / 10);
}

/**
 * A task's target for the models compared with today's model, in plain
 * words: "≤ 2 pts below Sonnet's own rate" where today's model is scored too
 * and a drop is allowed, else "won or tied 90%+" or "90%+". Values are in
 * points and percent, as typed in the form.
 */
export function taskTargetText(input: {
    task: IBenchmarkTask;
    source: BenchmarkSource | undefined;
    maxDropPts?: number;
    minAgreementPct: number;
    minWinOrTiePct: number;
    referenceName: string | undefined;
}): string {
    if (
        input.maxDropPts !== undefined &&
        referenceScoredToo(input.task, input.source)
    )
        return `≤ ${fmtNumber(input.maxDropPts)} pts below ${input.referenceName ?? "today's model"}'s own rate`;
    return isJudgedTask(input.task)
        ? `won or tied ${fmtNumber(input.minWinOrTiePct)}%+`
        : `${fmtNumber(input.minAgreementPct)}%+`;
}

/** `taskTargetText` from a run's saved policy (rates 0 to 1). */
export function taskTargetFromPolicy(input: {
    task: IBenchmarkTask;
    source: BenchmarkSource | undefined;
    policy: IBenchmarkPolicy | undefined;
    referenceName: string | undefined;
}): string {
    const override = input.policy?.tasks?.[input.task.key];
    const maxDrop =
        override?.maxDropBelowReference ?? input.policy?.maxDropBelowReference;
    return taskTargetText({
        task: input.task,
        source: input.source,
        ...(maxDrop !== undefined ? { maxDropPts: maxDrop * 100 } : {}),
        minAgreementPct:
            (override?.minAgreement ??
                input.policy?.minAgreement ??
                DEFAULT_BENCHMARK_POLICY.minAgreement) * 100,
        minWinOrTiePct:
            (override?.minWinOrTieRate ??
                input.policy?.minWinOrTieRate ??
                DEFAULT_BENCHMARK_POLICY.minWinOrTieRate) * 100,
        referenceName: input.referenceName,
    });
}
