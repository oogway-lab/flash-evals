"use client";

import type { Route } from "next";
import Link from "next/link";
import type {
    ILeaderboardRow,
    IRunConfigSnapshot,
    IRunContext,
} from "@flash-evals/api-contract";
import { fmtCost, fmtDate } from "@/lib/format";
import { HintText } from "@/components/ui/hint";
import { Num } from "@/components/ui/num";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { RunStatusBadge } from "@/components/ui/status-badge";
import { RunStatusNotice } from "@/components/runs/run-status-notice";
import { cn } from "@/lib/cn";
import {
    isActiveRunStatus,
    progressPercent,
    settledCells,
    useRunProgress,
    type IRunProgressSnapshot,
    type RunProgressConnection,
} from "@/components/runs/use-run-progress";

const connectionLabels: Record<
    Exclude<RunProgressConnection, "idle">,
    string
> = {
    live: "Updating live",
    reconnecting: "Reconnecting…",
    paused: "Updates paused",
};

/** One label over one value, with an optional detail line under it. */
function Stat({
    label,
    value,
    detail,
    live,
    className,
}: {
    label: string;
    value: React.ReactNode;
    detail?: React.ReactNode;
    live?: boolean;
    className?: string;
}) {
    return (
        <div className={cn("flex min-w-0 flex-col gap-1", className)}>
            <dt className="text-label-12 text-muted-foreground">{label}</dt>
            <dd className="flex min-w-0 flex-col gap-1">
                <span className="text-stat-32 text-on-surface">{value}</span>
                {detail && (
                    <span
                        aria-live={live ? "polite" : undefined}
                        className="text-copy-14 text-muted-foreground"
                    >
                        {detail}
                    </span>
                )}
            </dd>
        </div>
    );
}

const sumOf = (values: number[]) =>
    values.length > 0 ? values.reduce((a, b) => a + b, 0) : undefined;

/** Model calls plus the judge calls that scored them. */
export function totalCost(rows: ILeaderboardRow[]) {
    const models = sumOf(
        rows.flatMap((r) =>
            r.totalCostUsd === undefined ? [] : [r.totalCostUsd],
        ),
    );
    const judging = sumOf(
        rows.flatMap((r) =>
            r.totalJudgeCostUsd === undefined ? [] : [r.totalJudgeCostUsd],
        ),
    );
    return {
        total: sumOf([models, judging].filter((v) => v !== undefined)),
        judging,
        complete: rows.length > 0 && rows.every((r) => r.costAvailable),
    };
}

function costDetail(
    { total, judging, complete }: ReturnType<typeof totalCost>,
    models: number,
): string {
    if (total === undefined) return "No cost reported.";
    const scope = complete
        ? `Across ${models} ${models === 1 ? "model" : "models"}`
        : "Some cells reported no cost";
    const sentence = complete ? scope : `${scope}.`;
    return judging
        ? `${complete ? `${scope}.` : sentence} Includes ${fmtCost(judging)} for judging.`
        : sentence;
}

function CostStat({ rows }: { rows: ILeaderboardRow[] }) {
    const cost = totalCost(rows);
    return (
        <Stat
            label="Total cost"
            value={<Num>{fmtCost(cost.total)}</Num>}
            detail={costDetail(cost, rows.length)}
        />
    );
}

/**
 * What to say under the cell count. While the run is active the percentage
 * counts settled cells (done plus failed), so it reaches 100% even when some
 * cells failed; failures are named in text. A finished run only says "All
 * complete" when every cell succeeded; a run that stopped with cells still
 * unfinished says how many.
 */
function cellsDetail(data: IRunProgressSnapshot, active: boolean) {
    const failed = data.failed > 0 ? `${data.failed} failed` : undefined;
    if (active) {
        const percent = progressPercent(settledCells(data), data.total);
        return [`${percent}% complete`, failed].filter(Boolean).join(" · ");
    }
    if (data.total === 0) return "No cells";
    if (data.done === data.total) return "All complete";
    const unfinished = data.total - settledCells(data);
    const pending =
        unfinished > 0
            ? `${unfinished} ${data.status === "cancelled" ? "not run" : "pending"}`
            : undefined;
    return [failed, pending].filter(Boolean).join(" · ");
}

function CellsStat({
    data,
    active,
}: {
    data: IRunProgressSnapshot;
    active: boolean;
}) {
    return (
        <Stat
            label="Cells"
            value={
                <Num>
                    {data.done} / {data.total}
                </Num>
            }
            live
            detail={cellsDetail(data, active)}
        />
    );
}

function ConfigItem({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-label-12 text-muted-foreground">{label}</dt>
            <dd className="flex min-w-0 flex-col text-copy-14 text-on-surface">
                {children}
            </dd>
        </div>
    );
}

const linkClass =
    "w-fit max-w-full truncate rounded-sm text-accent-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** A link to a prompt with its version in muted text on the same line. */
function NameWithVersion({
    href,
    name,
    version,
}: {
    href: Route;
    name: string;
    version: number | undefined;
}) {
    return (
        <span className="flex min-w-0 items-baseline gap-1">
            <Link href={href} className={linkClass}>
                {name}
            </Link>
            {version !== undefined && (
                <span className="shrink-0 text-muted-foreground">
                    v{version}
                </span>
            )}
        </span>
    );
}

function PromptItem({ prompts }: { prompts: IRunContext["prompts"] }) {
    if (prompts.length === 0) return undefined;
    const first = prompts[0]!;
    if (prompts.length === 1) {
        return (
            <ConfigItem label="Prompt">
                <NameWithVersion
                    href={`/prompts/${first.promptId}` as Route}
                    name={first.name}
                    version={first.version}
                />
            </ConfigItem>
        );
    }
    return (
        <ConfigItem label="Prompts">
            <span>
                <HintText
                    hint={
                        <ul className="flex flex-col gap-1">
                            {prompts.map((p) => (
                                <li key={`${p.promptId}:${p.version}`}>
                                    {p.name} v{p.version}
                                </li>
                            ))}
                        </ul>
                    }
                >
                    {prompts.length} prompts
                </HintText>
            </span>
            <span className="text-muted-foreground">One per model</span>
        </ConfigItem>
    );
}

function judgeFor(
    context: IRunContext | undefined,
    snapshot: IRunConfigSnapshot,
): NonNullable<IRunContext["judge"]> | undefined {
    if (context?.judge) return context.judge;
    const evaluator = snapshot.sttConfig?.evaluator;
    return evaluator?.enabled ? { modelId: evaluator.modelId } : undefined;
}

function JudgeItem({
    judge,
}: {
    judge: NonNullable<IRunContext["judge"]> | undefined;
}) {
    if (!judge) return undefined;
    return (
        <ConfigItem label="Judge">
            {judge.promptName && judge.promptId ? (
                <NameWithVersion
                    href={`/prompts/${judge.promptId}` as Route}
                    name={judge.promptName}
                    version={judge.promptVersion}
                />
            ) : null}
            {judge.modelId && (
                <span
                    className={cn(
                        "w-fit max-w-full truncate text-mono-13",
                        judge.promptName && "text-muted-foreground",
                    )}
                >
                    {judge.modelId}
                </span>
            )}
        </ConfigItem>
    );
}

/**
 * Run status, what the run cost, its cells, and how it was configured. The
 * answer (which model wins) is the banner above it. While the run is active it polls for progress and
 * shows the live bar; once finished the bar disappears and only the cell
 * count stays.
 */
/** "Only items labelled "sales" for Call type", from the run's snapshot. */
export function itemFilterText(snapshot: IRunConfigSnapshot): string {
    const filter = snapshot.itemFilter;
    if (!filter) return "";
    const task = filter.taskKey
        ? snapshot.benchmark?.taskMap.tasks.find(
              (entry) => entry.key === filter.taskKey,
          )
        : undefined;
    const field = task?.name ?? filter.path ?? filter.taskKey ?? "";
    return `Only items labelled "${String(filter.equals)}" for ${field}`;
}

export function RunSummary({
    progressUrl,
    initial,
    leaderboard,
    configSnapshot,
    datasetId,
    createdAt,
    context,
    retryAction,
}: {
    progressUrl: string;
    initial: IRunProgressSnapshot;
    /** Offered when the run waits for a worker that hasn't taken it. */
    retryAction?: React.ReactNode;
    leaderboard: ILeaderboardRow[];
    configSnapshot: IRunConfigSnapshot;
    datasetId: string;
    createdAt: string;
    context?: IRunContext;
}) {
    const { data, connection } = useRunProgress(progressUrl, initial);
    const active = isActiveRunStatus(data.status);
    const percent = progressPercent(settledCells(data), data.total);
    const judge = judgeFor(context, configSnapshot);

    return (
        <section
            aria-label="Run summary"
            data-slot="run-summary"
            className="flex flex-col gap-6"
        >
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    <RunStatusBadge
                        status={data.status}
                        stopReason={data.stopReason}
                    />
                    {active && connection !== "idle" && (
                        <span className="flex items-center gap-2 text-copy-14 text-muted-foreground">
                            {connection === "reconnecting" && (
                                <Spinner size="sm" />
                            )}
                            {connectionLabels[connection]}
                        </span>
                    )}
                </div>
                {active && (
                    <Progress
                        aria-label="Run progress"
                        value={percent}
                        indeterminate={data.total === 0}
                    />
                )}
                <RunStatusNotice
                    data={data}
                    maxCostUsd={configSnapshot.maxCostUsd}
                    retryAction={retryAction}
                />
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <CostStat rows={leaderboard} />
                <CellsStat data={data} active={active} />
            </dl>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-4 sm:grid-cols-4">
                <ConfigItem label="Dataset">
                    <Link
                        href={`/datasets/${datasetId}` as Route}
                        className={linkClass}
                    >
                        {context?.datasetName ?? "View dataset"}
                    </Link>
                </ConfigItem>
                <PromptItem prompts={context?.prompts ?? []} />
                <JudgeItem judge={judge} />
                {configSnapshot.itemFilter && (
                    <ConfigItem label="Items">
                        {itemFilterText(configSnapshot)}
                    </ConfigItem>
                )}
                {configSnapshot.maxCostUsd !== undefined && (
                    <ConfigItem label="Spend limit">
                        <Num>{fmtCost(configSnapshot.maxCostUsd)}</Num>
                    </ConfigItem>
                )}
                <ConfigItem label="Created">
                    <time dateTime={createdAt}>{fmtDate(createdAt)}</time>
                </ConfigItem>
            </dl>
        </section>
    );
}
