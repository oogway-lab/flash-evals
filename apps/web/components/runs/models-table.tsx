"use client";

import { Fragment, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type {
    BenchmarkJudgeCostCovers,
    RunStatus,
} from "@flash-evals/api-contract";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HintText } from "@/components/ui/hint";
import { Num } from "@/components/ui/num";
import {
    BenchmarkReferenceBadge,
    BenchmarkVerdictBadge,
} from "@/components/ui/status-badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    MISSING_VALUE,
    fmtCost,
    fmtPercent,
    fmtScore,
    formatCostColumn,
    plural,
} from "@/lib/format";
import { cn } from "@/lib/cn";
import { fmtPerMillion } from "@/lib/model-prices";
import { transportLabel } from "@/lib/transport";
import { ModelDetails } from "./benchmark-details";
import { goldenScoreLabel, type IGoldenScoreLabel } from "./golden-score";
import {
    describeModelThinking,
    type IModelResult,
    type IModelThinking,
} from "./run-results";

/** Which optional columns this run has data for. */
interface IColumns {
    comparison: boolean;
    reference: IModelResult | undefined;
    winOrTie: boolean;
    /** The stored-answer field match, shown only on runs without a benchmark. */
    golden: boolean;
    goldenLabel: IGoldenScoreLabel;
    judge: boolean;
    transcript: boolean;
    /** Setup comparisons: the ranking accuracy column. */
    accuracy: boolean;
    /** Setup comparisons: items scored, waiting and failed. */
    progress: boolean;
    fmtCostValue: (value: number | undefined) => string;
    maxCost: number;
}

function columnsFor(
    results: IModelResult[],
    goldenLabel: IGoldenScoreLabel,
): IColumns {
    const costs = results.map((result) => result.costPerCall);
    const comparison = results.some((result) => result.comparison);
    return {
        comparison,
        reference: results.find((result) => result.isReference),
        winOrTie: results.some(
            (result) => result.comparison?.winOrTieRate !== undefined,
        ),
        // The benchmark tasks are the real comparison; the field match is
        // exact on every stored field unless settings were saved.
        golden:
            !comparison &&
            results.some((result) => result.goldenScore !== undefined),
        goldenLabel,
        judge: results.some((result) => result.judgeScore !== undefined),
        transcript: results.some(
            (result) =>
                result.transcriptScore !== undefined ||
                result.wer !== undefined,
        ),
        accuracy: results.some((result) => result.accuracy !== undefined),
        progress: results.some((result) => result.progress !== undefined),
        fmtCostValue: formatCostColumn(costs),
        maxCost: Math.max(0, ...costs.map((cost) => cost ?? 0)),
    };
}

/** Latency in seconds, one decimal, so the whole column shares a unit. */
function fmtSeconds(ms: number | undefined): string {
    return ms === undefined ? MISSING_VALUE : `${(ms / 1000).toFixed(1)} s`;
}

function fmtListPrice(result: IModelResult): string {
    const info = result.info;
    if (
        info?.inputPerMillion === undefined ||
        info.outputPerMillion === undefined
    )
        return MISSING_VALUE;
    return `${fmtPerMillion(info.inputPerMillion)} / ${fmtPerMillion(info.outputPerMillion)}`;
}

/** The row's name, linking to its run on setup comparisons. */
function NameText({ result }: { result: IModelResult }) {
    return result.href ? (
        <Link
            href={result.href as Route}
            className="text-label-14 text-on-surface underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
            {result.name}
        </Link>
    ) : (
        <span className="text-label-14 text-on-surface">{result.name}</span>
    );
}

function ModelName({
    result,
    price,
}: {
    result: IModelResult;
    /** List price in / out per 1M tokens, when known. */
    price?: string;
}) {
    return (
        <span className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
                <NameText result={result} />
                {result.isReference && (
                    <Badge variant="ref">Today&apos;s model</Badge>
                )}
            </span>
            {result.notBeaten && (
                <span className="text-label-12 text-on-surface">
                    Not beaten on accuracy and cost
                </span>
            )}
            {result.name !== result.modelId && (
                <span className="text-mono-13 text-muted-foreground">
                    {result.modelId}
                </span>
            )}
            {(result.info?.provider || (price && price !== MISSING_VALUE)) && (
                <span className="text-label-12 text-muted-foreground">
                    {result.info?.provider &&
                        `via ${transportLabel(result.info.provider)}`}
                    {result.info?.provider &&
                        price &&
                        price !== MISSING_VALUE &&
                        " · "}
                    {price && price !== MISSING_VALUE && (
                        <>
                            <Num>{price}</Num> per 1M tokens in / out
                        </>
                    )}
                </span>
            )}
            <ModelRouteNotes result={result} />
        </span>
    );
}

/** Who served the model's answers, the thinking and temperature it used. */
function ModelRouteNotes({ result }: { result: IModelResult }) {
    return (
        <>
            {result.servedBy && result.servedBy.length > 0 && (
                <span className="text-label-12 text-muted-foreground">
                    {`Served by ${result.servedBy
                        .map(({ host, answers }) => `${host} (${answers})`)
                        .join(", ")}`}
                </span>
            )}
            {result.thinking && (
                <ModelThinkingNote thinking={result.thinking} />
            )}
            {result.temperature !== undefined && (
                <span className="text-label-12 text-muted-foreground">
                    Temperature <Num>{result.temperature}</Num>
                </span>
            )}
        </>
    );
}

function ModelThinkingNote({ thinking }: { thinking: IModelThinking }) {
    const { text, warning } = describeModelThinking(thinking);
    return (
        <>
            {text && (
                <span className="text-label-12 text-muted-foreground">
                    {text}
                </span>
            )}
            {warning && (
                <span role="note" className="text-label-12 text-warning">
                    {warning}
                </span>
            )}
        </>
    );
}

function hasDetails(result: IModelResult): boolean {
    const summary = result.comparison;
    if (!summary) return false;
    return (
        summary.tasks.length > 0 ||
        (summary.assessment?.reasons.length ?? 0) > 0
    );
}

function ExpandButton({
    result,
    expanded,
    onToggle,
    detailsId,
}: {
    result: IModelResult;
    expanded: boolean;
    onToggle: () => void;
    detailsId: string;
}) {
    if (!hasDetails(result))
        return <span aria-hidden="true" className="inline-block size-8" />;
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-expanded={expanded}
            aria-controls={expanded ? detailsId : undefined}
            aria-label={`${expanded ? "Hide" : "Show"} task details for ${result.name}`}
            onClick={onToggle}
        >
            <ChevronRight
                aria-hidden="true"
                className={cn(
                    "size-4 transition-transform motion-reduce:transition-none",
                    expanded && "rotate-90",
                )}
            />
        </Button>
    );
}

function VerdictValue({ result }: { result: IModelResult }) {
    if (result.isReference || result.comparison?.isReference)
        return <BenchmarkReferenceBadge />;
    const verdict = result.comparison?.assessment?.verdict;
    return verdict ? (
        <BenchmarkVerdictBadge verdict={verdict} />
    ) : (
        <Num>{MISSING_VALUE}</Num>
    );
}

/** Cost per call with a small bar, so the cheapest models stand out at a glance. */
function CostValue({
    result,
    columns,
}: {
    result: IModelResult;
    columns: IColumns;
}) {
    const share =
        result.costPerCall !== undefined && columns.maxCost > 0
            ? Math.max(0.02, result.costPerCall / columns.maxCost)
            : 0;
    return (
        <span className="inline-flex items-center justify-end gap-2">
            {share > 0 && (
                <span
                    aria-hidden="true"
                    className="inline-block h-2 w-16 overflow-hidden rounded-sm bg-muted"
                >
                    <span
                        className={cn(
                            "block h-2",
                            result.isReference
                                ? "bg-muted-foreground"
                                : "bg-foreground",
                        )}
                        style={{ width: `${share * 100}%` }}
                    />
                </span>
            )}
            <Num>{columns.fmtCostValue(result.costPerCall)}</Num>
        </span>
    );
}

function RelativeCostValue({ result }: { result: IModelResult }) {
    if (result.isReference)
        return (
            <span className="text-label-12 text-muted-foreground">
                Baseline
            </span>
        );
    return <Num>{fmtPercent(result.relativeCost)}</Num>;
}

function FailedValue({ result }: { result: IModelResult }) {
    return (
        <span>
            <Num className={cn(result.failedCells > 0 && "text-danger")}>
                {result.failedCells}
            </Num>
            <span className="text-muted-foreground">{` of ${result.cells}`}</span>
        </span>
    );
}

function ProgressValue({
    progress,
}: {
    progress: NonNullable<IModelResult["progress"]>;
}) {
    return (
        <span
            aria-label={`${progress.scored} scored, ${progress.waiting} waiting, ${progress.failed} failed`}
        >
            <Num>{progress.scored}</Num>
            <span className="text-muted-foreground"> / </span>
            <Num>{progress.waiting}</Num>
            <span className="text-muted-foreground"> / </span>
            <Num className={cn(progress.failed > 0 && "text-danger")}>
                {progress.failed}
            </Num>
        </span>
    );
}

/** The figures every layout shows, in column order. */
function metricsFor(
    result: IModelResult,
    columns: IColumns,
): Array<{
    key: string;
    label: string;
    hint?: string;
    value: React.ReactNode;
}> {
    const metrics: Array<{
        key: string;
        label: string;
        hint?: string;
        value: React.ReactNode;
    }> = [];
    if (columns.comparison)
        metrics.push({
            key: "verdict",
            label: "Verdict",
            value: <VerdictValue result={result} />,
        });
    metrics.push({
        key: "cost",
        label: "Cost per call",
        value: <CostValue result={result} columns={columns} />,
    });
    if (columns.reference)
        metrics.push({
            key: "relative",
            label: `Cost vs ${columns.reference.name}`,
            value: <RelativeCostValue result={result} />,
        });
    if (columns.accuracy)
        metrics.push({
            key: "accuracy",
            label: "Accuracy",
            value: <Num>{fmtPercent(result.accuracy)}</Num>,
        });
    // On setup comparisons the accuracy column averages agreement and
    // won-or-tied rates; the task grid shows each.
    if (columns.comparison && !columns.accuracy)
        metrics.push({
            key: "agreement",
            label: "Agreement",
            value: <Num>{fmtPercent(result.comparison?.agreement)}</Num>,
        });
    if (columns.winOrTie && !columns.accuracy)
        metrics.push({
            key: "won",
            label: "Won or tied",
            value: <Num>{fmtPercent(result.comparison?.winOrTieRate)}</Num>,
        });
    if (columns.golden)
        metrics.push({
            key: "golden",
            label: columns.goldenLabel.label,
            hint: columns.goldenLabel.explanation,
            value: <Num>{fmtScore(result.goldenScore)}</Num>,
        });
    if (columns.judge)
        metrics.push({
            key: "judge",
            label: "Judge score",
            value: <Num>{fmtScore(result.judgeScore)}</Num>,
        });
    if (columns.transcript) {
        metrics.push({
            key: "transcript",
            label: "Transcript score",
            value: <Num>{fmtScore(result.transcriptScore)}</Num>,
        });
        metrics.push({
            key: "wer",
            label: "WER",
            value: <Num>{fmtScore(result.wer)}</Num>,
        });
    }
    metrics.push(
        {
            key: "latency",
            label: "Avg latency",
            value: <Num>{fmtSeconds(result.avgLatencyMs)}</Num>,
        },
        columns.progress && result.progress
            ? {
                  key: "items",
                  label: "Scored / waiting / failed",
                  value: <ProgressValue progress={result.progress} />,
              }
            : {
                  key: "failed",
                  label: "Failed items",
                  value: <FailedValue result={result} />,
              },
    );
    return metrics;
}

const HEAD_HINTS: Record<string, string> = {
    cost: "Average cost of one item in this run.",
    agreement:
        "Average share of output fields that match what the model was compared with, across agreement tasks. Failed items count as misses.",
    won: "Share of judged comparisons where the judge rated the answer as good as or better. Failed items count as losses.",
    judge: "Score from the judge prompt. Failed items count as zero.",
    wer: "Average word error rate. Lower is better.",
    failed: "Items this model returned no usable output for.",
    accuracy:
        "Average of the task results (agreement, or the won-or-tied rate for judged tasks). Today's model counts as 100% on tasks compared with its own answers.",
    items: "Items with a scored answer, items not answered or scored yet, and items that failed (they count as misses).",
};

const TEXT_COLUMNS = new Set(["verdict"]);

function ResultRow({
    result,
    columns,
}: {
    result: IModelResult;
    columns: IColumns;
}) {
    const [expanded, setExpanded] = useState(false);
    const detailsId = `model-details-${result.runModelId}`;
    const metrics = metricsFor(result, columns);
    return (
        <Fragment>
            <TableRow
                className={cn("[&>td]:align-middle", expanded && "border-b-0")}
            >
                <TableCell>
                    <span className="flex items-center gap-2">
                        {columns.comparison && (
                            <ExpandButton
                                result={result}
                                expanded={expanded}
                                onToggle={() => setExpanded((open) => !open)}
                                detailsId={detailsId}
                            />
                        )}
                        <ModelName
                            result={result}
                            price={fmtListPrice(result)}
                        />
                    </span>
                </TableCell>
                {metrics.map((metric) => (
                    <TableCell
                        key={metric.key}
                        align={
                            TEXT_COLUMNS.has(metric.key) ? undefined : "numeric"
                        }
                    >
                        {metric.value}
                    </TableCell>
                ))}
            </TableRow>
            {expanded && result.comparison && (
                <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={metrics.length + 1} className="pt-0">
                        <ModelDetails
                            model={result.comparison}
                            id={detailsId}
                            isReference={result.isReference}
                            referenceName={columns.reference?.name}
                        />
                    </TableCell>
                </TableRow>
            )}
        </Fragment>
    );
}

function ResultCard({
    result,
    columns,
}: {
    result: IModelResult;
    columns: IColumns;
}) {
    const [expanded, setExpanded] = useState(false);
    const detailsId = `model-card-details-${result.runModelId}`;
    return (
        <Card className="flex flex-col gap-4 p-4">
            <div className="flex items-start gap-2">
                {columns.comparison && (
                    <ExpandButton
                        result={result}
                        expanded={expanded}
                        onToggle={() => setExpanded((open) => !open)}
                        detailsId={detailsId}
                    />
                )}
                <ModelName result={result} price={fmtListPrice(result)} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-copy-14">
                {metricsFor(result, columns).map((metric) => (
                    <div
                        key={metric.key}
                        className="flex min-w-0 flex-col items-start gap-1"
                    >
                        <dt className="text-label-12 text-muted-foreground">
                            {metric.label}
                        </dt>
                        <dd>{metric.value}</dd>
                    </div>
                ))}
            </dl>
            {expanded && result.comparison && (
                <ModelDetails
                    model={result.comparison}
                    id={detailsId}
                    isReference={result.isReference}
                    referenceName={columns.reference?.name}
                />
            )}
        </Card>
    );
}

function ComparisonNotes({
    results,
    runStatus,
}: {
    results: IModelResult[];
    runStatus: RunStatus | undefined;
}) {
    const summaries = results.flatMap((result) =>
        result.comparison ? [result.comparison] : [],
    );
    // "all": every judge on the cells (comparison, prompt, transcript);
    // "comparison": the comparison judge only; "mixed": all judging where a
    // cell recorded it, else the comparison judge. Never added together.
    const judgeCost = (covers: BenchmarkJudgeCostCovers) => {
        const costs = summaries.flatMap((summary) =>
            summary.judgeCostUsd === undefined ||
            (summary.judgeCostCovers ?? "comparison") !== covers
                ? []
                : [summary.judgeCostUsd],
        );
        return costs.length > 0
            ? costs.reduce((total, cost) => total + cost, 0)
            : undefined;
    };
    const allJudging = judgeCost("all");
    const comparisonJudging = judgeCost("comparison");
    const mixedJudging = judgeCost("mixed");
    const comparable = Math.max(
        0,
        ...summaries.map((summary) => summary.comparableItems),
    );
    const inProgress = runStatus === "pending" || runStatus === "running";
    return (
        <>
            {(inProgress || comparable === 0) && (
                <p role="status" className="text-copy-14 text-muted-foreground">
                    {inProgress
                        ? "The run is still in progress. Reload the page for the latest numbers."
                        : "Nothing could be compared: no item has a stored answer or an answer from today's model."}
                </p>
            )}
            {allJudging !== undefined && (
                <p className="text-copy-14 text-muted-foreground">
                    All judging (comparison, prompt and transcript judges) cost{" "}
                    <Num>{fmtCost(allJudging)}</Num> in total, on top of the
                    models&apos; own cost.
                </p>
            )}
            {mixedJudging !== undefined && (
                <p className="text-copy-14 text-muted-foreground">
                    Judging cost <Num>{fmtCost(mixedJudging)}</Num> on models
                    with a total recorded for only some items (all judges where
                    recorded, else the comparison judge), on top of the
                    models&apos; own cost.
                </p>
            )}
            {comparisonJudging !== undefined && (
                <p className="text-copy-14 text-muted-foreground">
                    Comparison judging cost{" "}
                    <Num>{fmtCost(comparisonJudging)}</Num>
                    {allJudging !== undefined || mixedJudging !== undefined
                        ? " on models without a recorded total"
                        : " in total"}
                    , on top of the models&apos; own cost.
                </p>
            )}
            <p className="text-label-12 text-muted-foreground">
                {`Compared on up to ${plural(comparable, "item")}. Pass: meets every target with confidence. Conditional: misses none, but some results are uncertain or rest on few items. Fail: misses at least one target. Inconclusive: too few items to tell. Reference: today's model, which the others are measured against; its values are shown but not judged.`}
            </p>
        </>
    );
}

/**
 * Every model in the run in one table, cheapest per call first: verdict,
 * cost against today's model, agreement, the stored-answer field match on runs without a benchmark,
 * latency, failures and list price. On small screens each model is a card.
 */
export function ModelsTable({
    results,
    runStatus,
    goldenLabel = goldenScoreLabel(undefined),
    rowLabel = "Model",
}: {
    results: IModelResult[];
    runStatus?: RunStatus;
    /** How the stored-answer field match is named in this run. */
    goldenLabel?: IGoldenScoreLabel;
    /** What a row is: "Model" on runs, "Setup" on setup comparisons. */
    rowLabel?: "Model" | "Setup";
}) {
    if (results.length === 0) {
        return (
            <EmptyState
                title="No results yet"
                description="Model results appear here as cells finish."
            />
        );
    }
    const columns = columnsFor(results, goldenLabel);
    const headers = metricsFor(results[0]!, columns);
    return (
        <div
            role="region"
            aria-label={`${rowLabel}s`}
            className="flex flex-col gap-3"
        >
            <Table
                containerClassName="hidden md:block"
                className="min-w-max [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap"
            >
                <TableHeader>
                    <TableRow className="bg-muted hover:bg-muted">
                        <TableHead>{rowLabel}</TableHead>
                        {headers.map((metric) => (
                            <TableHead
                                key={metric.key}
                                align={
                                    TEXT_COLUMNS.has(metric.key)
                                        ? undefined
                                        : "numeric"
                                }
                            >
                                {(metric.hint ?? HEAD_HINTS[metric.key]) ? (
                                    <HintText
                                        hint={
                                            metric.hint ??
                                            HEAD_HINTS[metric.key]!
                                        }
                                    >
                                        {metric.label}
                                    </HintText>
                                ) : (
                                    metric.label
                                )}
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {results.map((result) => (
                        <ResultRow
                            key={result.runModelId}
                            result={result}
                            columns={columns}
                        />
                    ))}
                </TableBody>
            </Table>
            <ul className="flex flex-col gap-3 md:hidden">
                {results.map((result) => (
                    <li key={result.runModelId}>
                        <ResultCard result={result} columns={columns} />
                    </li>
                ))}
            </ul>
            {columns.comparison ? (
                <ComparisonNotes results={results} runStatus={runStatus} />
            ) : (
                <p className="text-label-12 text-muted-foreground">
                    Sorted by cost per call, cheapest first.
                    {columns.golden &&
                        ` ${columns.goldenLabel.label}: ${columns.goldenLabel.explanation}`}
                </p>
            )}
        </div>
    );
}
