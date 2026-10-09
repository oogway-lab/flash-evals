import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: vi.fn() }),
    usePathname: () => "/runs/r-current",
    useSearchParams: () => new URLSearchParams(),
}));

import { RunComparison } from "./run-comparison";
import type { IComparableRun, IModelComparison } from "@mosaic/api-contract";

afterEach(cleanup);

const RUNS: IComparableRun[] = [
    {
        id: "r-base",
        createdAt: new Date("2026-06-20").toISOString(),
        models: ["gpt-4o"],
    },
];

describe("RunComparison", () => {
    it("shows an empty state when there are no comparable runs", () => {
        const { container } = render(<RunComparison comparableRuns={[]} />);
        expect(container.textContent).toContain("No other completed runs");
    });

    it("summarizes improved vs regressed and renders per-model deltas", () => {
        const comparison: IModelComparison[] = [
            {
                modelId: "gpt-4o",
                isReference: false,
                baseline: {
                    quality: 0.7,
                    qualitySource: "judge",
                    cost: 10,
                    latency: 1000,
                    p95Latency: 1300,
                    sttCost: 1,
                    sttP95Latency: 1200,
                    wer: 0.1,
                    cpWer: 0.2,
                    transcriptJudgeScore: 0.8,
                    hardFailureCount: 0,
                    effort: undefined,
                    n: 10,
                },
                current: {
                    quality: 0.8,
                    qualitySource: "judge",
                    cost: 9,
                    latency: 1100,
                    p95Latency: 1400,
                    sttCost: 0.8,
                    sttP95Latency: 1300,
                    wer: 0.11,
                    cpWer: 0.22,
                    transcriptJudgeScore: 0.75,
                    hardFailureCount: 0,
                    effort: undefined,
                    n: 10,
                },
                delta: {
                    quality: 0.1,
                    cost: -1,
                    latency: 100,
                    qualityComparable: true,
                },
                sttShipGate: {
                    status: "pass",
                    summary: "All applicable STT ship gates passed.",
                    checks: [],
                },
            },
        ];
        const { container } = render(
            <RunComparison
                comparableRuns={RUNS}
                baselineRunId="r-base"
                comparison={comparison}
            />,
        );
        expect(container.textContent).toContain("1 improved");
        expect(container.textContent).toContain("0 regressed");
        expect(container.textContent).toContain("gpt-4o");
        expect(container.textContent).toContain("Pass");
        // sr-only "better"/"worse" words back up the colour-coded deltas
        expect(container.textContent).toContain("better");
        expect(container.textContent).toContain("worse");
    });

    it("flags a model present on only one side", () => {
        const comparison: IModelComparison[] = [
            {
                modelId: "gpt-4.1",
                isReference: false,
                baseline: undefined,
                current: {
                    quality: 0.6,
                    qualitySource: "judge",
                    cost: 5,
                    latency: 800,
                    p95Latency: undefined,
                    sttCost: undefined,
                    sttP95Latency: undefined,
                    wer: undefined,
                    cpWer: undefined,
                    transcriptJudgeScore: undefined,
                    hardFailureCount: 0,
                    effort: undefined,
                    n: 5,
                },
                delta: undefined,
                sttShipGate: undefined,
            },
        ];
        const { container } = render(
            <RunComparison
                comparableRuns={RUNS}
                baselineRunId="r-base"
                comparison={comparison}
            />,
        );
        expect(container.textContent).toContain("New");
    });
});
