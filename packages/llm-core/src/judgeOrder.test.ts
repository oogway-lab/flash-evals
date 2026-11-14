import { describe, expect, it } from "vitest";
import { candidateGoesFirst, judgeOrderSeed } from "./judgeOrder.js";

describe("judge order", () => {
    it("is fixed per seed and split across seeds", () => {
        const seeds = Array.from({ length: 200 }, (_, i) =>
            judgeOrderSeed(`cell-${i}`, "writeups"),
        );
        const first = seeds.filter(candidateGoesFirst).length;
        expect(first).toBeGreaterThan(60);
        expect(first).toBeLessThan(140);
        expect(candidateGoesFirst(seeds[0]!)).toBe(
            candidateGoesFirst(seeds[0]!),
        );
        expect(judgeOrderSeed("c1", "t1")).toBe("c1:t1");
    });
});
