"use client";

import type { Route } from "next";
import Link from "next/link";
import type {
    ILeaderboardRow,
    IRunConfigSnapshot,
    IRunContext,
} from "@mosaic/api-contract";
import { fmtCost, fmtDate, fmtScore, MISSING_VALUE } from "@/lib/format";
import { HintText } from "@/components/ui/hint";
import { Num } from "@/components/ui/num";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { RunStatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";
import {
    summarizeBestModel,
    type IBestModelSummary,
} from "@/components/runs/best-model";
import { sttVariantDisplay } from "@/components/runs/stt-variant-display";
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

const METRIC_LABELS = {
    judge: "judge score",
    transcript: "transcript score",
} as const;

function modelLabel(snapshot: IRunConfigSnapshot, modelId: string) {
    const variant = sttVariantDisplay(snapshot, modelId);
    return variant
        ? { text: variant.label, mono: false }
        : { text: modelId, mono: true };
}

function ModelName({
    snapshot,
    modelId,
}: {
    snapshot: IRunConfigSnapshot;
    modelId: string;
}) {
    const { text, mono } = modelLabel(snapshot, modelId);
    return (
        <span className={cn("text-on-surface", mono && "text-mono-13")}>
            {text}
        </span>
    );
}

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

function BestModelStat({
    rows,
    active,
    snapshot,
}: {
    rows: ILeaderboardRow[];
    active: boolean;
    snapshot: IRunConfigSnapshot;
}) {
    const best = summarizeBestModel(rows);
    // A single-model run has no winner, only a score.
    const label =
        rows.length < 2 ? "Score" : active ? "Leading model" : "Best model";
    if (!best) {
        return (
            <Stat
                label={label}
                value={<Num>{MISSING_VALUE}</Num>}
                detail={
                    active
                        ? "Scores appear as cells finish."
                        : "No scores recorded for this run."
                }
                className="col-span-2 sm:col-span-1"
            />
        );
    }
    return (
        <Stat
            label={label}
            value={<Num>{fmtScore(best.score)}</Num>}
            detail={
                <BestModelDetail best={best} rows={rows} snapshot={snapshot} />
            }
            className="col-span-2 sm:col-span-1"
        />
    );
}

function BestModelDetail({
    best,
    rows,
    snapshot,
}: {
    best: IBestModelSummary;
    rows: ILeaderboardRow[];
    snapshot: IRunConfigSnapshot;
}) {
    const metric = METRIC_LABELS[best.metric];
    const partial =
        best.scored < rows.length
            ? ` · ${best.scored} of ${rows.length} scored`
            : "";
    if (best.tied) {
        const names = best.modelIds.map((id) => modelLabel(snapshot, id).text);
        return (
            <>
                <HintText hint={names.join(", ")}>
                    {best.modelIds.length} models tied
                </HintText>
                {` · ${metric}${partial}`}
            </>
        );
    }
    return (
        <>
            <ModelName snapshot={snapshot} modelId={best.modelIds[0]!} />
            {` · ${metric}${partial}`}
        </>
    );
}

function totalCost(rows: ILeaderboardRow[]) {
    const known = rows.flatMap((r) =>
        r.totalCostUsd === undefined ? [] : [r.totalCostUsd],
    );
    return {
        total: known.length > 0 ? known.reduce((a, b) => a + b, 0) : undefined,
        complete: rows.length > 0 && rows.every((r) => r.costAvailable),
    };
}

function CostStat({ rows }: { rows: ILeaderboardRow[] }) {
    const { total, complete } = totalCost(rows);
    return (
        <Stat
            label="Total cost"
            value={<Num>{fmtCost(total)}</Num>}
            detail={
                total === undefined
                    ? "No cost reported."
                    : complete
                      ? `Across ${rows.length} ${rows.length === 1 ? "model" : "models"}`
                      : "Some cells reported no cost."
            }
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
    const pending = unfinished > 0 ? `${unfinished} pending` : undefined;
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
 * The top of a run page: what the run is, who is winning, what it cost, and
 * how it was configured. While the run is active it polls for progress and
 * shows the live bar; once finished the bar disappears and only the cell
 * count stays.
 */
export function RunSummary({
    progressUrl,
    initial,
    leaderboard,
    configSnapshot,
    datasetId,
    createdAt,
    context,
}: {
    progressUrl: string;
    initial: IRunProgressSnapshot;
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
                    <RunStatusBadge status={data.status} />
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
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                <BestModelStat
                    rows={leaderboard}
                    active={active}
                    snapshot={configSnapshot}
                />
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
                <ConfigItem label="Created">
                    <time dateTime={createdAt}>{fmtDate(createdAt)}</time>
                </ConfigItem>
            </dl>
        </section>
    );
}
