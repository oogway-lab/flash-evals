import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type {
    ILeaderboardRow,
    IRunConfigSnapshot,
    IRunContext,
} from "@mosaic/api-contract";
import { RunSummary } from "./run-summary";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

function row(overrides: Partial<ILeaderboardRow>): ILeaderboardRow {
    return {
        runModelId: "rm",
        modelId: "model",
        isReference: false,
        n: 10,
        avgFieldScore: undefined,
        avgJudgeScore: undefined,
        avgTranscriptScore: undefined,
        avgTranscriptJudgeScore: undefined,
        avgWer: undefined,
        avgCer: undefined,
        avgCpWer: undefined,
        avgSttLatencyMs: undefined,
        p95SttLatencyMs: undefined,
        totalSttCostUsd: undefined,
        p95LatencyMs: undefined,
        transcriptFailureCount: 0,
        avgLatencyMs: 1000,
        avgPromptTokens: 100,
        avgCompletionTokens: 100,
        avgTotalTokens: 200,
        totalCostUsd: 0.5,
        projectedCostPer1k: undefined,
        costAvailable: true,
        tokenUsageAvailable: true,
        ...overrides,
    };
}

const ROWS = [
    row({ runModelId: "rm-1", modelId: "gpt-4o", avgJudgeScore: 0.9 }),
    row({ runModelId: "rm-2", modelId: "gpt-4o-mini", avgJudgeScore: 0.7 }),
];

const CONTEXT: IRunContext = {
    datasetName: "Food",
    prompts: [{ promptId: "p-1", name: "Meal analyzer", version: 3 }],
    judge: { modelId: "gpt-5.4-mini" },
};

function renderSummary(props: Partial<Parameters<typeof RunSummary>[0]> = {}) {
    return render(
        <RunSummary
            progressUrl="/api/runs/run-1/progress"
            initial={{
                status: "completed",
                total: 20,
                done: 20,
                failed: 0,
                pending: 0,
            }}
            leaderboard={ROWS}
            configSnapshot={{} as IRunConfigSnapshot}
            datasetId="ds-1"
            createdAt="2026-06-23T16:09:50.000Z"
            context={CONTEXT}
            {...props}
        />,
    );
}

describe("RunSummary", () => {
    it("leads with the best model, its score, cost and cell count", () => {
        renderSummary();
        const summary = screen.getByRole("region", { name: "Run summary" });

        expect(within(summary).getByText("Best model")).toBeInTheDocument();
        expect(within(summary).getByText("0.90")).toBeInTheDocument();
        expect(within(summary).getByText("gpt-4o")).toBeInTheDocument();
        expect(within(summary).getByText(/judge score/)).toBeInTheDocument();
        expect(within(summary).getByText("$1.00")).toBeInTheDocument();
        expect(within(summary).getByText("20 / 20")).toBeInTheDocument();
        expect(within(summary).getByText("All complete")).toBeInTheDocument();
    });

    it("drops the progress bar once the run is complete", () => {
        renderSummary();
        expect(screen.queryByRole("progressbar")).toBeNull();
        expect(
            screen.getByLabelText("Run status: Completed"),
        ).toBeInTheDocument();
    });

    it("keeps the live progress bar while the run is active", () => {
        renderSummary({
            initial: {
                status: "running",
                total: 20,
                done: 5,
                failed: 0,
                pending: 15,
            },
        });
        expect(
            screen.getByRole("progressbar", { name: "Run progress" }),
        ).toBeInTheDocument();
        expect(screen.getByText("Leading model")).toBeInTheDocument();
        expect(screen.getByText("25% complete")).toBeInTheDocument();
    });

    it("says so when a tie has no single winner", () => {
        renderSummary({
            leaderboard: [
                row({ modelId: "a", avgJudgeScore: 0.9 }),
                row({ modelId: "b", avgJudgeScore: 0.904 }),
            ],
        });
        expect(screen.getByText("2 models tied")).toBeInTheDocument();
        expect(screen.getByText("Best model")).toBeInTheDocument();
    });

    it("shows an en dash and an honest note when nothing is scored", () => {
        renderSummary({
            leaderboard: [row({ modelId: "a" }), row({ modelId: "b" })],
        });
        expect(
            screen.getByText("No scores recorded for this run."),
        ).toBeInTheDocument();
    });

    it("notes that scores are still arriving while in progress", () => {
        renderSummary({
            leaderboard: [],
            initial: {
                status: "running",
                total: 20,
                done: 0,
                failed: 0,
                pending: 20,
            },
        });
        expect(
            screen.getByText("Scores appear as cells finish."),
        ).toBeInTheDocument();
    });

    it("labels a single-model run Score rather than Best model", () => {
        renderSummary({ leaderboard: [ROWS[0]!] });
        expect(screen.getByText("Score")).toBeInTheDocument();
        expect(screen.queryByText("Best model")).toBeNull();
    });

    it("shows failed cells in the cell count", () => {
        renderSummary({
            initial: {
                status: "partial",
                total: 20,
                done: 18,
                failed: 2,
                pending: 0,
            },
        });
        expect(screen.getByText("18 / 20")).toBeInTheDocument();
        expect(screen.getByText("2 failed")).toBeInTheDocument();
    });

    it("does not claim all cells completed for a run that stopped with cells pending", () => {
        renderSummary({
            initial: {
                status: "partial",
                total: 20,
                done: 8,
                failed: 0,
                pending: 12,
            },
        });
        expect(screen.getByText("8 / 20")).toBeInTheDocument();
        expect(screen.getByText("12 pending")).toBeInTheDocument();
        expect(screen.queryByText("All complete")).toBeNull();
    });

    it("names both failed and pending cells on a stopped run", () => {
        renderSummary({
            initial: {
                status: "partial",
                total: 20,
                done: 8,
                failed: 2,
                pending: 10,
            },
        });
        expect(screen.getByText("2 failed · 10 pending")).toBeInTheDocument();
    });

    it("counts failed cells as settled so the live bar can reach 100%", () => {
        renderSummary({
            initial: {
                status: "running",
                total: 20,
                done: 18,
                failed: 2,
                pending: 0,
            },
        });
        expect(
            screen.getByRole("progressbar", { name: "Run progress" }),
        ).toHaveAttribute("aria-valuenow", "100");
        expect(
            screen.getByText("100% complete · 2 failed"),
        ).toBeInTheDocument();
    });

    it("flags a cost total that is missing some cells", () => {
        renderSummary({
            leaderboard: [
                row({ modelId: "a", avgJudgeScore: 0.9, costAvailable: false }),
                row({ modelId: "b", avgJudgeScore: 0.7 }),
            ],
        });
        expect(
            screen.getByText("Some cells reported no cost."),
        ).toBeInTheDocument();
    });

    it("lists dataset, prompt, judge and created time", () => {
        renderSummary();
        expect(screen.getByRole("link", { name: "Food" })).toHaveAttribute(
            "href",
            "/datasets/ds-1",
        );
        expect(
            screen.getByRole("link", { name: "Meal analyzer" }),
        ).toHaveAttribute("href", "/prompts/p-1");
        expect(screen.getByText("v3")).toBeInTheDocument();
        expect(screen.getByText("gpt-5.4-mini")).toBeInTheDocument();
        expect(
            screen.getByText("6/23/26, 4:09:50 PM UTC").closest("time"),
        ).toHaveAttribute("datetime", "2026-06-23T16:09:50.000Z");
    });

    it("omits prompt and judge when the run has none, and still links the dataset", () => {
        renderSummary({ context: undefined });
        expect(screen.queryByText("Prompt")).toBeNull();
        expect(screen.queryByText("Judge")).toBeNull();
        expect(
            screen.getByRole("link", { name: "View dataset" }),
        ).toHaveAttribute("href", "/datasets/ds-1");
    });

    it("summarizes several prompts as a count", () => {
        renderSummary({
            context: {
                ...CONTEXT,
                prompts: [
                    { promptId: "p-1", name: "A", version: 1 },
                    { promptId: "p-2", name: "B", version: 2 },
                ],
            },
        });
        expect(screen.getByText("2 prompts")).toBeInTheDocument();
    });

    it("reads the judge from an STT evaluator in the config snapshot", () => {
        renderSummary({
            context: undefined,
            configSnapshot: {
                sttConfig: {
                    modelId: "soniox",
                    evaluator: {
                        enabled: true,
                        modelId: "gemini-2.5-flash",
                        rubricPrompt: "x",
                    },
                },
            } as IRunConfigSnapshot,
        });
        expect(screen.getByText("gemini-2.5-flash")).toBeInTheDocument();
    });
});
