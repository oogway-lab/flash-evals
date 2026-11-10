import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { IWorkflowRunDetailResponse } from "@flash-evals/api-contract";
import { StepNumbers, StepThinking, stepRoute } from "./item-outputs";

afterEach(cleanup);

describe("StepNumbers", () => {
    function renderCost(source: string) {
        const cell = {
            latencyMs: 10,
            costUsd: 0.002,
            llmExecution: {
                availability: "complete",
                currentCost: { usd: 0.002, source },
            },
        } as unknown as IWorkflowRunDetailResponse["cells"][number];
        render(
            <StepNumbers
                cell={cell}
                hidden={false}
                fmtCost={(usd) => String(usd)}
            />,
        );
    }

    it("marks a cost the provider didn't report as the registry's list price", () => {
        renderCost("catalog_estimate");
        expect(screen.getByText("registry list price")).toBeInTheDocument();
    });

    it("marks a cost priced from Bifrost's model list", () => {
        renderCost("bifrost_list_price");
        expect(screen.getByText("Bifrost list price")).toBeInTheDocument();
    });

    it("marks nothing on a reported cost", () => {
        renderCost("provider_reported");
        expect(screen.queryByText(/list price/)).not.toBeInTheDocument();
    });
});

type Execution = IWorkflowRunDetailResponse["cells"][number]["llmExecution"];

function bifrostExecution(upstreamProvider?: string): Execution {
    return {
        availability: "complete",
        resolved: {
            route: {
                modelId: "gpt-4o",
                transportConfig: {
                    transport: "bifrost",
                    upstreamPolicy: { mode: "bifrost_default" },
                },
            },
            capability: {
                transport: { transportModelId: "openrouter/openai/gpt-4o" },
            },
        },
        actual: upstreamProvider
            ? {
                  status: "resolved",
                  identity: {
                      transport: "bifrost",
                      modelId: "openai/gpt-4o",
                      upstreamProvider,
                  },
                  evidenceCompleteness: "complete",
              }
            : { status: "unresolved", evidenceCompleteness: "partial" },
    } as unknown as Execution;
}

describe("stepRoute", () => {
    it("shows a Bifrost step's own model id and the host, or that none was reported", () => {
        expect(stepRoute(undefined, bifrostExecution(), undefined)).toEqual({
            model: "openrouter/openai/gpt-4o",
            via: "bifrost, host not reported",
        });
        expect(
            stepRoute(undefined, bifrostExecution("google-vertex"), undefined),
        ).toEqual({
            model: "openrouter/openai/gpt-4o",
            via: "bifrost, served by google-vertex",
        });
    });
});

describe("StepThinking", () => {
    it("shows the call's warnings, even without thinking", () => {
        const artifact = {
            text: "ok",
            warnings: ["The output limit is more than the model can give."],
        } as IWorkflowRunDetailResponse["cells"][number]["outputJson"];
        render(<StepThinking artifact={artifact} />);
        expect(screen.getByRole("note")).toHaveTextContent(
            "The output limit is more than the model can give.",
        );
    });
});
