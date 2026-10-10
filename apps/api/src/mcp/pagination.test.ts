import { describe, expect, it } from "vitest";
import {
    decodeMcpPageCursor,
    encodeMcpPageCursor,
    pageCursorFromRow,
} from "./pagination.js";

const scope = JSON.stringify(["dataset-1", null, null]);
const row = {
    createdAt: "2025-04-05T06:07:08.123456Z",
    id: "11111111-1111-4111-8111-111111111111",
};

describe("MCP page cursors", () => {
    it("preserves PostgreSQL microseconds when encoding a row cursor", () => {
        const decoded = decodeMcpPageCursor(
            pageCursorFromRow(scope, row),
            scope,
        );

        expect(decoded).toEqual(row);
    });

    it("preserves microseconds and rejects cursors from another scope", () => {
        const encoded = encodeMcpPageCursor(scope, row);

        expect(decodeMcpPageCursor(encoded, scope)).toEqual(row);
        expect(() => decodeMcpPageCursor(encoded, "another-scope")).toThrow(
            "Invalid page cursor.",
        );
    });
});
