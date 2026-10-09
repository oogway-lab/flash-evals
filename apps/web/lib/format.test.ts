import { describe, expect, it } from "vitest";
import {
    MISSING_VALUE,
    fmtCost,
    fmtDate,
    fmtDateShort,
    fmtDelta,
    fmtLatency,
    fmtRelativeTime,
    fmtScore,
    fmtTokens,
    formatCostColumn,
} from "./format";

describe("missing values", () => {
    it("uses the en dash as the single missing-value marker", () => {
        expect(MISSING_VALUE).toBe("–");
    });

    it.each([
        ["fmtScore", fmtScore],
        ["fmtLatency", fmtLatency],
        ["fmtTokens", fmtTokens],
        ["fmtCost", fmtCost],
    ] as const)("%s renders null and undefined as the marker", (_, fmt) => {
        expect(fmt(undefined)).toBe(MISSING_VALUE);
        expect(fmt(null)).toBe(MISSING_VALUE);
    });

    it("fmtDelta renders a missing side as the marker", () => {
        expect(fmtDelta(undefined, 1).text).toBe(MISSING_VALUE);
        expect(fmtDelta(1, undefined).text).toBe(MISSING_VALUE);
    });
});

describe("present values", () => {
    it("formats numbers unchanged", () => {
        expect(fmtScore(0.8)).toBe("0.80");
        expect(fmtLatency(1234.4)).toBe("1234 ms");
        expect(fmtTokens(1234)).toBe("1,234");
        expect(fmtCost(0)).toBe("$0.00");
        expect(fmtCost(0.5)).toBe("$0.5000");
    });
});

describe("fmtDate", () => {
    it("renders in UTC and labels the zone", () => {
        expect(fmtDate("2026-07-06T08:30:00.000Z")).toBe(
            "7/6/26, 8:30:00 AM UTC",
        );
    });
});

describe("formatCostColumn", () => {
    it("uses one unit and precision for the whole column", () => {
        const format = formatCostColumn([0.0042, 0.5, 0, undefined]);
        expect(format(0.0042)).toBe("$0.0042");
        expect(format(0.5)).toBe("$0.5000");
        expect(format(0)).toBe("$0.0000");
        expect(format(undefined)).toBe(MISSING_VALUE);
    });

    it("never switches to cents for small values", () => {
        const format = formatCostColumn([0.00003, 1.2]);
        expect(format(0.00003)).toBe("$0.000030");
        expect(format(1.2)).toBe("$1.200000");
    });

    it("keeps two decimals when every value is a dollar or more", () => {
        const format = formatCostColumn([1.5, 12.34]);
        expect(format(12.34)).toBe("$12.34");
    });
});

describe("fmtRelativeTime", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");

    it.each([
        ["2026-10-04T11:59:40Z", "just now"],
        ["2026-10-04T11:55:00Z", "5 minutes ago"],
        ["2026-10-04T09:00:00Z", "3 hours ago"],
        ["2026-10-03T12:00:00Z", "yesterday"],
        ["2026-10-01T12:00:00Z", "3 days ago"],
        ["2026-07-04T12:00:00Z", "3 months ago"],
        ["2024-10-04T12:00:00Z", "2 years ago"],
        ["2026-10-04T14:00:00Z", "in 2 hours"],
    ])("renders %s as %s", (value, expected) => {
        expect(fmtRelativeTime(value, now)).toBe(expected);
    });
});

describe("fmtDateShort", () => {
    it("renders the UTC calendar date", () => {
        expect(fmtDateShort("2026-07-06T23:30:00.000Z")).toBe("Jul 6, 2026");
    });
});
