"use client";

import { useMemo, useState } from "react";
import type { ILeaderboardRow, IRunConfigSnapshot } from "@mosaic/api-contract";
import {
    MISSING_VALUE,
    formatCostColumn,
    fmtDelta,
    fmtScore,
    fmtTokens,
} from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Hint, HintText } from "@/components/ui/hint";
import { Num } from "@/components/ui/num";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    ArrowDown,
    ArrowUp,
    ChevronsUpDown,
    Minus,
    Pin,
    Trophy,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { sttVariantDisplay } from "./stt-variant-display";
import { EmptyState } from "@/components/layout/empty-state";

type SortKey =
    | "avgJudgeScore"
    | "avgTranscriptScore"
    | "avgLatencyMs"
    | "avgTotalTokens"
    | "totalCostUsd";

type SortDirection = "asc" | "desc";

interface SortState {
    key: SortKey;
    direction: SortDirection;
}

// For score columns higher is better, so the natural "best first" view is
// descending; for cost/latency/tokens lower is better, so it is ascending.
const DEFAULT_DIRECTION: Record<SortKey, SortDirection> = {
    avgJudgeScore: "desc",
    avgTranscriptScore: "desc",
    avgLatencyMs: "asc",
    avgTotalTokens: "asc",
    totalCostUsd: "asc",
};

const COLUMN_LABEL: Record<SortKey, string> = {
    avgJudgeScore: "Judge score",
    avgTranscriptScore: "Transcript score",
    avgLatencyMs: "Avg latency",
    avgTotalTokens: "Tokens",
    totalCostUsd: "Total cost",
};

type BestKey =
    | "avgJudgeScore"
    | "avgTranscriptScore"
    | "avgWer"
    | "avgCer"
    | "avgLatencyMs"
    | "avgTotalTokens"
    | "totalCostUsd";

// How each "Best" column picks a winner. Values are compared as displayed,
// so two models that both render "0.02¢" tie and neither is marked.
const BEST_RULES: Record<
    BestKey,
    { higherIsBetter: boolean; display: (value: number) => string }
> = {
    avgJudgeScore: { higherIsBetter: true, display: (v) => fmtScore(v) },
    avgTranscriptScore: { higherIsBetter: true, display: (v) => fmtScore(v) },
    avgWer: { higherIsBetter: false, display: (v) => fmtMetricRate(v) },
    avgCer: { higherIsBetter: false, display: (v) => fmtMetricRate(v) },
    avgLatencyMs: { higherIsBetter: false, display: (v) => fmtMs(v) },
    avgTotalTokens: { higherIsBetter: false, display: (v) => fmtTokens(v) },
    // Replaced per table by the column formatter (see `findBest`).
    totalCostUsd: { higherIsBetter: false, display: (v) => v.toFixed(2) },
};

// Group dividers: the first column of each metric group.
const GROUP_START = "border-l border-border";

// The pinned model column. The pseudo-element draws its right edge so the
// divider stays put while the metrics scroll underneath.
const STICKY_CELL =
    "sticky left-0 z-10 bg-background after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-border";

// WER and CER are rates shown to the same two places as scores.
const fmtMetricRate = (value: number | undefined): string => fmtScore(value);

const MS_FORMAT = new Intl.NumberFormat("en");

function fmtMs(value: number): string {
    return MS_FORMAT.format(Math.round(value));
}

/** The runModelId holding the single best value per column, if any. */
function findBest(
    rows: ILeaderboardRow[],
    fmtCostValue: (costUsd: number) => string,
): Partial<Record<BestKey, string>> {
    const best: Partial<Record<BestKey, string>> = {};
    for (const key of Object.keys(BEST_RULES) as BestKey[]) {
        const rule = BEST_RULES[key];
        const higherIsBetter = rule.higherIsBetter;
        const display = key === "totalCostUsd" ? fmtCostValue : rule.display;
        const scored = rows.flatMap((r) => {
            const value = r[key];
            return value === undefined || value === null
                ? []
                : [{ id: r.runModelId, value }];
        });
        if (scored.length < 2) continue;
        const top = scored.reduce((a, b) =>
            (higherIsBetter ? b.value > a.value : b.value < a.value) ? b : a,
        );
        const shown = display(top.value);
        const ties = scored.filter((s) => display(s.value) === shown);
        if (ties.length === 1) best[key] = top.id;
    }
    return best;
}

// The "*" marker for a metric that not every cell reported.
function Footnote({ hint }: { hint: string }) {
    return (
        <HintText
            hint={hint}
            className="ml-0.5 text-muted-foreground no-underline"
        >
            *<span className="sr-only"> ({hint})</span>
        </HintText>
    );
}

function OptionalHint({
    content,
    children,
}: {
    content: string | undefined;
    children: React.ReactElement;
}) {
    return content ? <Hint content={content}>{children}</Hint> : children;
}

/** Icon plus text on the canvas: no fill, so it reads as a note, not a status. */
function BestMarker() {
    return (
        <span className="inline-flex items-center gap-1 text-label-12 text-muted-foreground">
            <Trophy className="size-3" aria-hidden="true" />
            Best
        </span>
    );
}

/** A value with an optional "Best" marker to its left. */
function WithBest({
    best,
    children,
}: {
    best: boolean;
    children: React.ReactNode;
}) {
    return (
        <span className="inline-flex items-center justify-end gap-2">
            {best && <BestMarker />}
            {children}
        </span>
    );
}

function LatencyValue({ ms }: { ms: number | undefined }) {
    if (ms === undefined) return <Num>{MISSING_VALUE}</Num>;
    return (
        <span className="tabular-nums">
            {fmtMs(ms)}
            <span className="ml-0.5 text-muted-foreground">ms</span>
        </span>
    );
}

/**
 * The change against the reference model as a compact chip: "23% faster",
 * "5% higher", "Same", or "Baseline" on the reference row itself.
 */
function VsReference({
    value,
    baseline,
    isReference,
    lowerIsBetter = false,
    better,
    worse,
}: {
    value: number | undefined;
    baseline: number | undefined;
    isReference: boolean;
    lowerIsBetter?: boolean;
    better: string;
    worse: string;
}) {
    if (isReference) {
        return (
            <span className="text-label-12 text-muted-foreground">
                Baseline
            </span>
        );
    }
    const { text, direction, good } = fmtDelta(value, baseline, lowerIsBetter);
    if (text === MISSING_VALUE) return <Num>{text}</Num>;
    if (direction === "flat") {
        return (
            <span className="inline-flex items-center gap-1 text-label-12 text-muted-foreground">
                <Minus className="size-3" aria-hidden="true" />
                Same
            </span>
        );
    }
    const Arrow = direction === "up" ? ArrowUp : ArrowDown;
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 text-label-12",
                good ? "text-eval-success" : "text-eval-danger",
            )}
        >
            <Arrow className="size-3" aria-hidden="true" />
            {`${text.replace(/^[+-]/, "")} ${good ? better : worse}`}
        </span>
    );
}

function FailureCount({ count }: { count: number }) {
    if (count > 0) {
        return <Num className="text-label-14 text-danger">{count}</Num>;
    }
    return <Num className="text-muted-foreground">0</Num>;
}

function TokenSplit({ row }: { row: ILeaderboardRow }) {
    return (
        <div className="text-label-12 tabular-nums text-muted-foreground">
            {`${fmtTokens(row.avgPromptTokens)} in · ${fmtTokens(
                row.avgCompletionTokens,
            )} out`}
        </div>
    );
}

function SortableHead({
    sortKey,
    sort,
    onSort,
    title,
    className,
    children,
}: {
    sortKey: SortKey;
    sort: SortState;
    onSort: (key: SortKey) => void;
    title?: string;
    className?: string;
    children: React.ReactNode;
}) {
    const active = sort.key === sortKey;
    const ariaSort = active
        ? sort.direction === "asc"
            ? "ascending"
            : "descending"
        : "none";
    const Icon = !active
        ? ChevronsUpDown
        : sort.direction === "asc"
          ? ArrowUp
          : ArrowDown;
    return (
        <TableHead align="numeric" aria-sort={ariaSort} className={className}>
            <OptionalHint content={title}>
                <button
                    type="button"
                    onClick={() => onSort(sortKey)}
                    className={cn(
                        "group/sort -mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-label-12 transition-colors hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        active ? "text-on-surface" : "text-muted-foreground",
                    )}
                >
                    {children}
                    <Icon
                        aria-hidden="true"
                        className={cn(
                            "size-3 transition-opacity",
                            active
                                ? "text-on-surface"
                                : "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60",
                        )}
                    />
                </button>
            </OptionalHint>
        </TableHead>
    );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
    return <span className="text-on-surface">{children}</span>;
}

interface ILeaderboardLayout {
    reference: ILeaderboardRow | undefined;
    showJudge: boolean;
    showTranscriptMetrics: boolean;
    showVsReference: boolean;
    best: Partial<Record<BestKey, string>>;
    /** One unit and precision for the whole cost column. */
    fmtCostValue: ReturnType<typeof formatCostColumn>;
    snapshot: IRunConfigSnapshot;
}

function leaderboardLayout(
    rows: ILeaderboardRow[],
    snapshot: IRunConfigSnapshot,
): ILeaderboardLayout {
    const reference = rows.find((r) => r.isReference);
    const fmtCostValue = formatCostColumn(rows.map((r) => r.totalCostUsd));
    const showTranscriptMetrics = rows.some(
        (r) =>
            r.avgTranscriptScore !== undefined ||
            r.avgWer !== undefined ||
            r.avgCer !== undefined ||
            r.transcriptFailureCount > 0,
    );
    return {
        reference,
        showTranscriptMetrics,
        // STT runs without a judge prompt would show a column of dashes; LLM
        // runs keep the column since judge score is their only quality signal.
        showJudge:
            !showTranscriptMetrics ||
            rows.some((r) => r.avgJudgeScore !== undefined),
        showVsReference: reference !== undefined && rows.length > 1,
        best: findBest(rows, fmtCostValue),
        fmtCostValue,
        snapshot,
    };
}

function defaultSort(rows: ILeaderboardRow[]): SortState {
    const key: SortKey = rows.some((r) => r.avgJudgeScore !== undefined)
        ? "avgJudgeScore"
        : rows.some((r) => r.avgTranscriptScore !== undefined)
          ? "avgTranscriptScore"
          : "totalCostUsd";
    return { key, direction: DEFAULT_DIRECTION[key] };
}

export function Leaderboard({
    rows,
    configSnapshot = {},
}: {
    rows: ILeaderboardRow[];
    configSnapshot?: IRunConfigSnapshot;
}) {
    const layout = useMemo(
        () => leaderboardLayout(rows, configSnapshot),
        [rows, configSnapshot],
    );
    // Lead with the answer: best score first, falling back to cost when the
    // run has no scores.
    const [sort, setSort] = useState<SortState>(() => defaultSort(rows));

    function handleSort(key: SortKey) {
        setSort((prev) =>
            prev.key === key
                ? {
                      key,
                      direction: prev.direction === "asc" ? "desc" : "asc",
                  }
                : { key, direction: DEFAULT_DIRECTION[key] },
        );
    }

    const sorted = useMemo(() => {
        const fallback = sort.direction === "asc" ? Infinity : -Infinity;
        return [...rows].sort((a, b) => {
            const av = a[sort.key] ?? fallback;
            const bv = b[sort.key] ?? fallback;
            return sort.direction === "asc" ? av - bv : bv - av;
        });
    }, [rows, sort]);

    const top = sorted[0];
    const topDisplay = top
        ? sttVariantDisplay(configSnapshot, top.modelId)
        : undefined;
    const summary = top
        ? `${COLUMN_LABEL[sort.key]} leader (${
              sort.direction === "asc" ? "lowest" : "highest"
          } first): ${topDisplay?.label ?? top.modelId}${
              top.isReference ? " (reference)" : ""
          }. ${rows.length} model${rows.length === 1 ? "" : "s"} compared.`
        : "No models to compare.";

    if (rows.length === 0) {
        return (
            <EmptyState
                title="No results yet"
                description="Model results appear here as cells finish."
            />
        );
    }

    return (
        <div
            role="region"
            aria-label="Model leaderboard"
            className="flex flex-col gap-3"
        >
            <p className="sr-only" aria-live="polite">
                {summary}
            </p>
            <Table
                containerClassName="hidden md:block"
                className="min-w-max [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap"
            >
                <LeaderboardHeader
                    layout={layout}
                    sort={sort}
                    onSort={handleSort}
                />
                <TableBody>
                    {sorted.map((r) => (
                        <LeaderboardTableRow
                            key={r.runModelId}
                            row={r}
                            layout={layout}
                        />
                    ))}
                </TableBody>
            </Table>

            {/* Mobile: one stacked card per row, in the same sorted order. */}
            <ul className="flex flex-col gap-3 md:hidden">
                {sorted.map((r) => (
                    <li key={r.runModelId}>
                        <LeaderboardCard row={r} layout={layout} />
                    </li>
                ))}
            </ul>

            <LeaderboardLegend rows={rows} layout={layout} sort={sort} />
        </div>
    );
}

function LeaderboardHeader({
    layout,
    sort,
    onSort,
}: {
    layout: ILeaderboardLayout;
    sort: SortState;
    onSort: (key: SortKey) => void;
}) {
    const { showJudge, showTranscriptMetrics, showVsReference } = layout;
    const qualitySpan =
        (showJudge ? (showVsReference ? 2 : 1) : 0) +
        (showTranscriptMetrics ? 4 : 0);
    return (
        <TableHeader>
            <TableRow className="hover:bg-transparent">
                <TableHead className={cn(STICKY_CELL, "h-8")}>
                    <span className="sr-only">Model</span>
                </TableHead>
                {qualitySpan > 0 && (
                    <TableHead
                        colSpan={qualitySpan}
                        className={cn(GROUP_START, "h-8")}
                    >
                        <GroupLabel>Quality</GroupLabel>
                    </TableHead>
                )}
                <TableHead
                    colSpan={showVsReference ? 2 : 1}
                    className={cn(GROUP_START, "h-8")}
                >
                    <GroupLabel>Speed</GroupLabel>
                </TableHead>
                <TableHead colSpan={2} className={cn(GROUP_START, "h-8")}>
                    <GroupLabel>Usage</GroupLabel>
                </TableHead>
            </TableRow>
            <TableRow className="bg-muted hover:bg-muted">
                <TableHead className={cn(STICKY_CELL, "bg-muted")}>
                    Model
                </TableHead>
                {showJudge && (
                    <>
                        <SortableHead
                            sortKey="avgJudgeScore"
                            sort={sort}
                            onSort={onSort}
                            title="LLM-as-judge score when a judge prompt is selected."
                            className={GROUP_START}
                        >
                            Judge score
                        </SortableHead>
                        {showVsReference && (
                            <TableHead align="numeric">vs reference</TableHead>
                        )}
                    </>
                )}
                {showTranscriptMetrics && (
                    <>
                        <SortableHead
                            sortKey="avgTranscriptScore"
                            sort={sort}
                            onSort={onSort}
                            title="Transcript metric score from STT reference matching."
                            className={cn(!showJudge && GROUP_START)}
                        >
                            Transcript score
                        </SortableHead>
                        <TableHead align="numeric">
                            <HintText hint="Average word error rate. Lower is better.">
                                WER
                            </HintText>
                        </TableHead>
                        <TableHead align="numeric">
                            <HintText hint="Average character error rate. Lower is better.">
                                CER
                            </HintText>
                        </TableHead>
                        <TableHead align="numeric">
                            <HintText hint="Cells with at least one hard transcript failure flag.">
                                Failures
                            </HintText>
                        </TableHead>
                    </>
                )}
                <SortableHead
                    sortKey="avgLatencyMs"
                    sort={sort}
                    onSort={onSort}
                    className={GROUP_START}
                >
                    Avg latency
                </SortableHead>
                {showVsReference && (
                    <TableHead align="numeric">vs reference</TableHead>
                )}
                <SortableHead
                    sortKey="avgTotalTokens"
                    sort={sort}
                    onSort={onSort}
                    title="Average tokens per cell, then the input and output split."
                    className={GROUP_START}
                >
                    Tokens
                </SortableHead>
                <SortableHead
                    sortKey="totalCostUsd"
                    sort={sort}
                    onSort={onSort}
                >
                    Total cost
                </SortableHead>
            </TableRow>
        </TableHeader>
    );
}

function TokensValue({ row }: { row: ILeaderboardRow }) {
    return (
        <span>
            <Num>{fmtTokens(row.avgTotalTokens)}</Num>
            {!row.tokenUsageAvailable && (
                <Footnote hint="Not every cell reported token usage." />
            )}
        </span>
    );
}

function CostValue({
    row,
    layout,
}: {
    row: ILeaderboardRow;
    layout: ILeaderboardLayout;
}) {
    return (
        <span>
            <Num>{layout.fmtCostValue(row.totalCostUsd)}</Num>
            {!row.costAvailable && (
                <Footnote hint="Not every cell reported a cost." />
            )}
        </span>
    );
}

function LeaderboardTableRow({
    row: r,
    layout,
}: {
    row: ILeaderboardRow;
    layout: ILeaderboardLayout;
}) {
    const { reference, showJudge, showTranscriptMetrics, showVsReference } =
        layout;
    const isBest = (key: BestKey) => layout.best[key] === r.runModelId;
    return (
        <TableRow className="group hover:bg-muted">
            <TableCell className={cn(STICKY_CELL, "group-hover:bg-muted")}>
                <ModelIdentity row={r} snapshot={layout.snapshot} />
            </TableCell>
            {showJudge && (
                <>
                    <TableCell align="numeric" className={GROUP_START}>
                        <WithBest best={isBest("avgJudgeScore")}>
                            <Num>{fmtScore(r.avgJudgeScore)}</Num>
                        </WithBest>
                    </TableCell>
                    {showVsReference && (
                        <TableCell align="numeric">
                            <VsReference
                                value={r.avgJudgeScore}
                                baseline={reference?.avgJudgeScore}
                                isReference={r.isReference}
                                better="higher"
                                worse="lower"
                            />
                        </TableCell>
                    )}
                </>
            )}
            {showTranscriptMetrics && (
                <>
                    <TableCell
                        align="numeric"
                        className={cn(!showJudge && GROUP_START)}
                    >
                        <WithBest best={isBest("avgTranscriptScore")}>
                            <Num>{fmtScore(r.avgTranscriptScore)}</Num>
                        </WithBest>
                    </TableCell>
                    <TableCell align="numeric">
                        <WithBest best={isBest("avgWer")}>
                            <Num>{fmtMetricRate(r.avgWer)}</Num>
                        </WithBest>
                    </TableCell>
                    <TableCell align="numeric">
                        <WithBest best={isBest("avgCer")}>
                            <Num>{fmtMetricRate(r.avgCer)}</Num>
                        </WithBest>
                    </TableCell>
                    <TableCell align="numeric">
                        <FailureCount count={r.transcriptFailureCount} />
                    </TableCell>
                </>
            )}
            <TableCell align="numeric" className={GROUP_START}>
                <WithBest best={isBest("avgLatencyMs")}>
                    <LatencyValue ms={r.avgLatencyMs} />
                </WithBest>
            </TableCell>
            {showVsReference && (
                <TableCell align="numeric">
                    <VsReference
                        value={r.avgLatencyMs}
                        baseline={reference?.avgLatencyMs}
                        isReference={r.isReference}
                        lowerIsBetter
                        better="faster"
                        worse="slower"
                    />
                </TableCell>
            )}
            <TableCell align="numeric" className={GROUP_START}>
                <WithBest best={isBest("avgTotalTokens")}>
                    <TokensValue row={r} />
                </WithBest>
                <TokenSplit row={r} />
            </TableCell>
            <TableCell align="numeric">
                <WithBest best={isBest("totalCostUsd")}>
                    <CostValue row={r} layout={layout} />
                </WithBest>
            </TableCell>
        </TableRow>
    );
}

function LeaderboardCard({
    row: r,
    layout,
}: {
    row: ILeaderboardRow;
    layout: ILeaderboardLayout;
}) {
    const { reference, showJudge, showTranscriptMetrics } = layout;
    const showVsReference = layout.showVsReference && !r.isReference;
    const isBest = (key: BestKey) => layout.best[key] === r.runModelId;
    return (
        <Card className="flex flex-col gap-4 p-4">
            <ModelIdentity row={r} snapshot={layout.snapshot} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-copy-14">
                {showJudge && (
                    <MobileMetric label="Judge score">
                        <WithBest best={isBest("avgJudgeScore")}>
                            <Num>{fmtScore(r.avgJudgeScore)}</Num>
                        </WithBest>
                        {showVsReference && (
                            <VsReference
                                value={r.avgJudgeScore}
                                baseline={reference?.avgJudgeScore}
                                isReference={false}
                                better="higher"
                                worse="lower"
                            />
                        )}
                    </MobileMetric>
                )}
                {showTranscriptMetrics && (
                    <>
                        <MobileMetric label="Transcript score">
                            <WithBest best={isBest("avgTranscriptScore")}>
                                <Num>{fmtScore(r.avgTranscriptScore)}</Num>
                            </WithBest>
                        </MobileMetric>
                        <MobileMetric label="WER / CER">
                            <Num>
                                {`${fmtMetricRate(r.avgWer)} / ${fmtMetricRate(r.avgCer)}`}
                            </Num>
                        </MobileMetric>
                        <MobileMetric label="Failures">
                            <FailureCount count={r.transcriptFailureCount} />
                        </MobileMetric>
                    </>
                )}
                <MobileMetric label="Avg latency">
                    <WithBest best={isBest("avgLatencyMs")}>
                        <LatencyValue ms={r.avgLatencyMs} />
                    </WithBest>
                    {showVsReference && (
                        <VsReference
                            value={r.avgLatencyMs}
                            baseline={reference?.avgLatencyMs}
                            isReference={false}
                            lowerIsBetter
                            better="faster"
                            worse="slower"
                        />
                    )}
                </MobileMetric>
                <MobileMetric label="Tokens">
                    <WithBest best={isBest("avgTotalTokens")}>
                        <TokensValue row={r} />
                    </WithBest>
                    <TokenSplit row={r} />
                </MobileMetric>
                <MobileMetric label="Total cost">
                    <WithBest best={isBest("totalCostUsd")}>
                        <CostValue row={r} layout={layout} />
                    </WithBest>
                </MobileMetric>
            </dl>
        </Card>
    );
}

function LeaderboardLegend({
    rows,
    layout,
    sort,
}: {
    rows: ILeaderboardRow[];
    layout: ILeaderboardLayout;
    sort: SortState;
}) {
    const { reference } = layout;
    const referenceLabel = reference
        ? (sttVariantDisplay(layout.snapshot, reference.modelId)?.label ??
          reference.modelId)
        : undefined;
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label-12 text-muted-foreground">
            <span>
                Sorted by {COLUMN_LABEL[sort.key].toLowerCase()} (
                {sort.direction === "asc" ? "ascending" : "descending"}). Click
                a column header to re-sort.
            </span>
            <span className="inline-flex items-center gap-1">
                <Trophy className="size-3" aria-hidden="true" />
                Best in column; ties are not marked.
            </span>
            {layout.showVsReference && referenceLabel && (
                <span className="inline-flex items-center gap-1">
                    <Pin className="size-3" aria-hidden="true" />
                    {`"vs reference" compares against ${referenceLabel}.`}
                </span>
            )}
            {!layout.showJudge && (
                <span>
                    No judge prompt on this run, so judge score is hidden.
                </span>
            )}
            {rows.some((r) => !r.costAvailable || !r.tokenUsageAvailable) && (
                <span>* Metric not available for every cell.</span>
            )}
        </div>
    );
}

function MobileMetric({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col items-start gap-1">
            <dt className="text-label-12 text-muted-foreground">{label}</dt>
            <dd className="flex flex-col items-start gap-1">{children}</dd>
        </div>
    );
}

/**
 * Two compact lines: the display name (with the reference badge), then the
 * model ID and any differing variant params in mono. The full ID is in the
 * hint, so the visible line can truncate instead of wrapping.
 */
function ModelIdentity({
    row,
    snapshot,
}: {
    row: ILeaderboardRow;
    snapshot: IRunConfigSnapshot;
}) {
    const variant = sttVariantDisplay(snapshot, row.modelId);
    const name = variant?.label ?? row.modelId;
    const fullId = variant?.baseModelId ?? row.modelId;
    const shortId = fullId.split("/").at(-1) ?? fullId;
    const details = variant
        ? [shortId, ...variant.diffBadges].join(" · ")
        : undefined;
    return (
        <div className="flex min-w-0 items-center gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                    <span
                        className={cn(
                            "text-on-surface",
                            variant ? "text-label-14" : "text-mono-13",
                        )}
                    >
                        {name}
                    </span>
                    {row.isReference && (
                        <Badge variant="ref" className="gap-1">
                            <Pin className="size-3" aria-hidden="true" />
                            Reference
                        </Badge>
                    )}
                </span>
                {details && (
                    <Hint
                        content={<span className="text-mono-13">{fullId}</span>}
                    >
                        <span
                            tabIndex={0}
                            className="block max-w-72 truncate rounded-sm text-mono-13 text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                            {details}
                        </span>
                    </Hint>
                )}
            </div>
        </div>
    );
}
