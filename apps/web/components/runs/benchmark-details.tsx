import type {
    BenchmarkSampleSize,
    BenchmarkSource,
    IBenchmarkClassResult,
    IBenchmarkModelSummary,
    IBenchmarkTaskSummary,
} from "@flash-evals/api-contract";
import { points } from "@flash-evals/api-contract";
import { Card } from "@/components/ui/card";
import { HintText } from "@/components/ui/hint";
import { Num } from "@/components/ui/num";
import { BenchmarkTaskVerdictBadge } from "@/components/ui/status-badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { MISSING_VALUE, fmtPercent } from "@/lib/format";
import { cn } from "@/lib/cn";

const SAMPLE_SIZE_NOTE: Record<BenchmarkSampleSize, string | undefined> = {
    insufficient: "Too few to judge",
    uncertain: "Small sample",
    sufficient: undefined,
};

const METRIC_LABEL: Record<
    IBenchmarkTaskSummary["assessment"]["metric"],
    string
> = {
    agreement: "Agreement",
    winOrTieRate: "Won or tied",
};

/** What a task was compared with, e.g. "vs stored answers". */
export function taskSourceLabel(
    source: BenchmarkSource | undefined,
    referenceName: string | undefined,
): string | undefined {
    if (source === "labels") return "vs stored answers";
    if (source === "model")
        return referenceName ? `vs ${referenceName}` : "vs today's model";
    return undefined;
}

/**
 * The target: a fixed rate ("90%+"), or, when compared with the reference
 * model, its own rate minus the allowed drop with the measured difference
 * ("≤ 2 pts below Sonnet's own 65%" / "+3.0 points (95% CI …)"). Judged
 * tasks compare won-or-tied rates the same way.
 */
function TaskTarget({
    task,
    referenceName,
}: {
    task: IBenchmarkTaskSummary;
    referenceName: string;
}) {
    const reference = task.assessment.reference;
    if (!reference)
        return <Num>{`${fmtPercent(task.assessment.threshold)}+`}</Num>;
    const drop = Math.round(reference.maxDrop * 1000) / 10;
    return (
        <span className="inline-flex flex-col items-end">
            <Num>{`${fmtPercent(task.assessment.threshold)}+`}</Num>
            <span className="text-label-12 text-muted-foreground">
                {`≤ ${drop} pts below ${referenceName}'s own ${fmtPercent(reference.value)}`}
            </span>
            <span className="text-label-12 text-muted-foreground">
                <Num>{points(reference.difference)}</Num>
                {reference.interval &&
                    ` (95% CI ${points(reference.interval.low)} to ${points(reference.interval.high)})`}
            </span>
        </span>
    );
}

/** Value with its 95% interval underneath, e.g. "92%" / "85.1–96.3%". */
function RateWithInterval({ task }: { task: IBenchmarkTaskSummary }) {
    const { value, interval } = task.assessment;
    return (
        <span className="inline-flex flex-col items-end">
            <Num>{fmtPercent(value)}</Num>
            {interval && (
                <span className="text-label-12 text-muted-foreground">
                    {`95% CI ${fmtPercent(interval.low)} to ${fmtPercent(interval.high)}`}
                </span>
            )}
        </span>
    );
}

function TaskItems({ task }: { task: IBenchmarkTaskSummary }) {
    const note = SAMPLE_SIZE_NOTE[task.assessment.sampleSize];
    return (
        <span className="inline-flex flex-col items-end">
            <Num>{task.n}</Num>
            {note && (
                <span className="text-label-12 text-muted-foreground">
                    {note}
                </span>
            )}
        </span>
    );
}

function TaskTable({
    tasks,
    referenceName,
}: {
    tasks: IBenchmarkTaskSummary[];
    referenceName: string | undefined;
}) {
    return (
        <Table className="min-w-max [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <TableHeader>
                <TableRow className="hover:bg-transparent">
                    <TableHead>Task</TableHead>
                    <TableHead>Measured by</TableHead>
                    <TableHead align="numeric">Result</TableHead>
                    <TableHead align="numeric">Target</TableHead>
                    <TableHead align="numeric">Items</TableHead>
                    <TableHead align="numeric">
                        <HintText hint="Judged items only: the model's answer was better than, as good as, or worse than the one it was compared with.">
                            Wins / ties / losses
                        </HintText>
                    </TableHead>
                    <TableHead align="numeric">
                        <HintText hint="Items the judge or scorer could not score. They are left out of the result.">
                            Errors
                        </HintText>
                    </TableHead>
                    <TableHead>Verdict</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {tasks.map((task) => {
                    const judged = task.wins + task.ties + task.losses > 0;
                    return (
                        <TableRow key={task.key}>
                            <TableCell className="text-label-14 text-on-surface">
                                <span className="inline-flex flex-col">
                                    {task.name}
                                    {task.source && (
                                        <span className="text-label-12 text-muted-foreground">
                                            {taskSourceLabel(
                                                task.source,
                                                referenceName,
                                            )}
                                        </span>
                                    )}
                                </span>
                            </TableCell>
                            <TableCell>
                                {METRIC_LABEL[task.assessment.metric]}
                            </TableCell>
                            <TableCell align="numeric">
                                <RateWithInterval task={task} />
                            </TableCell>
                            <TableCell align="numeric">
                                <TaskTarget
                                    task={task}
                                    referenceName={
                                        referenceName ?? "Today's model"
                                    }
                                />
                            </TableCell>
                            <TableCell align="numeric">
                                <TaskItems task={task} />
                            </TableCell>
                            <TableCell align="numeric">
                                <Num>
                                    {judged
                                        ? `${task.wins} / ${task.ties} / ${task.losses}`
                                        : MISSING_VALUE}
                                </Num>
                            </TableCell>
                            <TableCell align="numeric">
                                <Num
                                    className={cn(
                                        task.errors > 0
                                            ? "text-danger"
                                            : "text-muted-foreground",
                                    )}
                                >
                                    {task.errors}
                                </Num>
                            </TableCell>
                            <TableCell>
                                <BenchmarkTaskVerdictBadge
                                    verdict={task.assessment.verdict}
                                />
                            </TableCell>
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    );
}

/**
 * A classification task's results per label: for the items whose yardstick
 * has each label, how many the model got right and missed, and what it
 * answered instead.
 */
export function ClassResults({
    task,
    referenceName,
}: {
    task: IBenchmarkTaskSummary & { classes: IBenchmarkClassResult[] };
    referenceName: string | undefined;
}) {
    // "the stored answer", but "Big Model's answer" (no article before a name).
    const yardstick =
        task.source === "labels"
            ? "the stored answer"
            : referenceName
              ? `${referenceName}'s answer`
              : "today's model's answer";
    return (
        <section className="flex flex-col gap-2">
            <h3 className="text-label-14 text-on-surface">
                {`${task.name}: results per label`}
            </h3>
            <p className="text-copy-14 text-muted-foreground">
                {`Grouped by ${yardstick}. Failed items are not counted here.`}
                {task.classesSkipped
                    ? ` ${task.classesSkipped} item${task.classesSkipped === 1 ? "" : "s"} left out: an answer was a list or object, not one label.`
                    : ""}
            </p>
            <Table className="min-w-max [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead>Label</TableHead>
                        <TableHead align="numeric">Right</TableHead>
                        <TableHead align="numeric">Missed</TableHead>
                        <TableHead align="numeric">
                            <HintText hint="Share of the items with this label that the model also gave this label (recall).">
                                Found
                            </HintText>
                        </TableHead>
                        <TableHead align="numeric">
                            <HintText hint="Items the model gave this label when the answer it was compared with said something else.">
                                Given wrongly
                            </HintText>
                        </TableHead>
                        <TableHead>Missed items answered as</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {task.classes.map((entry) => (
                        <TableRow key={entry.label}>
                            <TableCell className="text-label-14 text-on-surface">
                                {entry.label}
                            </TableCell>
                            <TableCell align="numeric">
                                <Num>{`${entry.correct} of ${entry.total}`}</Num>
                            </TableCell>
                            <TableCell align="numeric">
                                <Num
                                    className={cn(
                                        entry.missed > 0
                                            ? "text-danger"
                                            : "text-muted-foreground",
                                    )}
                                >
                                    {entry.missed}
                                </Num>
                            </TableCell>
                            <TableCell align="numeric">
                                <Num>{fmtPercent(entry.recall)}</Num>
                            </TableCell>
                            <TableCell align="numeric">
                                <Num>{entry.wronglyGiven}</Num>
                            </TableCell>
                            <TableCell className="text-copy-14 text-muted-foreground">
                                {entry.confusions.length > 0
                                    ? entry.confusions
                                          .map(
                                              (confusion) =>
                                                  `${confusion.predicted} (${confusion.count})`,
                                          )
                                          .join(", ")
                                    : MISSING_VALUE}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </section>
    );
}

function hasClasses(
    task: IBenchmarkTaskSummary,
): task is IBenchmarkTaskSummary & { classes: IBenchmarkClassResult[] } {
    return (task.classes?.length ?? 0) > 0;
}

/** A model's verdict reasons and its result on each task, with 95% intervals. */
export function ModelDetails({
    model,
    id,
    isReference,
    referenceName,
}: {
    model: IBenchmarkModelSummary;
    id: string;
    isReference: boolean;
    referenceName: string | undefined;
}) {
    const reasons = model.assessment?.reasons ?? [];
    return (
        // Zero width with a full minimum: the card fills the row without
        // widening the table, so reasons wrap and the task table scrolls.
        <Card
            variant="inset"
            id={id}
            className="flex w-0 min-w-full flex-col gap-4 p-4 whitespace-normal"
        >
            {model.isBenchmark && (
                <p className="text-copy-14 text-muted-foreground">
                    The other models are compared with this model&apos;s
                    answers, so it is scored only on the tasks compared with the
                    stored answers.
                </p>
            )}
            {isReference && !model.isBenchmark && (
                <p className="text-copy-14 text-muted-foreground">
                    This is today&apos;s model, the baseline for cost. Its
                    results show how well it matches the stored answers. They
                    are shown for comparison, not judged: the other models are
                    held to its own rates on the same transcripts.
                </p>
            )}
            {isReference || model.isReference ? null : reasons.length > 0 ? (
                <div className="flex flex-col gap-2">
                    <h3 className="text-label-14 text-on-surface">
                        Why this verdict
                    </h3>
                    <ul className="flex list-disc flex-col gap-1 pl-4 text-copy-14 text-on-surface">
                        {reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                        ))}
                    </ul>
                </div>
            ) : (
                <p className="text-copy-14 text-on-surface">
                    Meets every target with enough items to be confident.
                </p>
            )}
            {model.tasks.length > 0 ? (
                <>
                    <TaskTable
                        tasks={model.tasks}
                        referenceName={referenceName}
                    />
                    {model.tasks.filter(hasClasses).map((task) => (
                        <ClassResults
                            key={task.key}
                            task={task}
                            referenceName={referenceName}
                        />
                    ))}
                </>
            ) : (
                <p className="text-copy-14 text-muted-foreground">
                    No tasks have been compared yet.
                </p>
            )}
        </Card>
    );
}
