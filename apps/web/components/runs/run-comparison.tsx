"use client";

import { useState, useTransition } from "react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { IComparableRun, IModelComparison } from "@mosaic/api-contract";
import { fmtDelta, fmtLatency, fmtScore, formatCostColumn } from "@/lib/format";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { HintText } from "@/components/ui/hint";
import { SttGateBadge } from "@/components/ui/status-badge";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { StaleRegion } from "@/components/ui/stale-region";
import { MISSING_VALUE, fmtDate, shortId } from "@/lib/format";
import { REASONING_EFFORT_LABELS, labelFor } from "@/lib/labels";
import { EmptyState } from "@/components/layout/empty-state";

const NONE = "none";

// A single axis delta: arrow + relative text, coloured by good/bad, with an
// sr-only word so the meaning isn't carried by colour alone.
function DeltaBadge({
    value,
    baseline,
    lowerIsBetter,
}: {
    value: number | undefined;
    baseline: number | undefined;
    lowerIsBetter?: boolean;
}) {
    const { text, direction, good } = fmtDelta(value, baseline, lowerIsBetter);
    if (direction === "flat" || good === undefined) {
        return (
            <span className="text-label-12 text-muted-foreground">{text}</span>
        );
    }
    const Arrow = direction === "up" ? ArrowUp : ArrowDown;
    return (
        <span
            className={cn(
                "inline-flex items-center gap-0.5 text-label-12",
                good ? "text-eval-success" : "text-eval-danger",
            )}
        >
            <Arrow className="size-3" aria-hidden />
            {text}
            <span className="sr-only">{good ? " better" : " worse"}</span>
        </span>
    );
}

function runLabel(run: IComparableRun): string {
    const models =
        run.models.length > 2
            ? `${run.models.slice(0, 2).join(", ")} +${run.models.length - 2}`
            : run.models.join(", ");
    return `${shortId(run.id)} · ${fmtDate(run.createdAt)}${models ? ` · ${models}` : ""}`;
}

function ModelCell({
    model,
    onlyOneSide,
}: {
    model: IModelComparison;
    onlyOneSide: boolean;
}) {
    return (
        <TableCell className="text-mono-13">
            <span className="flex items-center gap-2">
                {model.modelId}
                {model.isReference && <Badge variant="ref">Reference</Badge>}
                {onlyOneSide && (
                    <span className="text-label-12 text-muted-foreground">
                        {model.baseline ? "Only in baseline" : "New"}
                    </span>
                )}
            </span>
        </TableCell>
    );
}

function QualityCell({ model }: { model: IModelComparison }) {
    return (
        <TableCell align="numeric">
            <span className="flex items-center justify-end gap-2">
                <span>
                    {fmtScore(model.baseline?.quality)} →{" "}
                    {fmtScore(model.current?.quality)}
                </span>
                {model.delta?.qualityComparable ? (
                    <DeltaBadge
                        value={model.current?.quality}
                        baseline={model.baseline?.quality}
                    />
                ) : model.delta ? (
                    <HintText
                        hint="Baseline and this run used different scorers (judge vs field), so the quality delta isn’t comparable."
                        className="text-label-12 text-muted-foreground"
                    >
                        diff. scorer
                    </HintText>
                ) : null}
            </span>
        </TableCell>
    );
}

function CostCell({
    model,
    fmtCostValue,
}: {
    model: IModelComparison;
    fmtCostValue: ReturnType<typeof formatCostColumn>;
}) {
    return (
        <TableCell align="numeric">
            <span className="flex items-center justify-end gap-2">
                <span>
                    {fmtCostValue(model.baseline?.cost)} →{" "}
                    {fmtCostValue(model.current?.cost)}
                </span>
                <DeltaBadge
                    value={model.current?.cost}
                    baseline={model.baseline?.cost}
                    lowerIsBetter
                />
            </span>
        </TableCell>
    );
}

function LatencyCell({ model }: { model: IModelComparison }) {
    return (
        <TableCell align="numeric">
            <span className="flex items-center justify-end gap-2">
                <span>
                    {fmtLatency(model.baseline?.latency)} →{" "}
                    {fmtLatency(model.current?.latency)}
                </span>
                <DeltaBadge
                    value={model.current?.latency}
                    baseline={model.baseline?.latency}
                    lowerIsBetter
                />
            </span>
        </TableCell>
    );
}

function effortLabel(effort: string | undefined): string {
    return effort === undefined
        ? MISSING_VALUE
        : labelFor(
              REASONING_EFFORT_LABELS,
              effort as keyof typeof REASONING_EFFORT_LABELS,
          );
}

function EffortCell({
    model,
    effortDiffers,
}: {
    model: IModelComparison;
    effortDiffers: boolean;
}) {
    return (
        <TableCell>
            <span
                className={cn(
                    "text-copy-14",
                    effortDiffers ? "text-on-surface" : "text-muted-foreground",
                )}
            >
                {effortLabel(model.baseline?.effort)} →{" "}
                {effortLabel(model.current?.effort)}
            </span>
        </TableCell>
    );
}

function ComparisonRow({
    model,
    fmtCostValue,
}: {
    model: IModelComparison;
    fmtCostValue: ReturnType<typeof formatCostColumn>;
}) {
    const onlyOneSide = !model.baseline || !model.current;
    const effortDiffers = model.baseline?.effort !== model.current?.effort;
    return (
        <TableRow>
            <ModelCell model={model} onlyOneSide={onlyOneSide} />
            <QualityCell model={model} />
            <CostCell model={model} fmtCostValue={fmtCostValue} />
            <LatencyCell model={model} />
            <TableCell>
                <SttGateBadge gate={model.sttShipGate} />
            </TableCell>
            <EffortCell model={model} effortDiffers={effortDiffers} />
        </TableRow>
    );
}

export function RunComparison({
    comparableRuns,
    baselineRunId,
    comparison,
}: {
    comparableRuns: IComparableRun[];
    baselineRunId?: string;
    comparison?: IModelComparison[];
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    // The new baseline arrives with a server re-render; a transition keeps the
    // current comparison on screen (dimmed) instead of the route skeleton.
    const [pending, startTransition] = useTransition();
    const [picked, setPicked] = useState<string>();

    function pick(value: string) {
        const params = new URLSearchParams(searchParams.toString());
        if (value === NONE) params.delete("compareWith");
        else params.set("compareWith", value);
        const qs = params.toString();
        setPicked(value);
        startTransition(() => {
            router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, {
                scroll: false,
            });
        });
    }

    if (comparableRuns.length === 0) {
        return (
            <EmptyState
                variant="inline"
                title="Nothing to compare yet"
                description="No other completed runs use this dataset. Run it again, for example with a tweaked prompt or effort, to compare."
            />
        );
    }

    const improved =
        comparison?.filter((m) => (m.delta?.quality ?? 0) > 0).length ?? 0;
    const regressed =
        comparison?.filter((m) => (m.delta?.quality ?? 0) < 0).length ?? 0;

    // One unit and precision for the baseline and current cost columns.
    const fmtCostValue = formatCostColumn(
        (comparison ?? []).flatMap((model) => [
            model.baseline?.cost,
            model.current?.cost,
        ]),
    );

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:max-w-md">
                <label
                    htmlFor="compareWith"
                    className="text-label-14 text-on-surface"
                >
                    Compare against
                </label>
                <Select
                    value={pending && picked ? picked : (baselineRunId ?? NONE)}
                    onValueChange={pick}
                >
                    <SelectTrigger id="compareWith">
                        <SelectValue placeholder="Pick a run to compare" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={NONE}>None</SelectItem>
                        {comparableRuns.map((run) => (
                            <SelectItem key={run.id} value={run.id}>
                                {runLabel(run)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-copy-14 text-muted-foreground">
                    Deltas are this run minus the run you pick, across quality,
                    cost, and latency.
                </p>
            </div>

            {pending && !comparison?.length && (
                <p
                    role="status"
                    className="flex items-center gap-2 text-copy-14 text-muted-foreground"
                >
                    <Spinner size="sm" />
                    Loading comparison…
                </p>
            )}

            {comparison && comparison.length > 0 && (
                <StaleRegion stale={pending} className="flex flex-col gap-4">
                    <p className="text-copy-14 text-on-surface">
                        <span className="text-label-14">{improved}</span>{" "}
                        improved ·{" "}
                        <span className="text-label-14">{regressed}</span>{" "}
                        regressed on quality vs. the baseline.
                    </p>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Model</TableHead>
                                    <TableHead align="numeric">
                                        Quality (base → this)
                                    </TableHead>
                                    <TableHead align="numeric">
                                        Total cost (base → this)
                                    </TableHead>
                                    <TableHead align="numeric">
                                        Latency (base → this)
                                    </TableHead>
                                    <TableHead>STT gate</TableHead>
                                    <TableHead>Effort (base → this)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {comparison.map((model) => (
                                    <ComparisonRow
                                        key={model.modelId}
                                        model={model}
                                        fmtCostValue={fmtCostValue}
                                    />
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </StaleRegion>
            )}
        </div>
    );
}
