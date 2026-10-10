import { describe, expect, it } from "vitest";
import { ok } from "./responses.js";

describe("MCP success responses", () => {
    it("keeps the full compact JSON fallback for large legacy clients", () => {
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
        expect(text).toBe(`Dataset details\n\n${serialized}`);
        expect(text.slice(text.indexOf("\n\n") + 2)).not.toContain("\n");
        expect(JSON.parse(text.slice(text.indexOf("\n\n") + 2))).toEqual(data);
        expect(response.structuredContent.data).toEqual(data);
    });
});
