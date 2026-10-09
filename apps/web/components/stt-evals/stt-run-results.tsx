"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import type { IWorkflowRunDetailResponse } from "@mosaic/api-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
    BranchStatusBadge,
    CellStatusBadge,
    PendingScore,
    isCellInFlight,
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
    TranscriptJudgeBreakdown,
    TranscriptMetricBreakdown,
} from "@/components/runs/transcript-score-details";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    LlmExecutionDetails,
    LlmRouteSummary,
} from "./llm-execution-provenance";

function rootByNode(detail: IWorkflowRunDetailResponse): Map<string, string> {
    const nodes = detail.workflowRun.workflowSnapshot.nodes;
    const keyById = new Map(nodes.map((node) => [node.id, node.nodeKey]));
    const roots = new Map(
        nodes
            .filter((node) => node.nodeType === "stt")
            .map((node) => [node.nodeKey, node.nodeKey]),
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
    const snapshotNodes = detail.workflowRun.workflowSnapshot.nodes;
    const ownership = rootByNode(detail);
    const roots = snapshotNodes.filter((node) => node.nodeType === "stt");
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
    const resultRows = detail.items.flatMap((item) =>
        detail.cells
            .filter((cell) => cell.datasetItemId === item.id)
            .map((cell) => {
                const node = snapshotNodes.find(
                    (candidate) => candidate.nodeKey === cell.nodeKey,
                );
                const root = roots.find(
                    (candidate) =>
                        candidate.nodeKey === ownership.get(cell.nodeKey),
                );
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
                    node,
                    root,
                    metricScore,
                    judgeScore,
                    metricDetails: toTranscriptMetricDetails(
                        metricScore?.detailsJson,
                    ),
                };
            }),
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
            <Card>
                <CardHeader className="flex-col items-start justify-between gap-4 sm:flex-row">
                    <div className="flex flex-col gap-1">
                        <CardTitle as="h2">Item outputs</CardTitle>
                        <p className="text-copy-14 text-muted-foreground">
                            Compact previews keep long transcripts out of the
                            results list. Open a row for complete evidence.
                        </p>
                    </div>
                    <p className="text-copy-14 text-muted-foreground">
                        <Num>{resultRows.length}</Num> result
                        {resultRows.length === 1 ? "" : "s"}
                    </p>
                </CardHeader>
                <CardContent>
                    <div className="hidden overflow-x-auto md:block">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Item</TableHead>
                                    <TableHead>Path</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="w-[28%]">
                                        Input preview
                                    </TableHead>
                                    <TableHead className="w-[28%]">
                                        Output preview
                                    </TableHead>
                                    <TableHead>Route</TableHead>
                                    <TableHead align="numeric">Score</TableHead>
                                    <TableHead>
                                        <span className="sr-only">Actions</span>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {resultRows.map((row) => (
                                    <TableRow key={row.cell.id}>
                                        <TableCell className="text-mono-13">
                                            {row.item.id.slice(0, 8)}
                                        </TableCell>
                                        <TableCell>
                                            <p className="text-label-14">
                                                {row.node?.label ??
                                                    row.cell.nodeKey}
                                            </p>
                                            <p className="text-label-12 text-muted-foreground">
                                                {row.root?.label ??
                                                    MISSING_VALUE}
                                            </p>
                                        </TableCell>
                                        <TableCell>
                                            <CellStatusBadge
                                                status={row.cell.status}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <ArtifactPreview
                                                text={row.cell.inputText}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            {isCellInFlight(row.cell.status) ? (
                                                <PendingPreview />
                                            ) : (
                                                <ArtifactPreview
                                                    text={cellOutput(row.cell)}
                                                />
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <LlmRouteSummary
                                                execution={
                                                    row.cell.llmExecution
                                                }
                                            />
                                        </TableCell>
                                        <TableCell align="numeric">
                                            {isCellInFlight(row.cell.status) ? (
                                                <PendingScore />
                                            ) : (
                                                <ScoreSummary
                                                    metricScore={
                                                        row.metricScore?.score
                                                    }
                                                    judgeScore={
                                                        row.judgeScore?.score
                                                    }
                                                    details={row.metricDetails}
                                                />
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <InspectButton
                                                cellId={row.cell.id}
                                                itemId={row.item.id}
                                                nodeLabel={
                                                    row.node?.label ??
                                                    row.cell.nodeKey
                                                }
                                                expanded={
                                                    selectedCellId ===
                                                    row.cell.id
                                                }
                                                onInspect={setSelectedCellId}
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="flex flex-col gap-3 md:hidden">
                        {resultRows.map((row) => (
                            <article
                                key={row.cell.id}
                                className="flex flex-col gap-4 border-t border-border pt-3 first:border-t-0 first:pt-0"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex flex-col gap-1">
                                        <p className="text-label-14">
                                            {row.node?.label ??
                                                row.cell.nodeKey}
                                        </p>
                                        <p className="text-mono-13 text-muted-foreground">
                                            {row.item.id.slice(0, 8)} ·{" "}
                                            {row.root?.label ?? MISSING_VALUE}
                                        </p>
                                    </div>
                                    <CellStatusBadge status={row.cell.status} />
                                </div>
                                <div className="grid gap-3">
                                    <LabeledPreview
                                        label="Input"
                                        text={row.cell.inputText}
                                    />
                                    {isCellInFlight(row.cell.status) ? (
                                        <div className="flex flex-col gap-1">
                                            <p className="text-label-12">
                                                Output
                                            </p>
                                            <PendingPreview />
                                        </div>
                                    ) : (
                                        <LabeledPreview
                                            label="Output"
                                            text={cellOutput(row.cell)}
                                        />
                                    )}
                                    <LlmRouteSummary
                                        execution={row.cell.llmExecution}
                                    />
                                </div>
                                <div className="flex items-end justify-between gap-3 border-t border-border pt-3">
                                    {isCellInFlight(row.cell.status) ? (
                                        <PendingScore />
                                    ) : (
                                        <ScoreSummary
                                            metricScore={row.metricScore?.score}
                                            judgeScore={row.judgeScore?.score}
                                            details={row.metricDetails}
                                        />
                                    )}
                                    <InspectButton
                                        cellId={row.cell.id}
                                        itemId={row.item.id}
                                        nodeLabel={
                                            row.node?.label ?? row.cell.nodeKey
                                        }
                                        expanded={
                                            selectedCellId === row.cell.id
                                        }
                                        onInspect={setSelectedCellId}
                                    />
                                </div>
                            </article>
                        ))}
                    </div>
                </CardContent>
            </Card>
            <CellScoreInspector
                detail={detail}
                cellId={selectedCellId}
                onClose={() => setSelectedCellId(undefined)}
            />
        </div>
    );
}

// STT metric scores (WER-style fractions) read to three places.
const STT_SCORE_DIGITS = 3;

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

function ArtifactPreview({ text }: { text: string | null | undefined }) {
    return (
        <p className="line-clamp-3 max-w-72 whitespace-pre-wrap wrap-break-word text-copy-14 leading-5 text-muted-foreground">
            {text || MISSING_VALUE}
        </p>
    );
}

// Stands in for a transcript preview (two `leading-5` lines) until the cell
// produces output.
function PendingPreview() {
    return (
        <div className="flex max-w-72 flex-col gap-2 py-0.5">
            <Skeleton className="h-3.5 w-56 max-w-full" />
            <Skeleton className="h-3.5 w-36" />
        </div>
    );
}

function LabeledPreview({
    label,
    text,
}: {
    label: string;
    text: string | null | undefined;
}) {
    return (
        <div className="flex flex-col gap-1">
            <p className="text-label-12">{label}</p>
            <ArtifactPreview text={text} />
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
        <div className="flex min-w-28 flex-col items-end">
            <Num>{fmtScore(metricScore ?? judgeScore, STT_SCORE_DIGITS)}</Num>
            <InlineRates details={details} />
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
            variant="secondary"
            aria-expanded={expanded}
            aria-label={`Inspect score details for ${nodeLabel}, item ${itemId.slice(0, 8)}`}
            onClick={() => onInspect(cellId)}
        >
            <Eye className="size-4" aria-hidden="true" />
            View
        </Button>
    );
}

function cellOutput(
    cell: IWorkflowRunDetailResponse["cells"][number],
): string | undefined {
    const segments = transcriptSegments(cell);
    if (segments.length > 0) {
        return segments
            .map(
                (segment) =>
                    `${speakerLabel(segment.speaker)} ${formatTimeRange(segment)}: ${segment.text}`,
            )
            .join(" ");
    }
    return cell.outputJson?.text || cell.error || undefined;
}

type TranscriptSegment = NonNullable<
    NonNullable<
        IWorkflowRunDetailResponse["cells"][number]["outputJson"]
    >["segments"]
>[number];

function transcriptSegments(
    cell: IWorkflowRunDetailResponse["cells"][number],
): TranscriptSegment[] {
    const segments = cell.outputJson?.segments;
    return Array.isArray(segments)
        ? segments.filter(
              (segment): segment is TranscriptSegment =>
                  typeof segment === "object" &&
                  segment !== null &&
                  typeof segment.text === "string" &&
                  segment.text.trim().length > 0,
          )
        : [];
}

function speakerLabel(speaker: string | undefined): string {
    return speaker ? `Speaker ${speaker}` : `Speaker ${MISSING_VALUE}`;
}

function formatTimeRange(segment: TranscriptSegment): string {
    const start = formatMilliseconds(segment.startMs);
    const end = formatMilliseconds(segment.endMs);
    return start || end
        ? `${start ?? MISSING_VALUE}–${end ?? MISSING_VALUE}`
        : MISSING_VALUE;
}

function formatMilliseconds(value: number | undefined): string | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? `${(value / 1000).toFixed(2)}s`
        : undefined;
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

function InlineRates({
    details,
}: {
    details: ReturnType<typeof toTranscriptMetricDetails>;
}) {
    return (
        <span className="text-label-12 text-muted-foreground">
            WER {details ? formatTranscriptPercent(details.wer) : MISSING_VALUE}{" "}
            / CER{" "}
            {details ? formatTranscriptPercent(details.cer) : MISSING_VALUE}
        </span>
    );
}

function CellScoreInspector({
    detail,
    cellId,
    onClose,
}: {
    detail: IWorkflowRunDetailResponse;
    cellId: string | undefined;
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
    return (
        <Sheet
            open={cell !== undefined}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <SheetContent className="max-w-2xl">
                <SheetHeader>
                    <div className="flex flex-wrap items-center gap-2 pr-8">
                        <SheetTitle>
                            {node?.label ?? cell?.nodeKey ?? "Score details"}
                        </SheetTitle>
                        {cell ? <CellStatusBadge status={cell.status} /> : null}
                    </div>
                    <InspectorMeta
                        itemId={item?.id}
                        score={inspectorScore(metricScore, judgeScore)}
                    />
                </SheetHeader>
                <SheetBody>
                    <Tabs
                        key={cell?.id}
                        defaultValue="overview"
                        className="min-w-0"
                    >
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="overview">Overview</TabsTrigger>
                            <TabsTrigger value="input">Input</TabsTrigger>
                            <TabsTrigger value="output">Output</TabsTrigger>
                        </TabsList>
                        <TabsContent
                            value="overview"
                            className="flex flex-col gap-6"
                        >
                            <LlmExecutionDetails
                                execution={cell?.llmExecution}
                            />
                            <TranscriptMetricBreakdown score={metricScore} />
                            <TranscriptJudgeBreakdown score={judgeScore} />
                        </TabsContent>
                        <TabsContent value="input">
                            <FullArtifact
                                label="Full input"
                                text={inputTextOf(cell)}
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
                            />
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
                    </Tabs>
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}

// The inspector's props take undefined, not the API's null.
function inspectorScore(
    metric: { score: number | null } | undefined,
    judge: { score: number | null } | undefined,
): number | undefined {
    return metric?.score ?? judge?.score ?? undefined;
}

function inputTextOf(
    cell: IWorkflowRunDetailResponse["cells"][number] | undefined,
): string | undefined {
    return cell?.inputText ?? undefined;
}

function InspectorMeta({
    itemId,
    score,
}: {
    itemId: string | undefined;
    score: number | undefined;
}) {
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
            <span>
                Score <Num>{fmtScore(score, STT_SCORE_DIGITS)}</Num>
            </span>
        </div>
    );
}

function FullArtifact({
    label,
    text,
}: {
    label: string;
    text: string | undefined;
}) {
    return (
        <section aria-label={label} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <SectionTitle as="h3">{label}</SectionTitle>
                {text ? <CopyButton value={text} what={label} /> : null}
            </div>
            <Card variant="inset" className="p-4">
                <p className="max-w-prose whitespace-pre-wrap wrap-break-word text-copy-14">
                    {text || MISSING_VALUE}
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
