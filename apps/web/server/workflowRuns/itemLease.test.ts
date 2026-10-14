import { describe, expect, it } from "vitest";
import {
    nextPreparationPollDelay,
    nextPreparationWaitDeadline,
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

describe("nextPreparationWaitDeadline", () => {
    it("extends the wait while the owner's heartbeat advances", () => {
        const start = 1_000_000;
        let state = nextPreparationWaitDeadline(
            { deadlineMs: start + workflowPreparationWaitMs },
            new Date(start - 10_000),
            start,
        );
        expect(state.deadlineMs).toBe(start + workflowPreparationWaitMs);
        const later = start + workflowPreparationWaitMs - 1_000;
        state = nextPreparationWaitDeadline(state, new Date(later), later);
        expect(state.deadlineMs).toBe(later + workflowPreparationWaitMs);
    });

    it("keeps the deadline when the heartbeat has stalled", () => {
        const state = { deadlineMs: 5_000, lastClaimedAtMs: 1_000 };
        expect(nextPreparationWaitDeadline(state, new Date(1_000), 4_000)).toBe(
            state,
        );
        expect(nextPreparationWaitDeadline(state, null, 4_000)).toBe(state);
    });
});
