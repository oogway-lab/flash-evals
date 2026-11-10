import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type {
    BenchmarkJudgeCostCovers,
    IBenchmarkModelSummary,
    IBenchmarkTaskSummary,
} from "@flash-evals/api-contract";
import { ModelsTable } from "./models-table";
import type { IModelResult } from "./run-results";
import { goldenScoreLabel } from "./golden-score";

afterEach(cleanup);

const TASK: IBenchmarkTaskSummary = {
    key: "mentions",
    name: "Competitor mentions",
    method: "agreement",
    source: "model",
    n: 40,
    agreement: 0.93,
    wins: 0,
    ties: 0,
    losses: 0,
    errors: 0,
    assessment: {
        metric: "agreement",
        value: 0.93,
        interval: { low: 0.881, high: 0.979 },
        threshold: 0.9,
        sampleSize: "sufficient",
        verdict: "uncertain",
    },
};

const SUMMARY: IBenchmarkModelSummary = {
    runModelId: "rm-small",
    modelId: "small-model",
    isBenchmark: false,
    comparableItems: 40,
    failedItems: 2,
    tasks: [TASK],
    agreement: 0.93,
    relativeCost: 0.05,
    judgeCostUsd: 0.25,
    assessment: {
        verdict: "conditional",
        reasons: ["Competitor mentions: could be either side of target 90%."],
    },
};

const SMALL: IModelResult = {
    runModelId: "rm-small",
    modelId: "small-model",
    name: "Small Model",
    isReference: false,
    costPerCall: 0.002,
    relativeCost: 0.05,
    comparison: SUMMARY,
    goldenScore: 0.5,
    avgLatencyMs: 1500,
    failedCells: 2,
    cells: 40,
    info: {
        label: "Small Model",
        provider: "gateway",
        inputPerMillion: 0.1,
        outputPerMillion: 0.5,
    },
};

const BIG: IModelResult = {
    runModelId: "rm-big",
    modelId: "big-model",
    name: "Big Model",
    isReference: true,
    costPerCall: 0.04,
    goldenScore: 0.8,
    avgLatencyMs: 7000,
    failedCells: 0,
    cells: 40,
};

const table = () => within(document.querySelector("table") as HTMLElement);

function rowFor(name: string): HTMLElement {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) =>
        tr.textContent?.includes(name),
    );
    if (!row) throw new Error(`No row for ${name}`);
    return row as HTMLElement;
}

describe("ModelsTable", () => {
    it("shows one row per model with verdict, cost, agreement and failures", () => {
        render(<ModelsTable results={[SMALL, BIG]} />);
        expect(table().getByText("Cost vs Big Model")).toBeInTheDocument();
        const small = rowFor("Small Model");
        expect(small.textContent).toContain("small-model");
        expect(
            within(small).getByLabelText(
                "Benchmark verdict status: Conditional",
            ),
        ).toBeInTheDocument();
        expect(small.textContent).toContain("$0.0020");
        expect(small.textContent).toContain("5%");
        expect(small.textContent).toContain("93%");
        expect(small.textContent).toContain("0.50");
        expect(small.textContent).toContain("1.5 s");
        expect(small.textContent).toContain("2 of 40");
        expect(small.textContent).toContain(
            "via Vercel AI Gateway · $0.10 / $0.50 per 1M tokens in / out",
        );
        expect(table().queryByText(/List price/)).toBeNull();

        const big = rowFor("Big Model");
        expect(big.textContent).toContain("Today's model");
        expect(
            within(big).getByLabelText("Benchmark verdict status: Reference"),
        ).toBeInTheDocument();
        expect(big.textContent).not.toMatch(/Pass|Fail|Conditional/);
        expect(big.textContent).not.toContain("Yardstick");
    });

    it("shows the temperature a model was sent, and nothing for the default", () => {
        render(<ModelsTable results={[{ ...SMALL, temperature: 0.2 }, BIG]} />);
        expect(rowFor("Small Model").textContent).toContain("Temperature 0.2");
        expect(rowFor("Big Model").textContent).not.toContain("Temperature");
    });

    it("opens a model's reasons and task results", () => {
        const { container } = render(<ModelsTable results={[SMALL, BIG]} />);
        fireEvent.click(
            table().getByRole("button", {
                name: "Show task details for Small Model",
            }),
        );
        const details = container.querySelector("#model-details-rm-small")!;
        expect(details.textContent).toContain("Why this verdict");
        expect(details.textContent).toContain("Competitor mentions");
        expect(details.textContent).toContain("vs Big Model");
        expect(details.textContent).toContain("95% CI 88.1% to 97.9%");
    });

    it("hides the stored-answer field match on runs with a benchmark", () => {
        const { container } = render(
            <ModelsTable
                results={[
                    { ...SMALL, goldenScore: 0.58 },
                    { ...BIG, goldenScore: 0.61 },
                ]}
            />,
        );
        expect(
            table().queryByText(/Exact match|Stored answer match/),
        ).toBeNull();
        expect(container.textContent).not.toContain("0.58");
    });

    it("adds judging cost and the verdict legend on comparison runs", () => {
        const { container } = render(
            <ModelsTable results={[SMALL, BIG]} runStatus="running" />,
        );
        expect(container.textContent).toContain(
            "Comparison judging cost $0.2500 in total",
        );
        expect(container.textContent).toContain("still in progress");
    });

    it("never adds all-judging totals to comparison-only ones", () => {
        const withCovers = (
            result: IModelResult,
            judgeCostUsd: number,
            judgeCostCovers: BenchmarkJudgeCostCovers,
        ): IModelResult => ({
            ...result,
            comparison: {
                ...result.comparison!,
                judgeCostUsd,
                judgeCostCovers,
            },
        });
        const { container } = render(
            <ModelsTable
                results={[
                    withCovers(SMALL, 0.3, "all"),
                    withCovers(
                        { ...SMALL, runModelId: "rm-other", name: "Other" },
                        0.1,
                        "comparison",
                    ),
                ]}
            />,
        );
        const text = container.textContent ?? "";
        expect(text).toContain(
            "All judging (comparison, prompt and transcript judges) cost $0.3000 in total",
        );
        expect(text).toContain(
            "Comparison judging cost $0.1000 on models without a recorded total",
        );
        expect(text).not.toContain("$0.4000");
    });

    it("names a mixed judging total separately", () => {
        const { container } = render(
            <ModelsTable
                results={[
                    {
                        ...SMALL,
                        comparison: {
                            ...SMALL.comparison!,
                            judgeCostUsd: 0.2,
                            judgeCostCovers: "mixed",
                        },
                    },
                ]}
            />,
        );
        const text = container.textContent ?? "";
        expect(text).toContain(
            "Judging cost $0.2000 on models with a total recorded for only some items (all judges where recorded, else the comparison judge)",
        );
        expect(text).not.toContain("Comparison judging cost");
        expect(text).not.toContain("All judging");
    });

    it("leaves out comparison columns on a run without one", () => {
        const plain = { ...SMALL, comparison: undefined, goldenScore: 0.6 };
        const { container } = render(
            <ModelsTable
                results={[plain, BIG]}
                goldenLabel={goldenScoreLabel({ fieldConfigs: [] })}
            />,
        );
        expect(table().queryByText("Verdict")).toBeNull();
        expect(table().queryByText("Agreement")).toBeNull();
        expect(
            table().getByText("Exact match, all stored fields"),
        ).toBeInTheDocument();
        // One plain line says what it measures.
        expect(container.textContent).toContain(
            "Exact match, all stored fields: Share of the stored answer's fields the output matches exactly.",
        );
        expect(
            table().queryByRole("button", { name: /task details/ }),
        ).toBeNull();
    });

    it("shows the same figures as cards on small screens", () => {
        const { getAllByRole } = render(<ModelsTable results={[SMALL, BIG]} />);
        const cards = getAllByRole("listitem");
        expect(cards[0]?.textContent).toContain("Cost per call");
        expect(cards[0]?.textContent).toContain("2 of 40");
    });

    it("shows an empty state without models", () => {
        const { container } = render(<ModelsTable results={[]} />);
        expect(container.textContent).toContain("No results yet");
    });
});
