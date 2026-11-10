import { describe, expect, it, vi } from "vitest";

vi.mock("../db/client", () => ({ db: {} }));

import { readSetupComparisonSpendUsd } from "./spend";

describe("readSetupComparisonSpendUsd", () => {
    it("adds up every member run's spend, eval run and pipeline runs", async () => {
        const evalRunSpend = vi.fn(async () => 0.4);
        const workflowRunSpend = vi.fn(async (id: string) =>
            id === "pipeline-1" ? 0.25 : 0.1,
        );

        const spent = await readSetupComparisonSpendUsd("comparison-1", {
            memberRunIds: async () => ({
                evalRunIds: ["eval-1"],
                workflowRunIds: ["pipeline-1", "pipeline-2"],
            }),
            evalRunSpend,
            workflowRunSpend,
        });

        expect(spent).toBeCloseTo(0.75);
        expect(evalRunSpend).toHaveBeenCalledWith("eval-1");
        expect(workflowRunSpend).toHaveBeenCalledTimes(2);
    });

    it("is zero for a comparison with no member runs", async () => {
        await expect(
            readSetupComparisonSpendUsd("comparison-1", {
                memberRunIds: async () => ({
                    evalRunIds: [],
                    workflowRunIds: [],
                }),
                evalRunSpend: vi.fn(),
                workflowRunSpend: vi.fn(),
            }),
        ).resolves.toBe(0);
    });
});
