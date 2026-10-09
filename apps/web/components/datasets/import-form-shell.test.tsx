import { describe, expect, it } from "vitest";
import { MAX_TEXT_IMPORT_BYTES } from "@mosaic/api-contract";
import { textSizeGuardMessage } from "./import-form-shell";

function fileOfSize(bytes: number, name: string): File {
    return new File([new Uint8Array(bytes)], name, {
        type: "application/json",
    });
}

describe("textSizeGuardMessage", () => {
    it("returns a friendly, limit-naming message for an oversize inline file", () => {
        const fd = new FormData();
        fd.set("answers", fileOfSize(MAX_TEXT_IMPORT_BYTES + 1, "big.json"));

        const message = textSizeGuardMessage(fd, [
            { field: "answers", label: "Answer file" },
        ]);

        expect(message).toBe(
            "Answer file exceeds the 2MB limit. Reduce it and try again.",
        );
    });

    it("returns undefined when the file is within the limit", () => {
        const fd = new FormData();
        fd.set("answers", fileOfSize(1024, "small.json"));

        expect(
            textSizeGuardMessage(fd, [
                { field: "answers", label: "Answer file" },
            ]),
        ).toBeUndefined();
    });

    it("returns undefined when no guards are configured", () => {
        const fd = new FormData();
        fd.set("file", fileOfSize(MAX_TEXT_IMPORT_BYTES + 1, "big.csv"));

        expect(textSizeGuardMessage(fd, undefined)).toBeUndefined();
    });

    it("flags the first violating guard across multiple fields", () => {
        const fd = new FormData();
        fd.set("spreadsheet", fileOfSize(MAX_TEXT_IMPORT_BYTES + 1, "big.csv"));

        expect(
            textSizeGuardMessage(fd, [
                { field: "spreadsheet", label: "CSV file" },
            ]),
        ).toBe("CSV file exceeds the 2MB limit. Reduce it and try again.");
    });
});
