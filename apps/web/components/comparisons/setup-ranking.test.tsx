import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
    summarizeSetupComparison,
    type IRunBenchmarkConfig,
} from "@flash-evals/api-contract";
import { SetupRanking } from "./setup-ranking";
import {
    buildSetupRankingResults,
    candidateNoun,
} from "@/components/runs/run-results";

afterEach(cleanup);

// Made-up snack-sales extraction; not client data.
const BENCHMARK: IRunBenchmarkConfig = {
    source: "model",
    taskMap: {
        tasks: [
            {
                key: "products",
                name: "Products",
                method: "agreement",
                fields: [{ path: "$.products", matcher: "set_overlap" }],
            },
        ],
    },
};

const ITEMS = Array.from({ length: 4 }, (_, i) => `item-${i + 1}`);
const agreed = (agreement: number) => ({
    tasks: [{ key: "products", method: "agreement" as const, agreement }],
});

function ranking() {
    return summarizeSetupComparison({
        benchmark: BENCHMARK,
        evalRunId: "eval-run-1",
        runModels: [
            { id: "rm-ref", modelId: "vendor/big-model", isReference: true },
            {
                id: "rm-small",
                modelId: "vendor/small-model",
                isReference: false,
            },
        ],
        cells: [
            ...ITEMS.map((datasetItemId) => ({
                runModelId: "rm-ref",
                datasetItemId,
                status: "succeeded",
                costUsd: 0.01,
                latencyMs: 2000,
            })),
            ...ITEMS.map((datasetItemId) => ({
                runModelId: "rm-small",
                datasetItemId,
                status: "succeeded",
                costUsd: 0.004,
                latencyMs: 800,
                details: agreed(0.5),
            })),
        ],
        pipelines: [
            {
                workflowRunId: "wf-run-1",
                workflowId: "wf-1",
                name: "Three steps",
                stepModels: ["vendor/model-a", "vendor/model-b"],
                itemCount: 4,
                answers: ITEMS.slice(0, 3).map((datasetItemId) => ({
                    datasetItemId,
                    status: "complete" as const,
                    scored: true,
                    costUsd: 0.002,
                    latencyMs: 1500,
                    details: agreed(0.9),
                })),
            },
        ],
    });
}

describe("SetupRanking", () => {
    it("ranks models and pipelines in one table, with links and the frontier marked", () => {
        render(
            <SetupRanking
                ranking={ranking()}
                modelInfo={{
                    "vendor/model-a": { label: "Model A" } as never,
                }}
                status="running"
            />,
        );
        const table = screen.getAllByRole("region", { name: "Setups" })[0]!;
        const pipeline = within(table).getAllByRole("link", {
            name: "Three steps (Model A → vendor/model-b)",
        })[0]!;
        expect(pipeline).toHaveAttribute(
            "href",
            "/multiworkflow/wf-1/runs/wf-run-1",
        );
        expect(
            within(table).getAllByRole("link", {
                name: "vendor/small-model",
            })[0],
        ).toHaveAttribute("href", "/runs/eval-run-1");
        expect(
            within(table).getAllByText("Scored / waiting / failed").length,
        ).toBeGreaterThan(0);
        // The pipeline: 3 scored, 1 waiting, none failed.
        expect(
            within(table).getAllByLabelText("3 scored, 1 waiting, 0 failed")
                .length,
        ).toBeGreaterThan(0);
        // The pipeline is cheaper and more accurate than the small model,
        // so only the reference and the pipeline are not beaten.
        expect(
            within(table).getAllByText("Not beaten on accuracy and cost"),
        ).toHaveLength(4);
        expect(screen.getByText("Task by task")).toBeInTheDocument();
        // The pipeline has finished 3 of the 4 items, so all are compared on 3.
        expect(
            screen.getByText(/compare every setup on the same 3 items/),
        ).toBeInTheDocument();
    });

    it("says which setup stopped early and counts failures on the compared items", () => {
        const stopped = ranking();
        // The pipeline run stopped after three items; the small model
        // failed the fourth, which is not compared.
        stopped.rows = stopped.rows.map((row) =>
            row.id === "rm-small"
                ? { ...row, failedItems: 1, comparedFailedItems: 0 }
                : row,
        );
        stopped.finishedFewer = ["pipeline:wf-run-1"];
        render(
            <SetupRanking
                ranking={stopped}
                modelInfo={{}}
                status="completed"
            />,
        );
        expect(
            screen.getByText(
                /Three steps \(vendor\/model-a → vendor\/model-b\) finished fewer items than the other setups/,
            ),
        ).toBeInTheDocument();
        // Failures count as misses on the 3 compared items: none.
        const small = buildSetupRankingResults({
            ranking: stopped,
            modelInfo: {},
            hrefFor: () => "",
        }).find((result) => result.runModelId === "rm-small")!;
        expect(small).toMatchObject({ failedCells: 0, cells: 3 });
        expect(small.progress).toMatchObject({ failed: 1 });
    });

    it("words the answer for a mix of models and pipelines", () => {
        render(
            <SetupRanking
                ranking={ranking()}
                modelInfo={{}}
                status="completed"
            />,
        );
        expect(
            screen.getByText(
                /(No setup can replace|Too few items to tell whether a setup can replace) vendor\/big-model/,
            ),
        ).toBeInTheDocument();
    });

    it("calls candidates models, pipelines or setups", () => {
        expect(candidateNoun([{ kind: "reference" }, { kind: "model" }])).toBe(
            "model",
        );
        expect(
            candidateNoun([{ kind: "reference" }, { kind: "pipeline" }]),
        ).toBe("pipeline");
        expect(
            candidateNoun([
                { kind: "reference" },
                { kind: "model" },
                { kind: "pipeline" },
            ]),
        ).toBe("setup");
    });
});
