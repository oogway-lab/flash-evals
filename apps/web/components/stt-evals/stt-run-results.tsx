"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { IWorkflowRunDetailResponse } from "@mosaic/api-contract";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import {
    BranchStatusBadge,
    CellStatusBadge,
    type BranchStatus,
} from "@/components/ui/status-badge";
import { SectionTitle } from "@/components/layout/section-title";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JsonBlock } from "@/components/ui/json-block";
import { MISSING_VALUE, fmtScore, formatCostColumn } from "@/lib/format";
import { CopyButton } from "@/components/ui/copy-button";
import { IdLabel } from "@/components/ui/id-label";
import { Metric, MetricList } from "@/components/ui/metric";
import { Num } from "@/components/ui/num";
import { toTranscriptMetricDetails } from "@/components/runs/types";
import {
    formatTranscriptPercent,
    ScoreVerdict,
    TranscriptJudgeBreakdown,
    TranscriptMetricBreakdown,
} from "@/components/runs/transcript-score-details";
import {
    LlmExecutionDetails,
    LlmExecutionSummary,
} from "./llm-execution-provenance";

import {
    BlockedCellLink,
    blockedByCell,
    useWorkflowCellNavigation,
    visibleWorkflowCell,
} from "./workflow-cell-link";
import {
    ItemOutputs,
    pipelineOrder,
    type ItemGroup,
    type ResultRow,
} from "./item-outputs";
import {
    AudioRecording,
    STT_SCORE_DIGITS,
    cellOutput,
    formatTimeRange,
    isAudioItem,
    speakerLabel,
    transcriptSegments,
} from "./run-artifacts";

/** Multi-modal pipelines start at input; legacy STT evaluations start at STT. */
function branchRoots(detail: IWorkflowRunDetailResponse) {
    const snapshot = detail.workflowRun.workflowSnapshot;
    const type = snapshot.kind === "stt" ? "stt" : "input";
    return snapshot.nodes.filter((node) => node.nodeType === type);
}

function rootByNode(detail: IWorkflowRunDetailResponse): Map<string, string> {
    const nodes = detail.workflowRun.workflowSnapshot.nodes;
    const keyById = new Map(nodes.map((node) => [node.id, node.nodeKey]));
    const roots = new Map(
        branchRoots(detail).map((node) => [node.nodeKey, node.nodeKey]),
    );
    for (let pass = 0; pass < nodes.length; pass += 1)
        for (const edge of detail.edges) {
            const source = keyById.get(edge.fromNodeId);
            const target = keyById.get(edge.toNodeId);
            if (source && target && roots.has(source))
                roots.set(target, roots.get(source)!);
        }
    return roots;
}

function branchStatus(
    cells: IWorkflowRunDetailResponse["cells"],
    runStatus: IWorkflowRunDetailResponse["workflowRun"]["status"],
): BranchStatus {
    if (cells.some((cell) => cell.status === "failed")) return "failed";
    const pending = cells.filter((cell) => cell.status === "pending").length;
    if (cells.some((cell) => cell.status === "running")) return "running";
    if (pending > 0) return pending === cells.length ? "pending" : "running";
    if (
        cells.length === 0 &&
        (runStatus === "pending" || runStatus === "running")
    )
        return "pending";
    return "completed";
}

function branchCellsFor(
    detail: IWorkflowRunDetailResponse,
    ownership: Map<string, string>,
    rootKey: string,
): IWorkflowRunDetailResponse["cells"] {
    const branchKeys = new Set(
        [...ownership]
            .filter(([, owner]) => owner === rootKey)
            .map(([key]) => key),
    );
    return detail.cells.filter((cell) => branchKeys.has(cell.nodeKey));
}

function branchCosts(cells: IWorkflowRunDetailResponse["cells"]): number[] {
    return cells
        .map((cell) => cell.outputJson?.usage?.costUsd ?? cell.costUsd)
        .filter((cost): cost is number => typeof cost === "number");
}

function diffKeys(configs: Array<Record<string, unknown>>): string[][] {
    const keys = [...new Set(configs.flatMap((config) => Object.keys(config)))];
    return configs.map((config, index) =>
        keys.filter((key) =>
            configs.some(
                (other, otherIndex) =>
                    otherIndex !== index &&
                    JSON.stringify(other[key]) !== JSON.stringify(config[key]),
            ),
        ),
    );
}

function aggregateUsage(cells: IWorkflowRunDetailResponse["cells"]) {
    const totals: Record<
        "promptTokens" | "completionTokens" | "thinkingTokens",
        number | undefined
    > = {
        promptTokens: undefined,
        completionTokens: undefined,
        thinkingTokens: undefined,
    };
    for (const cell of cells) {
        const usage = cell.outputJson?.usage;
        for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
            const value = usage?.[key];
            if (typeof value === "number")
                totals[key] = (totals[key] ?? 0) + value;
        }
    }
    return totals;
}

function formatTokens(value: number | undefined): string {
    return value === undefined ? MISSING_VALUE : value.toLocaleString();
}

export function SttRunResults({
    detail,
}: {
    detail: IWorkflowRunDetailResponse;
}) {
    const [selectedCellId, setSelectedCellId] = useState<string>();
    const { highlightedCellId, revealCell } = useWorkflowCellNavigation(detail);
    const revealUpstream = (id: string, href: string) => {
        setSelectedCellId(undefined);
        revealCell(id, href);
    };
    const snapshotNodes = detail.workflowRun.workflowSnapshot.nodes;
    const ownership = rootByNode(detail);
    const roots = branchRoots(detail);
    const configs: Array<Record<string, unknown>> = roots.map((node) =>
        node.nodeConfig?.type === "stt"
            ? {
                  modelId: node.nodeConfig.sttConfig.modelId,
                  language: node.nodeConfig.sttConfig.language,
                  ...node.nodeConfig.sttConfig.config,
              }
            : {},
    );
    const diffs = diffKeys(configs);
    // One unit and precision for the "Reported cost" tile of every branch.
    const fmtBranchCost = formatCostColumn(
        roots.map((root) => {
            const costs = branchCosts(
                branchCellsFor(detail, ownership, root.nodeKey),
            );
            return costs.length === 0
                ? undefined
                : costs.reduce((sum, cost) => sum + cost, 0);
        }),
    );
    const stepOrder = pipelineOrder(detail, ownership, roots);
    const itemGroups: ItemGroup[] = detail.items
        .map((item) => ({
            item,
            rows: detail.cells
                .filter((cell) => cell.datasetItemId === item.id)
                .sort(
                    (a, b) =>
                        (stepOrder.get(a.nodeKey) ?? Infinity) -
                        (stepOrder.get(b.nodeKey) ?? Infinity),
                )
                .map((cell): ResultRow => {
                    const scores = detail.scoresByCell[cell.id] ?? [];
                    const metricScore = scores.find(
                        (score) => score.scorerType === "transcript_metric",
                    );
                    const judgeScore = scores.find(
                        (score) => score.scorerType === "transcript_judge",
                    );
                    return {
                        item,
                        cell,
                        node: snapshotNodes.find(
                            (candidate) => candidate.nodeKey === cell.nodeKey,
                        ),
                        root: roots.find(
                            (candidate) =>
                                candidate.nodeKey ===
                                ownership.get(cell.nodeKey),
                        ),
                        metricScore,
                        judgeScore,
                        metricDetails: toTranscriptMetricDetails(
                            metricScore?.detailsJson,
                        ),
                    };
                }),
        }))
        .filter((group) => group.rows.length > 0);
    const hasScores = Object.values(detail.scoresByCell).some(
        (scores) => scores.length > 0,
    );
    return (
        <div className="flex flex-col gap-6">
            <div className="grid gap-4 lg:grid-cols-2">
                {roots.map((root, rootIndex) => {
                    const cells = branchCellsFor(
                        detail,
                        ownership,
                        root.nodeKey,
                    );
                    const failed = cells.some(
                        (cell) => cell.status === "failed",
                    );
                    const status = branchStatus(
                        cells,
                        detail.workflowRun.status,
                    );
                    const scores = cells
                        .flatMap((cell) => detail.scoresByCell[cell.id] ?? [])
                        .filter(
                            (score) =>
                                score.scorerType === "transcript_metric" ||
                                score.scorerType === "transcript_judge",
                        );
                    const numeric = scores
                        .map((score) => score.score)
                        .filter(
                            (score): score is number =>
                                typeof score === "number",
                        );
                    const metricDetails = scores
                        .filter(
                            (score) => score.scorerType === "transcript_metric",
                        )
                        .map((score) =>
                            toTranscriptMetricDetails(score.detailsJson),
                        )
                        .filter((details) => details !== undefined);
                    const hardFailureCount = metricDetails.reduce(
                        (count, details) =>
                            count + (details.hardFailures?.length ?? 0),
                        0,
                    );
                    const costs = branchCosts(cells);
                    const { promptTokens, completionTokens, thinkingTokens } =
                        aggregateUsage(cells);
                    return (
                        <Card key={root.nodeKey}>
                            <CardHeader>
                                <div className="flex flex-wrap items-center gap-2">
                                    <CardTitle as="h2">{root.label}</CardTitle>
                                    <BranchStatusBadge status={status} />
                                    {hardFailureCount > 0 ? (
                                        <Badge variant="danger">
                                            {hardFailureCount} hard failure
                                            {hardFailureCount === 1 ? "" : "s"}
                                        </Badge>
                                    ) : null}
                                </div>
                                {diffs[rootIndex]?.length ? (
                                    <p className="text-copy-14 text-muted-foreground">
                                        {diffs[rootIndex]
                                            .map(
                                                (key) =>
                                                    `${key}: ${String(configs[rootIndex]?.[key] ?? "default")}`,
                                            )
                                            .join(" · ")}
                                    </p>
                                ) : null}
                            </CardHeader>
                            <CardContent>
                                <MetricList className="grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
                                    <Metric
                                        plain
                                        label="Average score"
                                        value={
                                            failed
                                                ? MISSING_VALUE
                                                : averageScore(numeric)
                                        }
                                    />
                                    <Metric
                                        plain
                                        label="Average WER"
                                        value={formatAverage(
                                            metricDetails.map((d) => d.wer),
                                        )}
                                    />
                                    <Metric
                                        plain
                                        label="Average CER"
                                        value={formatAverage(
                                            metricDetails.map((d) => d.cer),
                                        )}
                                    />
                                    <Metric
                                        plain
                                        label="Reported cost"
                                        value={totalCost(costs, fmtBranchCost)}
                                    />
                                    <Metric
                                        plain
                                        label="Input tokens"
                                        value={formatTokens(promptTokens)}
                                    />
                                    <Metric
                                        plain
                                        label="Output tokens"
                                        value={formatTokens(completionTokens)}
                                    />
                                    <Metric
                                        plain
                                        label="Thinking tokens"
                                        value={formatTokens(thinkingTokens)}
                                    />
                                </MetricList>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
            <ItemOutputs
                detail={detail}
                groups={itemGroups}
                showBranch={roots.length > 1}
                showScores={hasScores}
                highlightedCellId={highlightedCellId}
                selectedCellId={selectedCellId}
                onInspect={setSelectedCellId}
                onReveal={revealUpstream}
            />
            <CellScoreInspector
                detail={detail}
                cellId={selectedCellId}
                highlightedCellId={highlightedCellId}
                onReveal={revealUpstream}
                onClose={() => setSelectedCellId(undefined)}
            />
        </div>
    );
}

function averageScore(scores: number[]): string {
    if (scores.length === 0) return MISSING_VALUE;
    return fmtScore(
        scores.reduce((sum, score) => sum + score, 0) / scores.length,
        STT_SCORE_DIGITS,
    );
}

function totalCost(
    costs: number[],
    format: ReturnType<typeof formatCostColumn>,
): string {
    if (costs.length === 0) return MISSING_VALUE;
    return format(costs.reduce((sum, cost) => sum + cost, 0));
}

function SpeakerTurns({
    cell,
}: {
    cell: IWorkflowRunDetailResponse["cells"][number];
}) {
    const segments = transcriptSegments(cell);
    if (segments.length === 0) return null;
    return (
        <section
            aria-label="Diarized transcript"
            className="flex flex-col gap-3"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionTitle
                    as="h3"
                    description="Provider-returned diarization with segment timestamps."
                >
                    Speaker turns
                </SectionTitle>
                <p className="text-copy-14 text-muted-foreground">
                    <Num>{segments.length}</Num> turn
                    {segments.length === 1 ? "" : "s"}
                </p>
            </div>
            <ol className="flex flex-col gap-2">
                {segments.map((segment, index) => (
                    <li key={`${segment.startMs ?? "unknown"}-${index}`}>
                        <Card
                            variant="inset"
                            className="flex flex-col gap-2 p-3"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-2 text-label-12">
                                <span className="text-label-14 text-on-surface">
                                    {speakerLabel(segment.speaker)}
                                </span>
                                <span className="text-copy-14 tabular-nums text-muted-foreground">
                                    {formatTimeRange(segment)}
                                </span>
                            </div>
                            <p className="whitespace-pre-wrap text-copy-14 text-on-surface">
                                {segment.text}
                            </p>
                            {segment.language ? (
                                <p className="text-label-12 text-muted-foreground">
                                    {segment.language}
                                </p>
                            ) : null}
                        </Card>
                    </li>
                ))}
            </ol>
        </section>
    );
}

function CellScoreInspector({
    detail,
    cellId,
    highlightedCellId,
    onReveal,
    onClose,
}: {
    detail: IWorkflowRunDetailResponse;
    cellId: string | undefined;
    highlightedCellId: string | undefined;
    onReveal: (id: string, href: string) => void;
    onClose: () => void;
}) {
    const cell = detail.cells.find((candidate) => candidate.id === cellId);
    const item = detail.items.find(
        (candidate) => candidate.id === cell?.datasetItemId,
    );
    const node = detail.workflowRun.workflowSnapshot.nodes.find(
        (candidate) => candidate.nodeKey === cell?.nodeKey,
    );
    const scores = cell ? (detail.scoresByCell[cell.id] ?? []) : [];
    const metricScore = scores.find(
        (score) => score.scorerType === "transcript_metric",
    );
    const judgeScore = scores.find(
        (score) => score.scorerType === "transcript_judge",
    );
    const execution = cell?.llmExecution;
    return (
        <Sheet
            open={cell !== undefined}
            onOpenChangeComplete={(open) => {
                if (!open && highlightedCellId) {
                    requestAnimationFrame(() => {
                        visibleWorkflowCell(highlightedCellId)?.focus({
                            preventScroll: true,
                        });
                    });
                }
            }}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <SheetContent
                className="max-w-2xl"
                finalFocus={() =>
                    highlightedCellId
                        ? (visibleWorkflowCell(highlightedCellId) ?? true)
                        : true
                }
            >
                <SheetHeader>
                    <div className="flex flex-wrap items-center gap-2 pr-8">
                        <SheetTitle>
                            {node?.label ?? cell?.nodeKey ?? "Score details"}
                        </SheetTitle>
                        {cell ? <CellStatusBadge status={cell.status} /> : null}
                    </div>
                    <InspectorMeta itemId={item?.id} />
                </SheetHeader>
                <SheetBody>
                    <Tabs
                        key={cell?.id}
                        defaultValue="overview"
                        className="min-w-0"
                    >
                        <InspectorTabsList hasRouting={!!execution} />
                        <TabsContent
                            value="overview"
                            className="flex flex-col gap-8"
                        >
                            <InspectorOverview
                                metricScore={metricScore}
                                judgeScore={judgeScore}
                                execution={execution}
                            />
                        </TabsContent>
                        <TabsContent
                            value="input"
                            className="flex flex-col gap-6"
                        >
                            <InspectorInput
                                item={item}
                                cell={cell}
                                isInputNode={node?.nodeType === "input"}
                            />
                        </TabsContent>
                        <TabsContent
                            value="output"
                            className="flex flex-col gap-6"
                        >
                            {cell && <SpeakerTurns cell={cell} />}
                            <FullArtifact
                                label="Full output"
                                text={cell ? cellOutput(cell) : undefined}
                                audioItem={
                                    node?.nodeType === "input"
                                        ? item
                                        : undefined
                                }
                            >
                                {cell && blockedByCell(detail, cell) && (
                                    <BlockedCellLink
                                        detail={detail}
                                        cell={cell}
                                        onReveal={onReveal}
                                    />
                                )}
                            </FullArtifact>
                            {cell?.outputJson && (
                                <section
                                    aria-label="Raw output payload"
                                    className="flex flex-col gap-2"
                                >
                                    <SectionTitle as="h3">
                                        Raw output payload
                                    </SectionTitle>
                                    <JsonBlock
                                        data={cell.outputJson}
                                        collapsible
                                        defaultOpen={false}
                                    />
                                </section>
                            )}
                        </TabsContent>
                        {/* No trigger without an execution, so never shown. */}
                        <TabsContent value="routing">
                            <LlmExecutionDetails execution={execution} />
                        </TabsContent>
                    </Tabs>
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}

/** Routing appears only for steps that made an LLM call. */
function InspectorTabsList({ hasRouting }: { hasRouting: boolean }) {
    return (
        <TabsList
            className={cn(
                "grid w-full",
                hasRouting ? "grid-cols-4" : "grid-cols-3",
            )}
        >
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="input">Input</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
            {hasRouting ? (
                <TabsTrigger value="routing">Routing</TabsTrigger>
            ) : null}
        </TabsList>
    );
}

type CellScore = IWorkflowRunDetailResponse["scoresByCell"][string][number];

/** Answer first (scores, model, cost), then the evidence behind the score. */
function InspectorOverview({
    metricScore,
    judgeScore,
    execution,
}: {
    metricScore: CellScore | undefined;
    judgeScore: CellScore | undefined;
    execution: IWorkflowRunDetailResponse["cells"][number]["llmExecution"];
}) {
    if (!metricScore && !judgeScore && !execution)
        return (
            <p className="text-copy-14 text-muted-foreground">
                This step has no scores or model call. Its input and output are
                in the other tabs.
            </p>
        );
    return (
        <>
            <div className="flex flex-col gap-6">
                <ScoreVerdict
                    metric={metricScore}
                    judge={judgeScore}
                    digits={STT_SCORE_DIGITS}
                />
                <LlmExecutionSummary execution={execution} />
            </div>
            <TranscriptJudgeBreakdown score={judgeScore} />
            <TranscriptMetricBreakdown score={metricScore} />
        </>
    );
}

function InspectorInput({
    item,
    cell,
    isInputNode,
}: {
    item: IWorkflowRunDetailResponse["items"][number] | undefined;
    cell: IWorkflowRunDetailResponse["cells"][number] | undefined;
    isInputNode: boolean;
}) {
    const audioItem = item && isAudioItem(item) ? item : undefined;
    return (
        <>
            {audioItem && (
                <section
                    aria-label="Original recording"
                    className="flex flex-col gap-2"
                >
                    <SectionTitle as="h3">Original recording</SectionTitle>
                    <AudioRecording key={audioItem.id} item={audioItem} />
                </section>
            )}
            {(!isInputNode || !audioItem) && (
                <FullArtifact label="Full input" text={inputTextOf(cell)} />
            )}
        </>
    );
}

function inputTextOf(
    cell: IWorkflowRunDetailResponse["cells"][number] | undefined,
): string | undefined {
    return cell?.inputText ?? undefined;
}

function InspectorMeta({ itemId }: { itemId: string | undefined }) {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-copy-14 text-muted-foreground">
            <span className="inline-flex items-center gap-1">
                Item
                {itemId ? (
                    <IdLabel id={itemId} noun="item ID" />
                ) : (
                    <Num>{MISSING_VALUE}</Num>
                )}
            </span>
        </div>
    );
}

function FullArtifact({
    label,
    text,
    children,
    audioItem,
}: {
    label: string;
    text: string | undefined;
    children?: ReactNode;
    audioItem?: IWorkflowRunDetailResponse["items"][number];
}) {
    return (
        <section aria-label={label} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <SectionTitle as="h3">{label}</SectionTitle>
                {text ? <CopyButton value={text} what={label} /> : null}
            </div>
            <Card variant="inset" className="p-4">
                <p className="max-w-prose whitespace-pre-wrap wrap-break-word text-copy-14">
                    {audioItem && isAudioItem(audioItem) ? (
                        <AudioRecording key={audioItem.id} item={audioItem} />
                    ) : (
                        children || text || MISSING_VALUE
                    )}
                </p>
            </Card>
        </section>
    );
}

function formatAverage(values: number[]): string {
    if (values.length === 0) return MISSING_VALUE;
    return formatTranscriptPercent(
        values.reduce((sum, value) => sum + value, 0) / values.length,
    );
}
