import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
    summarizePipelineComparison,
    type IPipelineComparison,
} from "@flash-evals/api-contract";
import { PipelineComparison } from "./pipeline-comparison";

afterEach(cleanup);

// Made-up snack-sales extraction; not client data.
const items = Array.from({ length: 40 }, (_, index) => `item-${index}`);

function comparison(
    overrides: Partial<IPipelineComparison> = {},
): IPipelineComparison {
    return {
        run: {
            id: "aaaaaaaa-0000-4000-8000-000000000001",
            status: "completed",
            createdAt: "2026-11-01T00:00:00.000Z",
            noteTitle: "Acme snacks baseline",
        },
        ...summarizePipelineComparison({
            config: {
                runId: "aaaaaaaa-0000-4000-8000-000000000001",
                benchmark: {
                    source: "model",
                    taskMap: {
                        tasks: [
                            {
                                key: "products",
                                name: "Products",
                                method: "agreement",
                                fields: [
                                    {
                                        path: "$.products",
                                        matcher: "set_overlap",
                                    },
                                ],
                            },
                        ],
                    },
                },
                referenceRunModelId: "rm-ref",
                referenceModelId: "openai/big-model",
                judgeDataPolicy: { onlyHosts: ["vertex"] },
            },
            pipelineName: "Acme chain",
            evalItemIds: items,
            referenceCells: items.map((datasetItemId) => ({
                datasetItemId,
                succeeded: true,
                costUsd: 0.004,
                latencyMs: 2000,
            })),
            answers: items.map((datasetItemId, index) => ({
                datasetItemId,
                status: "complete" as const,
                costUsd: 0.001,
                latencyMs: 900,
                scored: index < 39,
                details: {
                    tasks: [
                        {
                            key: "products",
                            method: "agreement" as const,
                            agreement: 1,
                        },
                    ],
                },
            })),
        }),
        ...overrides,
    };
}

describe("PipelineComparison", () => {
    it("answers, grids and tables the pipeline against the reference", () => {
        render(
            <PipelineComparison
                comparison={comparison()}
                pipelineName="Acme chain"
                referenceName="Big Model"
                runStatus="completed"
            />,
        );
        expect(
            screen.getByRole("heading", {
                name: "Compared with Acme snacks baseline",
            }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("link", { name: "Acme snacks baseline" }),
        ).toHaveAttribute("href", "/runs/aaaaaaaa-0000-4000-8000-000000000001");
        expect(
            screen.getByText(/judge data rules: Only vertex/),
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                "Acme chain can replace Big Model at 25% of the cost.",
            ),
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                "1 final answer not compared yet. Resume the run to compare them.",
            ),
        ).toBeInTheDocument();
        const grid = screen.getByRole("region", { name: "Task by task" });
        expect(within(grid).getAllByText("Acme chain").length).toBeGreaterThan(
            0,
        );
        expect(within(grid).getAllByText("Big Model").length).toBeGreaterThan(
            0,
        );
        const models = screen.getByRole("region", { name: "Models" });
        expect(
            within(models).getAllByText("Acme chain").length,
        ).toBeGreaterThan(0);
    });

    it("says when the compared run has been deleted", () => {
        render(
            <PipelineComparison
                comparison={comparison({
                    run: { id: "aaaaaaaa-0000-4000-8000-000000000001" },
                })}
                pipelineName="Acme chain"
                runStatus="completed"
            />,
        );
        expect(
            screen.getByRole("heading", { name: "Compared with Run aaaaaaaa" }),
        ).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Run aaaaaaaa" })).toBe(null);
        expect(screen.getByText(/has since been deleted/)).toBeInTheDocument();
    });
});
