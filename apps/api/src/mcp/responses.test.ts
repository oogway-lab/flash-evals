import { describe, expect, it } from "vitest";
import { ok } from "./responses.js";

describe("MCP success responses", () => {
    it("keeps the compact JSON fallback for ordinary legacy clients", () => {
        const data = { items: [{ id: "item-1", answer: "42" }] };
        const response = ok("Dataset details", data);

        expect(response.content[0]!.text).toBe(
            `Dataset details\n\n${JSON.stringify(data)}`,
        );
        expect(response.structuredContent.data).toEqual(data);
    });

    it("bounds the duplicated text fallback while preserving full structured data", () => {
        const data = {
            items: Array.from({ length: 1_000 }, (_, index) => ({
                id: `item-${index}`,
                answer: "x".repeat(32),
            })),
        };

        const response = ok("Dataset details", data);
        const serialized = JSON.stringify(data);
        const text = response.content[0]!.text;

        expect(serialized.length).toBeGreaterThan(24_000);
        expect(text.length).toBeLessThan(250);
        expect(text).toContain("Full result omitted from text fallback.");
        expect(text).not.toContain(serialized);
        expect(response.structuredContent.data).toEqual(data);
    });
});
