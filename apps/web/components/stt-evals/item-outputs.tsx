"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, PanelRight, Search } from "lucide-react";
import type { IWorkflowRunDetailResponse } from "@mosaic/api-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Num } from "@/components/ui/num";
import { Skeleton } from "@/components/ui/skeleton";
import {
    CellStatusBadge,
    PendingScore,
    RunningDot,
    isCellInFlight,
} from "@/components/ui/status-badge";
import type { toTranscriptMetricDetails } from "@/components/runs/types";
import { cn } from "@/lib/cn";
import { MISSING_VALUE, fmtScore, formatCostColumn } from "@/lib/format";
import { humanize } from "@/lib/labels";
import {
    AudioRecording,
    InlineRates,
    STT_SCORE_DIGITS,
    cellOutput,
    isAudioItem,
} from "./run-artifacts";
import { BlockedCellLink, blockedByCell } from "./workflow-cell-link";

/**
 * Sort key per node: shared upstream nodes (e.g. the audio input) first, then
 * each STT branch in canvas order, and within a branch by depth along edges.
 */
export function pipelineOrder(
    detail: IWorkflowRunDetailResponse,
    ownership: Map<string, string>,
    roots: IWorkflowRunDetailResponse["workflowRun"]["workflowSnapshot"]["nodes"],
): Map<string, number> {
    const nodes = detail.workflowRun.workflowSnapshot.nodes;
    const keyById = new Map(nodes.map((node) => [node.id, node.nodeKey]));
    const depth = new Map(nodes.map((node) => [node.nodeKey, 0]));
    for (let pass = 0; pass < nodes.length; pass += 1)
        for (const edge of detail.edges) {
            const source = keyById.get(edge.fromNodeId);
            const target = keyById.get(edge.toNodeId);
            if (source && target)
                depth.set(
                    target,
                    Math.max(
                        depth.get(target) ?? 0,
                        (depth.get(source) ?? 0) + 1,
                    ),
                );
        }
    const rootIndex = new Map(
        roots.map((root, index) => [root.nodeKey, index]),
    );
    const size = nodes.length + 1;
    return new Map(
        nodes.map((node, index) => {
            const owner = ownership.get(node.nodeKey);
            const branch =
                owner === undefined ? -1 : (rootIndex.get(owner) ?? -1);
            return [
                node.nodeKey,
                ((branch + 1) * size + (depth.get(node.nodeKey) ?? 0)) * size +
                    index,
            ];
        }),
    );
}

type WorkflowItem = IWorkflowRunDetailResponse["items"][number];
type WorkflowCell = IWorkflowRunDetailResponse["cells"][number];
type WorkflowNode =
    IWorkflowRunDetailResponse["workflowRun"]["workflowSnapshot"]["nodes"][number];
type WorkflowScore = IWorkflowRunDetailResponse["scoresByCell"][string][number];

export interface ResultRow {
    item: WorkflowItem;
    cell: WorkflowCell;
    node: WorkflowNode | undefined;
    root: WorkflowNode | undefined;
    metricScore: WorkflowScore | undefined;
    judgeScore: WorkflowScore | undefined;
    metricDetails: ReturnType<typeof toTranscriptMetricDetails>;
}

/** One dataset item and its steps, in pipeline order. */
export interface ItemGroup {
    item: WorkflowItem;
    rows: ResultRow[];
}

type ItemFilter = "all" | "failed" | "running";

const ITEM_FILTERS: Array<[ItemFilter, string]> = [
    ["all", "All"],
    ["failed", "Failed"],
    ["running", "Running"],
];

// Phone: marker | step and output stacked | latency and cost.
// Tablet: the output gets its own column; cost folds under latency.
// Desktop: model and cost get their own columns.
const STEP_GRID =
    "grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-x-3 md:grid-cols-[1.25rem_minmax(8.5rem,10.5rem)_minmax(0,1fr)_5rem_2rem] lg:grid-cols-[1.25rem_minmax(9rem,12rem)_minmax(0,1fr)_11rem_4.5rem_5rem_2rem]";
const SCORED_STEP_GRID =
    "grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-x-3 md:grid-cols-[1.25rem_minmax(8.5rem,10.5rem)_minmax(0,1fr)_5rem_7rem_2rem] lg:grid-cols-[1.25rem_minmax(9rem,12rem)_minmax(0,1fr)_11rem_4.5rem_5rem_7rem_2rem]";

const NODE_KIND_LABELS: Partial<Record<string, string>> = {
    input: "Input",
    stt: "Transcription",
    llm_text: "LLM",
    prompt: "Prompt",
    transliterate: "Transliteration",
    judge: "Judge",
    metric_compare: "Metric",
};

function cellCost(cell: WorkflowCell): number | undefined {
    return cell.outputJson?.usage?.costUsd ?? cell.costUsd ?? undefined;
}

function sumDefined(values: Array<number | null | undefined>) {
    const present = values.filter(
        (value): value is number => typeof value === "number",
    );
    return present.length === 0
        ? undefined
        : present.reduce((sum, value) => sum + value, 0);
}

function formatStepLatency(ms: number | null | undefined): string {
    if (typeof ms !== "number") return MISSING_VALUE;
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function groupCounts(group: ItemGroup) {
    const statuses = group.rows.map((row) => row.cell.status);
    return {
        failed: statuses.filter((status) => status === "failed").length,
        inFlight: statuses.filter(isCellInFlight).length,
        done: statuses.filter(
            (status) => status === "succeeded" || status === "cached",
        ).length,
    };
}

export function ItemOutputs({
    detail,
    groups,
    showBranch,
    showScores,
    highlightedCellId,
    selectedCellId,
    onInspect,
    onReveal,
}: {
    detail: IWorkflowRunDetailResponse;
    groups: ItemGroup[];
    showBranch: boolean;
    showScores: boolean;
    highlightedCellId: string | undefined;
    selectedCellId: string | undefined;
    onInspect: (cellId: string) => void;
    onReveal: (id: string, href: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<ItemFilter>("all");
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
        () => new Set(),
    );
    const counts: Record<ItemFilter, number> = {
        all: groups.length,
        failed: groups.filter((group) => groupCounts(group).failed > 0).length,
        running: groups.filter((group) => groupCounts(group).inFlight > 0)
            .length,
    };
    const needle = query.trim().toLowerCase();
    const visible = groups.filter((group) => {
        if (!group.item.id.toLowerCase().includes(needle)) return false;
        if (filter === "failed") return groupCounts(group).failed > 0;
        if (filter === "running") return groupCounts(group).inFlight > 0;
        return true;
    });
    const allCollapsed =
        visible.length > 0 &&
        visible.every((group) => collapsed.has(group.item.id));
    const stepCount = groups.reduce(
        (count, group) => count + group.rows.length,
        0,
    );
    // One precision for every step and item total, so digits line up.
    const fmtColumnCost = formatCostColumn(
        groups.flatMap((group) => group.rows.map((row) => cellCost(row.cell))),
    );
    // A reused or cached step costs nothing; "$0" reads cleaner than "$0.00000".
    const fmtItemCost: ReturnType<typeof formatCostColumn> = (costUsd) =>
        costUsd === 0 ? "$0" : fmtColumnCost(costUsd);
    const grid = showScores ? SCORED_STEP_GRID : STEP_GRID;
    const toggle = (id: string) =>
        setCollapsed((current) => {
            const next = new Set(current);
            if (!next.delete(id)) next.add(id);
            return next;
        });
    const toggleAll = () =>
        setCollapsed((current) => {
            const next = new Set(current);
            for (const group of visible)
                if (allCollapsed) next.delete(group.item.id);
                else next.add(group.item.id);
            return next;
        });

    return (
        <Card>
            <CardHeader className="flex-col items-start justify-between gap-4 sm:flex-row">
                <div className="flex flex-col gap-1">
                    <CardTitle as="h2">Item outputs</CardTitle>
                    <p className="text-copy-14 text-muted-foreground">
                        Each item runs through every step in order. Open a step
                        for full input, output and routing.
                    </p>
                </div>
                <p className="text-copy-14 text-muted-foreground">
                    <Num>{groups.length}</Num> item
                    {groups.length === 1 ? "" : "s"} · <Num>{stepCount}</Num>{" "}
                    step{stepCount === 1 ? "" : "s"}
                </p>
            </CardHeader>
            <CardContent className="px-0 pb-0">
                <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                    <label className="relative w-full sm:w-56">
                        <span className="sr-only">Filter by item ID</span>
                        <Search
                            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden="true"
                        />
                        <Input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Filter by item ID"
                            className="h-8 pl-8"
                        />
                    </label>
                    <div
                        role="group"
                        aria-label="Filter items by status"
                        className="inline-flex gap-0.5 rounded-sm bg-muted p-0.5"
                    >
                        {ITEM_FILTERS.map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                aria-pressed={filter === value}
                                onClick={() => setFilter(value)}
                                className="rounded-[4px] px-2.5 py-1 text-label-14 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-neutral aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-border"
                            >
                                {label}
                                <Num className="ml-1.5 text-muted-foreground">
                                    {counts[value]}
                                </Num>
                            </button>
                        ))}
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        disabled={visible.length === 0}
                        onClick={toggleAll}
                    >
                        {allCollapsed ? "Expand all" : "Collapse all"}
                    </Button>
                </div>
                <div
                    aria-hidden="true"
                    className={cn(
                        grid,
                        "hidden h-9 items-center border-y border-border px-4 text-label-12 text-muted-foreground md:grid",
                    )}
                >
                    <span />
                    <span>Step</span>
                    <span>Output</span>
                    <span className="hidden lg:block">Model</span>
                    <span className="text-right">
                        Latency<span className="lg:hidden"> · Cost</span>
                    </span>
                    <span className="hidden text-right lg:block">Cost</span>
                    {showScores ? (
                        <span className="text-right">Score</span>
                    ) : null}
                    <span />
                </div>
                {visible.length === 0 ? (
                    <p className="border-t border-border px-4 py-8 text-center text-copy-14 text-muted-foreground md:border-t-0">
                        No items match these filters.
                    </p>
                ) : (
                    <ul
                        aria-label="Items"
                        className="border-t border-border md:border-t-0"
                    >
                        {visible.map((group) => (
                            <ItemGroupRows
                                key={group.item.id}
                                detail={detail}
                                group={group}
                                grid={grid}
                                showBranch={showBranch}
                                showScores={showScores}
                                collapsed={
                                    collapsed.has(group.item.id) &&
                                    !group.rows.some(
                                        (row) =>
                                            row.cell.id === highlightedCellId,
                                    )
                                }
                                onToggle={() => toggle(group.item.id)}
                                fmtCost={fmtItemCost}
                                highlightedCellId={highlightedCellId}
                                selectedCellId={selectedCellId}
                                onInspect={onInspect}
                                onReveal={onReveal}
                            />
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

function ItemGroupRows({
    detail,
    group,
    grid,
    showBranch,
    showScores,
    collapsed,
    onToggle,
    fmtCost,
    highlightedCellId,
    selectedCellId,
    onInspect,
    onReveal,
}: {
    detail: IWorkflowRunDetailResponse;
    group: ItemGroup;
    grid: string;
    showBranch: boolean;
    showScores: boolean;
    collapsed: boolean;
    onToggle: () => void;
    fmtCost: ReturnType<typeof formatCostColumn>;
    highlightedCellId: string | undefined;
    selectedCellId: string | undefined;
    onInspect: (cellId: string) => void;
    onReveal: (id: string, href: string) => void;
}) {
    const shortId = group.item.id.slice(0, 8);
    const stepsId = `item-steps-${group.item.id}`;
    const latency = sumDefined(group.rows.map((row) => row.cell.latencyMs));
    const cost = sumDefined(group.rows.map((row) => cellCost(row.cell)));
    return (
        <li className="group/item border-b border-border transition-colors last:border-b-0 hover:bg-muted/40">
            <div
                className={cn(
                    grid,
                    "cursor-pointer items-center px-4 pt-3",
                    collapsed ? "pb-3" : "pb-1",
                )}
                onClick={onToggle}
            >
                <button
                    type="button"
                    aria-expanded={!collapsed}
                    aria-controls={stepsId}
                    aria-label={`${collapsed ? "Expand" : "Collapse"} item ${shortId}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggle();
                    }}
                    className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                    <ChevronDown
                        className={cn(
                            "size-4 transition-transform",
                            collapsed && "-rotate-90",
                        )}
                        aria-hidden="true"
                    />
                </button>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 md:col-span-2 lg:col-span-3">
                    <span className="text-mono-13" title={group.item.id}>
                        {shortId}
                    </span>
                    <StepDots rows={group.rows} />
                    <ItemSummary group={group} />
                </div>
                <p className="text-right text-label-12 text-muted-foreground">
                    <Num>{formatStepLatency(latency)}</Num>
                    <Num className="block lg:hidden">{fmtCost(cost)}</Num>
                </p>
                <p className="hidden text-right text-label-12 text-muted-foreground lg:block">
                    <Num>{fmtCost(cost)}</Num>
                </p>
                {showScores ? <span className="hidden md:block" /> : null}
                <span className="hidden md:block" />
            </div>
            <ol id={stepsId} hidden={collapsed} className="pb-2">
                {group.rows.map((row, index) => (
                    <StepRow
                        key={row.cell.id}
                        detail={detail}
                        row={row}
                        index={index}
                        last={index === group.rows.length - 1}
                        grid={grid}
                        showBranch={showBranch}
                        showScores={showScores}
                        fmtCost={fmtCost}
                        highlighted={highlightedCellId === row.cell.id}
                        expanded={selectedCellId === row.cell.id}
                        onInspect={onInspect}
                        onReveal={onReveal}
                    />
                ))}
            </ol>
        </li>
    );
}

function ItemSummary({ group }: { group: ItemGroup }) {
    const { failed, inFlight, done } = groupCounts(group);
    if (failed > 0) return <Badge variant="danger">{failed} failed</Badge>;
    if (inFlight > 0)
        return (
            <Badge variant="default" className="gap-2">
                <RunningDot />
                {inFlight} in progress
            </Badge>
        );
    return (
        <span className="text-label-12 text-muted-foreground">
            {done} of {group.rows.length} succeeded
        </span>
    );
}

const DOT_TONES: Record<WorkflowCell["status"], string> = {
    succeeded: "bg-success",
    cached: "bg-success",
    failed: "bg-danger",
    running: "bg-foreground motion-safe:animate-pulse",
    pending: "bg-border-strong",
};

function StepDots({ rows }: { rows: ResultRow[] }) {
    return (
        <span aria-hidden="true" className="inline-flex gap-[3px]">
            {rows.map((row) => (
                <span
                    key={row.cell.id}
                    className={cn(
                        "size-1.5 rounded-full",
                        DOT_TONES[row.cell.status],
                    )}
                />
            ))}
        </span>
    );
}

const MARKER_TONES: Record<WorkflowCell["status"], string> = {
    succeeded: "bg-success-muted text-success ring-success/30",
    cached: "bg-success-muted text-success ring-success/30",
    failed: "bg-danger text-white ring-danger",
    running:
        "bg-neutral text-foreground ring-border-strong motion-safe:animate-pulse",
    pending: "bg-muted text-muted-foreground ring-border",
};

/** Numbered step marker on a line that joins the steps of one item. */
function StepMarker({
    index,
    last,
    status,
}: {
    index: number;
    last: boolean;
    status: WorkflowCell["status"];
}) {
    const first = index === 0;
    return (
        <div
            aria-hidden="true"
            className="relative flex justify-center self-stretch max-md:row-span-2"
        >
            {first && last ? null : (
                <span
                    className={cn(
                        "absolute left-1/2 w-px -translate-x-1/2 bg-border-strong",
                        first ? "top-2.5" : "-top-2",
                        last ? "h-4.5" : "-bottom-2",
                    )}
                />
            )}
            <span
                className={cn(
                    "relative grid size-5 place-items-center rounded-full text-label-12 tabular-nums ring-1",
                    MARKER_TONES[status],
                )}
            >
                {index + 1}
            </span>
        </div>
    );
}

function StepRow({
    detail,
    row,
    index,
    last,
    grid,
    showBranch,
    showScores,
    fmtCost,
    highlighted,
    expanded,
    onInspect,
    onReveal,
}: {
    detail: IWorkflowRunDetailResponse;
    row: ResultRow;
    index: number;
    last: boolean;
    grid: string;
    showBranch: boolean;
    showScores: boolean;
    fmtCost: ReturnType<typeof formatCostColumn>;
    highlighted: boolean;
    expanded: boolean;
    onInspect: (cellId: string) => void;
    onReveal: (id: string, href: string) => void;
}) {
    const label = row.node?.label ?? row.cell.nodeKey;
    const route = stepRoute(row.node, row.cell.llmExecution);
    const subtitle = stepSubtitle(row, showBranch);
    const inFlight = isCellInFlight(row.cell.status);
    return (
        <li
            data-workflow-cell-id={row.cell.id}
            tabIndex={-1}
            onClick={(event) => {
                // Players, links and buttons inside the row keep their own clicks.
                if ((event.target as HTMLElement).closest("a, button, audio"))
                    return;
                onInspect(row.cell.id);
            }}
            className={cn(
                grid,
                "group/step scroll-mt-24 cursor-pointer gap-y-1 px-4 py-2",
                highlighted &&
                    "bg-muted outline-2 outline-ring -outline-offset-2",
            )}
        >
            <StepMarker index={index} last={last} status={row.cell.status} />
            <div className="flex min-w-0 flex-col items-start">
                <p className="text-label-14 decoration-border-strong underline-offset-4 group-hover/step:underline">
                    {label}
                </p>
                {route ? (
                    <p
                        className="hidden w-full truncate text-label-12 text-muted-foreground md:block lg:hidden"
                        title={route.model}
                    >
                        {shortModel(route.model)}
                    </p>
                ) : null}
                <p
                    className={cn(
                        "text-label-12 text-muted-foreground",
                        // Tablet shows the model on this line instead.
                        route && "md:max-lg:hidden",
                    )}
                >
                    {subtitle}
                </p>
                {row.cell.status === "succeeded" ? null : (
                    <span className="mt-1">
                        <CellStatusBadge status={row.cell.status} />
                    </span>
                )}
            </div>
            <div className="min-w-0 max-md:col-start-2 max-md:row-start-2">
                <StepOutput detail={detail} row={row} onReveal={onReveal} />
            </div>
            <StepModel route={route} />
            <StepNumbers
                cell={row.cell}
                hidden={row.node?.nodeType === "input"}
                fmtCost={fmtCost}
            />
            {showScores ? (
                <div className="hidden justify-end text-copy-14 md:flex">
                    {inFlight ? (
                        <PendingScore />
                    ) : (
                        <ScoreSummary
                            metricScore={row.metricScore?.score}
                            judgeScore={row.judgeScore?.score}
                            details={row.metricDetails}
                        />
                    )}
                </div>
            ) : null}
            <InspectButton
                cellId={row.cell.id}
                itemId={row.item.id}
                nodeLabel={label}
                expanded={expanded}
                onInspect={onInspect}
            />
        </li>
    );
}

function StepOutput({
    detail,
    row,
    onReveal,
}: {
    detail: IWorkflowRunDetailResponse;
    row: ResultRow;
    onReveal: (id: string, href: string) => void;
}) {
    if (row.node?.nodeType === "input" && isAudioItem(row.item))
        return <AudioRecording item={row.item} compact />;
    if (isCellInFlight(row.cell.status)) return <PendingPreview />;
    return (
        <ArtifactPreview
            text={cellOutput(row.cell)}
            danger={
                row.cell.status === "failed" &&
                !row.cell.error?.startsWith("Blocked by")
            }
        >
            {blockedByCell(detail, row.cell) && (
                <BlockedCellLink
                    detail={detail}
                    cell={row.cell}
                    onReveal={onReveal}
                />
            )}
        </ArtifactPreview>
    );
}

/** Latency, with cost folded underneath below desktop, plus the desktop cost column. */
function StepNumbers({
    cell,
    hidden,
    fmtCost,
}: {
    cell: WorkflowCell;
    hidden: boolean;
    fmtCost: ReturnType<typeof formatCostColumn>;
}) {
    const cost = fmtCost(cellCost(cell));
    return (
        <>
            <p className="text-right text-copy-14 text-muted-foreground max-md:col-start-3 max-md:row-start-1">
                {hidden ? null : (
                    <>
                        <Num>{formatStepLatency(cell.latencyMs)}</Num>
                        <Num className="block text-label-12 lg:hidden">
                            {cost}
                        </Num>
                    </>
                )}
            </p>
            <p className="hidden text-right text-copy-14 text-muted-foreground lg:block">
                {hidden ? null : <Num>{cost}</Num>}
            </p>
        </>
    );
}

/** The branch when a run has several, otherwise what kind of step it is. */
function stepSubtitle(row: ResultRow, showBranch: boolean): string {
    if (showBranch && row.root) return row.root.label;
    const nodeType = row.node?.nodeType;
    return (
        NODE_KIND_LABELS[nodeType ?? ""] ??
        humanize(nodeType ?? row.cell.nodeKey)
    );
}

interface StepRoute {
    model: string;
    via?: string;
}

/** The model a step used: routing evidence first, then the node's own config. */
function stepRoute(
    node: WorkflowNode | undefined,
    execution: WorkflowCell["llmExecution"],
): StepRoute | undefined {
    if (execution && execution.availability !== "legacy_unavailable") {
        const transport = execution.resolved.route.transportConfig.transport;
        const actualProvider =
            execution.availability === "complete" &&
            "identity" in execution.actual
                ? execution.actual.identity?.upstreamProvider
                : undefined;
        return {
            model: execution.resolved.route.modelId,
            via: actualProvider
                ? `${transport} → ${actualProvider}`
                : transport,
        };
    }
    const configured =
        node?.nodeConfig?.type === "stt"
            ? node.nodeConfig.sttConfig.modelId
            : node?.modelId;
    if (!configured)
        return execution
            ? { model: MISSING_VALUE, via: "Route unavailable" }
            : undefined;
    // STT model ids carry their transport, e.g. "openrouter:google/gemini-3.8-flash".
    const separator = configured.indexOf(":");
    return separator > 0
        ? {
              model: configured.slice(separator + 1),
              via: configured.slice(0, separator),
          }
        : {
              model: configured,
              via: execution ? "Route unavailable" : undefined,
          };
}

function shortModel(model: string): string {
    return model.split("/").at(-1) ?? model;
}

function StepModel({ route }: { route: StepRoute | undefined }) {
    if (!route) return <span className="hidden lg:block" />;
    return (
        <div className="hidden min-w-0 lg:block">
            <p className="truncate text-mono-13" title={route.model}>
                {shortModel(route.model)}
            </p>
            {route.via ? (
                <p className="truncate text-label-12 text-muted-foreground">
                    {route.via}
                </p>
            ) : null}
        </div>
    );
}

/** Drops markdown markers and keeps bold runs so summaries read as text. */
function PreviewText({ text }: { text: string }) {
    const flat = text
        .replace(/^\s*(?:#{1,6}\s+|[*-]\s+|\d+\.\s+)/gm, "")
        .replace(/\s*\n\s*/g, " ")
        .trim();
    return flat.split(/\*\*(.+?)\*\*/g).map((part, index) =>
        index % 2 === 1 ? (
            <strong key={index} className="text-label-14 text-foreground">
                {part}
            </strong>
        ) : (
            part
        ),
    );
}

function ArtifactPreview({
    text,
    danger = false,
    children,
}: {
    text: string | null | undefined;
    danger?: boolean;
    children?: ReactNode;
}) {
    return (
        <p
            className={cn(
                "line-clamp-2 wrap-break-word text-copy-14",
                danger ? "text-danger" : "text-muted-foreground",
            )}
        >
            {children || (text ? <PreviewText text={text} /> : MISSING_VALUE)}
        </p>
    );
}

// Stands in for a transcript preview (two lines) until the cell produces output.
function PendingPreview() {
    return (
        <div className="flex max-w-72 flex-col gap-2 py-0.5">
            <Skeleton className="h-3.5 w-56 max-w-full" />
            <Skeleton className="h-3.5 w-36" />
        </div>
    );
}

function ScoreSummary({
    metricScore,
    judgeScore,
    details,
}: {
    metricScore: number | null | undefined;
    judgeScore: number | null | undefined;
    details: ReturnType<typeof toTranscriptMetricDetails>;
}) {
    return (
        <div className="flex flex-col items-end">
            <Num>{fmtScore(metricScore ?? judgeScore, STT_SCORE_DIGITS)}</Num>
            {details ? <InlineRates details={details} /> : null}
        </div>
    );
}

function InspectButton({
    cellId,
    itemId,
    nodeLabel,
    expanded,
    onInspect,
}: {
    cellId: string;
    itemId: string;
    nodeLabel: string;
    expanded: boolean;
    onInspect: (cellId: string) => void;
}) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-expanded={expanded}
            aria-label={`Open details for ${nodeLabel}, item ${itemId.slice(0, 8)}`}
            onClick={() => onInspect(cellId)}
            className="size-8 justify-self-end text-muted-foreground hover:text-foreground focus-visible:opacity-100 aria-expanded:opacity-100 max-md:col-start-3 max-md:row-start-2 lg:opacity-0 lg:group-hover/item:opacity-100"
        >
            <PanelRight className="size-4" aria-hidden="true" />
        </Button>
    );
}
