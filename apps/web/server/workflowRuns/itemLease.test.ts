import { describe, expect, it } from "vitest";
import {
    nextPreparationPollDelay,
    preparationLeaseExpired,
    workflowItemLeaseMs,
    workflowPreparationWaitMs,
} from "./itemLease";

describe("workflow item leases", () => {
    it("allows pending and expired preparations to be claimed", () => {
        const now = Date.now();
        expect(
            preparationLeaseExpired(
                { preparationStatus: "pending", claimedAt: null },
                now,
            ),
        ).toBe(true);
        expect(
            preparationLeaseExpired(
                {
                    preparationStatus: "running",
                    claimedAt: new Date(now - workflowItemLeaseMs),
                },
                now,
            ),
        ).toBe(true);
    });

    it("keeps an active owner fenced and bounds waiter backoff", () => {
        const now = Date.now();
        expect(
            preparationLeaseExpired(
                {
                    preparationStatus: "running",
                    claimedAt: new Date(now - workflowItemLeaseMs + 1),
                },
                now,
            ),
        ).toBe(false);
        expect(nextPreparationPollDelay(800)).toBe(1_000);
        expect(nextPreparationPollDelay(1_000)).toBe(1_000);
        expect(workflowPreparationWaitMs).toBeGreaterThan(workflowItemLeaseMs);
    });
});
