import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CostChart, chartPoints, logTicks, placeLabels } from "./cost-chart";
import type { IModelResult } from "./run-results";
import { goldenScoreLabel } from "./golden-score";

afterEach(cleanup);

function model(
    id: string,
    name: string,
    cost: number | undefined,
    agreement: number | undefined,
    extra: Partial<IModelResult> = {},
): IModelResult {
    return {
        runModelId: id,
        modelId: id,
        name,
        isReference: false,
        failedCells: 0,
        cells: 20,
        ...(cost !== undefined ? { costPerCall: cost } : {}),
        comparison: {
            runModelId: id,
            modelId: id,
            isBenchmark: false,
            comparableItems: 20,
            failedItems: 0,
            tasks: [],
            ...(agreement !== undefined ? { agreement } : {}),
        },
        ...extra,
    };
}

const REFERENCE = model("rm-big", "Big Model", 0.04, 0.83, {
    isReference: true,
});
const CLOSEST = model("rm-small", "Small Model", 0.002, 0.87, {
    relativeCost: 0.05,
});
const CRASHY = model("rm-crashy", "Crashy Model", 0.0026, 0.59, {
    relativeCost: 0.065,
    failedCells: 7,
});
const NO_COST = model("rm-free", "Free Model", undefined, 0.9);

describe("CostChart", () => {
    it("draws one focusable dot per model with a cost and a value", () => {
        render(
            <CostChart
                results={[CLOSEST, CRASHY, NO_COST, REFERENCE]}
                metric="agreement"
                highlightId="rm-small"
            />,
        );
        const dots = screen.getAllByRole("img");
        expect(dots).toHaveLength(3);
        expect(
            screen.getByRole("img", {
                name: "Crashy Model: $0.0026 per call, 6.5% of today's model's cost, agreement 59%, 7 failed items.",
            }),
        ).toHaveAttribute("tabindex", "0");
        expect(
            screen.getByRole("img", {
                name: "Big Model: $0.0400 per call, today's model, agreement 83%.",
            }),
        ).toBeInTheDocument();
    });

    it("rounds every drawn coordinate to two decimals, so server and browser agree", () => {
        const { container } = render(
            <CostChart
                results={[CLOSEST, CRASHY, REFERENCE]}
                metric="agreement"
                highlightId="rm-small"
            />,
        );
        const attributes = [
            "x",
            "y",
            "x1",
            "x2",
            "y1",
            "y2",
            "cx",
            "cy",
            "width",
            "height",
        ];
        const values = Array.from(container.querySelectorAll("svg *")).flatMap(
            (node) =>
                attributes.flatMap((name) => {
                    const value = node.getAttribute(name);
                    return value === null ? [] : [value];
                }),
        );
        expect(values.length).toBeGreaterThan(20);
        for (const value of values)
            expect(value).toMatch(/^-?\d+(\.\d{1,2})?$/);
    });

    it("labels the top and bottom of the vertical axis", () => {
        const { container } = render(
            <CostChart
                results={[CLOSEST, CRASHY, REFERENCE]}
                metric="agreement"
                highlightId="rm-small"
            />,
        );
        // Values run from 59% to 87%, so the axis spans 40% to 100%.
        const ticks = Array.from(
            container.querySelectorAll("svg text"),
            (node) => node.textContent,
        );
        expect(ticks).toContain("40%");
        expect(ticks).toContain("100%");
    });

    it("shows a tooltip on focus and hides it on blur", () => {
        render(<CostChart results={[CLOSEST, REFERENCE]} metric="agreement" />);
        const dot = screen.getByRole("img", { name: /^Small Model/ });
        fireEvent.focus(dot);
        expect(screen.getByRole("status").textContent).toContain(
            "Small Model: $0.0020 per call",
        );
        fireEvent.blur(dot);
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("marks today's model with a dashed line and a plain label", () => {
        const { container } = render(
            <CostChart
                results={[CLOSEST, REFERENCE]}
                metric="agreement"
                highlightId="rm-small"
            />,
        );
        expect(
            container.querySelector("line[stroke-dasharray]"),
        ).not.toBeNull();
        expect(container.textContent).toContain("Today's model: 83% agreement");
        expect(container.textContent).toContain("Closest replacement");
        expect(container.textContent).toContain(
            "Cheaper than today's model and at least as good",
        );
    });

    it("repeats the data in a table for screen readers", () => {
        render(<CostChart results={[CLOSEST, REFERENCE]} metric="agreement" />);
        const table = screen.getByRole("table", {
            name: "Cost per call and agreement by model",
        });
        expect(table.textContent).toContain("Small Model$0.002087%");
    });

    it("plots the stored-answer field match, named plainly, on runs without a comparison", () => {
        const plain = [
            { ...CLOSEST, comparison: undefined, goldenScore: 0.75 },
            { ...REFERENCE, comparison: undefined, goldenScore: 0.8 },
        ];
        const { container } = render(
            <CostChart
                results={plain}
                metric="golden"
                highlightId="rm-big"
                goldenLabel={goldenScoreLabel({ fieldConfigs: [] })}
            />,
        );
        expect(container.textContent).toContain(
            "Exact match, all stored fields",
        );
        expect(container.textContent).not.toContain("Golden score");
        expect(container.textContent).toContain("Today's model: 0.80");
        expect(container.textContent).toContain("Best model");
    });

    it("says so when nothing can be plotted", () => {
        render(<CostChart results={[NO_COST]} metric="agreement" />);
        expect(
            screen.getByText(
                /No model has both a cost and an agreement figure/,
            ),
        ).toBeInTheDocument();
    });
});

describe("chart helpers", () => {
    it("keeps only models with a cost above zero and a value", () => {
        expect(
            chartPoints([CLOSEST, NO_COST], "agreement").map(
                (point) => point.result.name,
            ),
        ).toEqual(["Small Model"]);
    });

    it("puts log ticks at 1, 2 and 5 times powers of ten", () => {
        expect(logTicks(0.0008, 0.06)).toEqual([
            0.001, 0.002, 0.005, 0.01, 0.02, 0.05,
        ]);
    });

    it("moves a label that would collide", () => {
        const [first, second] = placeLabels(
            [
                { x: 100, y: 100, text: "Alpha" },
                { x: 100, y: 104, text: "Beta" },
            ],
            800,
        );
        expect(first).toMatchObject({ x: 112, anchor: "start" });
        expect(second).toBeDefined();
        expect(second!.y).not.toBe(first!.y);
    });
});
