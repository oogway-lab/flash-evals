import { describe, expect, it } from "vitest";
import {
    DEFAULT_STALE_CLAIM_MS,
    MIN_STALE_CLAIM_MS,
    parseStaleClaimMs,
} from "./claimLease";

describe("parseStaleClaimMs", () => {
    it("uses the default for missing or invalid values", () => {
        expect(parseStaleClaimMs(undefined)).toBe(DEFAULT_STALE_CLAIM_MS);
        expect(parseStaleClaimMs("invalid")).toBe(DEFAULT_STALE_CLAIM_MS);
        expect(parseStaleClaimMs("-1")).toBe(DEFAULT_STALE_CLAIM_MS);
    });

    it("clamps valid values to the minimum lease", () => {
        expect(parseStaleClaimMs("1000")).toBe(MIN_STALE_CLAIM_MS);
        expect(parseStaleClaimMs("120000")).toBe(120_000);
    });
});
