import { describe, expect, it } from "vitest";
import { code128B } from "./code128";

// Published code 128 module widths. Every symbol is 11 modules wide; the stop
// symbol is 13.
const START_B = [2, 1, 1, 2, 1, 4];
const STOP = [2, 3, 3, 1, 1, 1, 2];

// Splits the flat width list back into symbols, so a mis-sized symbol fails
// here rather than only showing up as a barcode that will not scan.
function symbols(widths: number[]): number[][] {
    const body = widths.slice(0, -7);
    const groups: number[][] = [];
    for (let index = 0; index < body.length; index += 6) {
        groups.push(body.slice(index, index + 6));
    }
    return [...groups, widths.slice(-7)];
}

describe("code128B", () => {
    it("wraps empty text in the set-B start, checksum 1, and stop symbols", () => {
        // The weighted checksum of the start symbol alone is 104 % 103 = 1.
        expect(code128B("")).toEqual([...START_B, 2, 2, 2, 1, 2, 2, ...STOP]);
    });

    it("encodes 'A' as value 33 with checksum 34", () => {
        expect(code128B("A")).toEqual([
            ...START_B,
            1,
            1,
            1,
            3,
            2,
            3, // 'A' (33)
            1,
            3,
            1,
            1,
            2,
            3, // checksum (104 * 1 + 33 * 1) % 103 = 34
            ...STOP,
        ]);
    });

    it("emits one 11-module symbol per character plus start and checksum", () => {
        const text = "flashevals.dev";
        const widths = code128B(text);
        const groups = symbols(widths);

        expect(widths).toHaveLength(6 * (text.length + 2) + 7);
        expect(widths.slice(0, -7)).toHaveLength(6 * (text.length + 2));
        expect(groups[0]).toEqual(START_B);
        expect(groups.at(-1)).toEqual(STOP);
        // Start, one symbol per character, and the checksum.
        expect(groups.slice(1, -1)).toHaveLength(text.length + 1);
        for (const group of groups.slice(0, -1)) {
            expect(group.reduce((sum, width) => sum + width, 0)).toBe(11);
        }
        for (const width of widths) {
            expect(width).toBeGreaterThan(0);
            expect(width).toBeLessThanOrEqual(4);
        }
    });

    it("rejects characters outside set B", () => {
        expect(() => code128B("\n")).toThrow("cannot encode");
        expect(() => code128B("\u007f")).toThrow("cannot encode");
        expect(() => code128B("é")).toThrow("cannot encode");
    });
});
