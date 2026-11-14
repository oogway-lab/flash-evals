import { describe, expect, it, vi } from "vitest";

vi.mock("../db/client", () => ({ db: {} }));
const resolvePricingFor = vi.hoisted(() => vi.fn());
vi.mock("../llm/pricing", () => ({ resolvePricingFor }));

import { judgePricing, recordJudgeCost, totalJudgeCostUsd } from "./judgeCost";

describe("judge cost", () => {
    it("adds up known judge costs and stays unknown when none is known", () => {
        expect(totalJudgeCostUsd(0.01, undefined, 0.02)).toBeCloseTo(0.03);
        expect(totalJudgeCostUsd(undefined, undefined)).toBeUndefined();
        expect(totalJudgeCostUsd(Number.NaN)).toBeUndefined();
    });

    it("adds a scoring pass's cost to the cell, and skips nothing to add", async () => {
        const where = vi.fn(async () => undefined);
        const set = vi.fn(() => ({ where }));
        const tx = { update: vi.fn(() => ({ set })) };

        await recordJudgeCost(tx as never, "cell-1", undefined);
        await recordJudgeCost(tx as never, "cell-1", 0);
        expect(tx.update).not.toHaveBeenCalled();

        await recordJudgeCost(tx as never, "cell-1", 0.04);
        expect(tx.update).toHaveBeenCalledOnce();
        // An increment (coalesce + cost), not an overwrite: every pass paid.
        const payload = (set.mock.calls[0] as unknown[])[0] as {
            judgeCostUsd: { queryChunks: unknown[] };
        };
        expect(
            payload.judgeCostUsd.queryChunks.some((chunk) =>
                (chunk as { value?: string[] }).value?.some((text) =>
                    text.includes("coalesce("),
                ),
            ),
        ).toBe(true);
        expect(payload.judgeCostUsd.queryChunks).toContain(0.04);
    });

    it("treats a price lookup failure as no price", async () => {
        resolvePricingFor.mockRejectedValueOnce(new Error("offline"));
        await expect(
            judgePricing({})("gpt-4o-mini", "openai"),
        ).resolves.toBeUndefined();
    });
});
