"use client";

import { useEffect, useId, useRef, useState } from "react";
import { fmtPercent, fmtScore, formatCostColumn } from "@/lib/format";
import { cn } from "@/lib/cn";
import { goldenScoreLabel, type IGoldenScoreLabel } from "./golden-score";
import type { IModelResult } from "./run-results";

/** Used before the first measurement (server render and tests). */
const DEFAULT_WIDTH = 800;
const HEIGHT = 340;
const MARGIN = { left: 56, right: 24, top: 20, bottom: 48 };
// A generous estimate of one 12px Geist character, plus padding below.
const CHAR_WIDTH = 7.2;
const LABEL_HEIGHT = 14;

/** What the vertical axis shows. */
export type ChartMetric = "agreement" | "golden";

export interface IChartPoint {
    result: IModelResult;
    cost: number;
    value: number;
}

/** The value a model is plotted at: overall agreement, or its stored-answer field match. */
export function chartValue(
    result: IModelResult,
    metric: ChartMetric,
): number | undefined {
    if (metric === "golden") return result.goldenScore;
    return result.comparison?.agreement ?? result.comparison?.winOrTieRate;
}

/** Models with both a cost per call above zero and a value. */
export function chartPoints(
    results: IModelResult[],
    metric: ChartMetric,
): IChartPoint[] {
    return results.flatMap((result) => {
        const value = chartValue(result, metric);
        return result.costPerCall !== undefined &&
            result.costPerCall > 0 &&
            value !== undefined
            ? [{ result, cost: result.costPerCall, value }]
            : [];
    });
}

/** Ticks at 1, 2 and 5 times each power of ten inside the range. */
export function logTicks(low: number, high: number): number[] {
    const ticks: number[] = [];
    for (
        let power = Math.floor(Math.log10(low));
        power <= Math.ceil(Math.log10(high));
        power++
    )
        for (const step of [1, 2, 5]) {
            const tick = step * 10 ** power;
            if (tick >= low && tick <= high)
                ticks.push(Number(tick.toPrecision(1)));
        }
    return ticks;
}

interface ILabelBox {
    x: number;
    y: number;
    width: number;
    anchor: "start" | "end";
}

function overlaps(a: ILabelBox, b: ILabelBox): boolean {
    const left = (box: ILabelBox) =>
        box.anchor === "start" ? box.x : box.x - box.width;
    return (
        left(a) < left(b) + b.width &&
        left(b) < left(a) + a.width &&
        Math.abs(a.y - b.y) < LABEL_HEIGHT
    );
}

/**
 * Places each label next to its dot, trying right, below, above and left,
 * and keeps the first spot that collides with no earlier label or dot.
 */
export function placeLabels(
    dots: Array<{ x: number; y: number; text: string }>,
    width: number,
    /** Horizontal lines labels should not sit on, e.g. a reference line. */
    lines: number[] = [],
    /** Text already on the chart, such as the reference line's label. */
    fixed: ILabelBox[] = [],
): Array<ILabelBox | undefined> {
    const placed: ILabelBox[] = [...fixed];
    const result: Array<ILabelBox | undefined> = [];
    const obstacles: ILabelBox[] = [
        ...dots.map((dot): ILabelBox => ({
            x: dot.x - 7,
            y: dot.y + 4,
            width: 14,
            anchor: "start",
        })),
        ...lines.map((lineY): ILabelBox => ({
            x: 0,
            y: lineY + 4,
            width,
            anchor: "start",
        })),
    ];
    for (const dot of dots) {
        const textWidth = dot.text.length * CHAR_WIDTH + 4;
        const box = (
            dx: number,
            dy: number,
            anchor: ILabelBox["anchor"],
        ): ILabelBox => ({
            x: dot.x + dx,
            y: dot.y + dy,
            width: textWidth,
            anchor,
        });
        const candidates: ILabelBox[] = [
            box(12, 4, "start"),
            box(10, 20, "start"),
            box(10, -12, "start"),
            box(-12, 4, "end"),
            box(-10, 20, "end"),
            box(-10, -12, "end"),
            box(10, 34, "start"),
            box(10, -26, "start"),
            box(-10, 34, "end"),
            box(-10, -26, "end"),
        ];
        const options = candidates.map((box): ILabelBox => {
            // Keep labels inside the plot horizontally.
            const left = box.anchor === "start" ? box.x : box.x - box.width;
            if (left + box.width > width - 4)
                return { ...box, x: width - 4, anchor: "end" as const };
            if (left < MARGIN.left)
                return { ...box, x: MARGIN.left + 2, anchor: "start" as const };
            return box;
        });
        const free = options.find(
            (box) =>
                !placed.some((other) => overlaps(box, other)) &&
                !obstacles.some((other) => overlaps(box, other)),
        );
        // No room: leave the label out; the tooltip and the table still name it.
        if (free) placed.push(free);
        result.push(free);
    }
    return result;
}

/**
 * Where the reference line's label goes: centred above the line, else at
 * either end, above or below, whichever first clears every dot.
 */
function lineLabelSpot(
    width: number,
    lineY: number,
    left: number,
    right: number,
    dots: Array<{ x: number; y: number }>,
): ILabelBox | undefined {
    const dotBoxes = dots.map((dot): ILabelBox => ({
        x: dot.x - 9,
        y: dot.y + 4,
        width: 18,
        anchor: "start",
    }));
    const xs = [(left + right - width) / 2, left + 4, right - width - 4];
    const spots = [lineY - 6, lineY + 16].flatMap((y) =>
        xs.map((x): ILabelBox => ({ x, y, width, anchor: "start" })),
    );
    return spots.find((spot) => !dotBoxes.some((dot) => overlaps(spot, dot)));
}

/**
 * Rounds a drawn coordinate to two decimals. Math.log10 can differ in the
 * last bits between the server and the browser, so unrounded coordinates
 * make React report a hydration mismatch on the SVG attributes.
 */
export function roundCoordinate(value: number): number {
    return Math.round(value * 100) / 100;
}

function tickStep(low: number, high: number): number {
    return high - low > 0.5 ? 0.2 : 0.1;
}

/** Every 0.1, or every 0.2 over a wide range, inside [low, high]. */
function linearTicks(
    low: number,
    high: number,
    step = tickStep(low, high),
): number[] {
    const ticks: number[] = [];
    for (
        let tick = Math.ceil(low / step) * step;
        tick <= high + 1e-9;
        tick += step
    )
        ticks.push(Math.round(tick * 100) / 100);
    return ticks;
}

/** The dot's text alternative and tooltip. */
function describePoint(
    point: IChartPoint,
    metric: ChartMetric,
    axisWords: string,
    fmtCostValue: (cost: number) => string,
): string {
    const { result } = point;
    const cost = result.isReference
        ? ", today's model"
        : result.relativeCost !== undefined
          ? `, ${fmtPercent(result.relativeCost)} of today's model's cost`
          : "";
    const failed =
        result.failedCells > 0 ? `, ${result.failedCells} failed items` : "";
    return `${result.name}: ${fmtCostValue(point.cost)} per call${cost}, ${axisWords} ${valueText(point.value, metric)}${failed}.`;
}

function valueText(value: number, metric: ChartMetric): string {
    return metric === "golden" ? fmtScore(value) : fmtPercent(value);
}

/** The vertical axis's name, the same in a sentence, and "a …" for the empty state. */
function axisText(
    metric: ChartMetric,
    goldenLabel: IGoldenScoreLabel,
): { axisName: string; axisWords: string; missing: string } {
    if (metric !== "golden")
        return {
            axisName: "Agreement",
            axisWords: "agreement",
            missing: "an agreement figure",
        };
    const words = goldenLabel.scoreName;
    return {
        axisName: goldenLabel.label,
        axisWords: words,
        missing: `${/^[aeiou]/i.test(words) ? "an" : "a"} ${words}`,
    };
}

/**
 * Cost per call (log scale) against overall agreement, or the stored-answer
 * field match on runs without a comparison. Today's model is dark, the model the answer
 * names is blue, the rest grey. A dashed line marks today's model's own
 * value; the shaded corner is cheaper and at least as good. Each dot takes
 * keyboard focus for its tooltip, and a hidden table repeats the data.
 */
export function CostChart({
    results,
    metric,
    highlightId,
    goldenLabel = goldenScoreLabel(undefined),
}: {
    results: IModelResult[];
    metric: ChartMetric;
    /** How the stored-answer field match is named in this run. */
    goldenLabel?: IGoldenScoreLabel;
    /** The closest replacement or best model, drawn in the accent colour. */
    highlightId?: string;
}) {
    const titleId = useId();
    const [active, setActive] = useState<string | undefined>();
    const frame = useRef<HTMLDivElement>(null);
    const [WIDTH, setWidth] = useState(DEFAULT_WIDTH);
    // Draw at the real pixel width, so text stays 12px on every screen.
    useEffect(() => {
        const element = frame.current;
        if (!element || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(([entry]) => {
            const measured = Math.round(entry?.contentRect.width ?? 0);
            if (measured > 0) setWidth(measured);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const points = chartPoints(results, metric);
    const { axisName, axisWords, missing } = axisText(metric, goldenLabel);
    if (points.length === 0)
        return (
            <p className="text-copy-14 text-muted-foreground">
                {`No model has both a cost and ${missing} to plot yet.`}
            </p>
        );
    const reference = points.find((point) => point.result.isReference);
    const fmtCostValue = formatCostColumn(points.map((point) => point.cost));

    const costs = points.map((point) => point.cost);
    const xLow = Math.min(...costs) / 1.6;
    const xHigh = Math.max(...costs) * 1.6;
    const values = points.map((point) => point.value);
    // Pad the data, then widen to whole ticks so the top and bottom of the
    // plot are always labelled.
    const rawLow = Math.min(...values) - 0.1;
    const rawHigh = Math.max(...values) + 0.05;
    const yStep = tickStep(rawLow, rawHigh);
    const yLow = Math.max(0, Math.floor(rawLow / yStep + 1e-9) * yStep);
    const yHigh = Math.min(1, Math.ceil(rawHigh / yStep - 1e-9) * yStep);
    const plotRight = WIDTH - MARGIN.right;
    const plotBottom = HEIGHT - MARGIN.bottom;
    const x = (cost: number) =>
        roundCoordinate(
            MARGIN.left +
                ((Math.log10(cost) - Math.log10(xLow)) /
                    (Math.log10(xHigh) - Math.log10(xLow))) *
                    (plotRight - MARGIN.left),
        );
    const y = (value: number) =>
        roundCoordinate(
            plotBottom -
                ((value - yLow) / Math.max(0.01, yHigh - yLow)) *
                    (plotBottom - MARGIN.top),
        );
    const yTicks = linearTicks(yLow, yHigh, yStep);

    // Draw today's model and the highlighted model last, so they sit on top.
    const order = (point: IChartPoint) =>
        point.result.isReference
            ? 2
            : point.result.runModelId === highlightId
              ? 1
              : 0;
    const drawn = [...points].sort((a, b) => order(a) - order(b));
    // Label the important dots first so they get the best spots.
    const labelOrder = [...drawn].reverse();
    const lineLabel = reference
        ? `Today's model: ${valueText(reference.value, metric)}${metric === "agreement" ? " agreement" : ""}`
        : "";
    const lineLabelBox = reference
        ? lineLabelSpot(
              lineLabel.length * CHAR_WIDTH,
              y(reference.value),
              MARGIN.left,
              plotRight,
              points.map((point) => ({ x: x(point.cost), y: y(point.value) })),
          )
        : undefined;
    const boxes = placeLabels(
        labelOrder.map((point) => ({
            x: x(point.cost),
            y: y(point.value),
            text: point.result.name,
        })),
        WIDTH,
        reference ? [y(reference.value)] : [],
        lineLabelBox ? [lineLabelBox] : [],
    );
    const labelFor = new Map(
        labelOrder.map((point, index) => [
            point.result.runModelId,
            boxes[index],
        ]),
    );

    const activePoint = points.find(
        (point) => point.result.runModelId === active,
    );
    const describe = (point: IChartPoint) =>
        describePoint(point, metric, axisWords, fmtCostValue);

    return (
        <div className="flex flex-col gap-3">
            <div className="overflow-x-auto">
                <div ref={frame} className="relative min-w-80">
                    <svg
                        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                        width={WIDTH}
                        height={HEIGHT}
                        role="group"
                        aria-labelledby={titleId}
                        className="block"
                    >
                        <title id={titleId}>
                            {`Cost per call against ${axisWords}, one dot per model`}
                        </title>
                        {reference && (
                            <rect
                                x={MARGIN.left}
                                y={MARGIN.top}
                                width={roundCoordinate(
                                    Math.max(
                                        0,
                                        x(reference.cost) - MARGIN.left,
                                    ),
                                )}
                                height={roundCoordinate(
                                    Math.max(
                                        0,
                                        y(reference.value) - MARGIN.top,
                                    ),
                                )}
                                className="fill-accent/10"
                            />
                        )}
                        {yTicks.map((tick) => (
                            <g key={`y${tick}`}>
                                <line
                                    x1={MARGIN.left}
                                    x2={plotRight}
                                    y1={y(tick)}
                                    y2={y(tick)}
                                    className="stroke-border"
                                />
                                <text
                                    x={MARGIN.left - 8}
                                    y={y(tick) + 4}
                                    textAnchor="end"
                                    className="fill-muted-foreground text-label-12 tabular-nums"
                                >
                                    {valueText(tick, metric)}
                                </text>
                            </g>
                        ))}
                        {logTicks(xLow, xHigh).map((tick) => (
                            <g key={`x${tick}`}>
                                <line
                                    x1={x(tick)}
                                    x2={x(tick)}
                                    y1={MARGIN.top}
                                    y2={plotBottom}
                                    className="stroke-border"
                                />
                                <text
                                    x={x(tick)}
                                    y={plotBottom + 18}
                                    textAnchor="middle"
                                    className="fill-muted-foreground text-label-12 tabular-nums"
                                >
                                    {`$${tick}`}
                                </text>
                            </g>
                        ))}
                        <line
                            x1={MARGIN.left}
                            x2={plotRight}
                            y1={plotBottom}
                            y2={plotBottom}
                            className="stroke-border-strong"
                        />
                        <text
                            x={(MARGIN.left + plotRight) / 2}
                            y={HEIGHT - 8}
                            textAnchor="middle"
                            className="fill-muted-foreground text-label-12"
                        >
                            Cost per call (log scale)
                        </text>
                        <text
                            x={14}
                            y={(MARGIN.top + plotBottom) / 2}
                            textAnchor="middle"
                            transform={`rotate(-90 14 ${(MARGIN.top + plotBottom) / 2})`}
                            className="fill-muted-foreground text-label-12"
                        >
                            {axisName}
                        </text>
                        {reference && (
                            <g>
                                <line
                                    x1={MARGIN.left}
                                    x2={plotRight}
                                    y1={y(reference.value)}
                                    y2={y(reference.value)}
                                    strokeDasharray="4 4"
                                    strokeWidth={1.5}
                                    className="stroke-foreground"
                                />
                                {lineLabelBox && (
                                    <text
                                        x={roundCoordinate(lineLabelBox.x)}
                                        y={roundCoordinate(lineLabelBox.y)}
                                        textAnchor="start"
                                        className="fill-foreground text-label-12"
                                    >
                                        {lineLabel}
                                    </text>
                                )}
                            </g>
                        )}
                        {drawn.map((point) => {
                            const id = point.result.runModelId;
                            const cx = x(point.cost);
                            const cy = y(point.value);
                            const label = labelFor.get(id);
                            const strong =
                                point.result.isReference || id === highlightId;
                            return (
                                <g
                                    key={id}
                                    tabIndex={0}
                                    role="img"
                                    aria-label={describe(point)}
                                    onMouseEnter={() => setActive(id)}
                                    onMouseLeave={() => setActive(undefined)}
                                    onFocus={() => setActive(id)}
                                    onBlur={() => setActive(undefined)}
                                    className="cursor-default outline-none [&:focus-visible>circle:first-child]:stroke-ring"
                                >
                                    <circle
                                        cx={cx}
                                        cy={cy}
                                        r={14}
                                        className="fill-transparent stroke-transparent"
                                        strokeWidth={2}
                                    />
                                    <circle
                                        cx={cx}
                                        cy={cy}
                                        r={7}
                                        strokeWidth={2}
                                        className={cn(
                                            "stroke-background",
                                            point.result.isReference
                                                ? "fill-foreground"
                                                : id === highlightId
                                                  ? "fill-accent"
                                                  : "fill-chart-other",
                                        )}
                                    />
                                    {label && (
                                        <text
                                            x={roundCoordinate(label.x)}
                                            y={roundCoordinate(label.y)}
                                            textAnchor={label.anchor}
                                            className={cn(
                                                "text-label-12",
                                                strong
                                                    ? "fill-foreground"
                                                    : "fill-muted-foreground",
                                            )}
                                        >
                                            {point.result.name}
                                        </text>
                                    )}
                                </g>
                            );
                        })}
                    </svg>
                    {activePoint && (
                        <div
                            role="status"
                            className="pointer-events-none absolute z-10 max-w-64 rounded-sm bg-primary px-2 py-1 text-label-12 text-primary-foreground"
                            style={{
                                left: `${Math.min(70, (x(activePoint.cost) / WIDTH) * 100 + 2)}%`,
                                top: `${(y(activePoint.value) / HEIGHT) * 100}%`,
                            }}
                        >
                            {describe(activePoint)}
                        </div>
                    )}
                </div>
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-label-12 text-muted-foreground">
                {reference && (
                    <li className="flex items-center gap-2">
                        <span
                            aria-hidden="true"
                            className="size-2.5 rounded-full bg-foreground"
                        />
                        {`${reference.result.name}, today's model (dashed line: its own ${axisWords}, ${valueText(reference.value, metric)})`}
                    </li>
                )}
                {highlightId && (
                    <li className="flex items-center gap-2">
                        <span
                            aria-hidden="true"
                            className="size-2.5 rounded-full bg-accent"
                        />
                        {metric === "agreement"
                            ? "Closest replacement"
                            : "Best model"}
                    </li>
                )}
                <li className="flex items-center gap-2">
                    <span
                        aria-hidden="true"
                        className="size-2.5 rounded-full bg-chart-other"
                    />
                    Other models
                </li>
                {reference && (
                    <li className="flex items-center gap-2">
                        <span
                            aria-hidden="true"
                            className="size-2.5 rounded-sm bg-accent/10"
                        />
                        Cheaper than today&apos;s model and at least as good
                    </li>
                )}
            </ul>
            <table className="sr-only">
                <caption>{`Cost per call and ${axisWords} by model`}</caption>
                <thead>
                    <tr>
                        <th scope="col">Model</th>
                        <th scope="col">Cost per call</th>
                        <th scope="col">{axisName}</th>
                    </tr>
                </thead>
                <tbody>
                    {points.map((point) => (
                        <tr key={point.result.runModelId}>
                            <th scope="row">{point.result.name}</th>
                            <td>{fmtCostValue(point.cost)}</td>
                            <td>{valueText(point.value, metric)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
