import { describe, expect, it } from "vitest";
import {
    MAX_STEP_ERROR_CHARS,
    failedStepMessage,
    stepErrorText,
} from "./stepError";

describe("a failed step's provider message", () => {
    it("drops the call's key and key-shaped text", () => {
        expect(
            stepErrorText(
                new Error("bad key the-active-key; api_key=abc123 used"),
                "the-active-key",
            ),
        ).toBe("bad key [REDACTED]; api_key=[REDACTED] used");
    });

    it("keeps the cause and folds white space", () => {
        const error = Object.assign(new Error("Bad request"), {
            cause: new Error("model\n  not found"),
        });
        expect(stepErrorText(error)).toBe("Bad request: model not found");
    });

    it("caps long text and is nothing without an error", () => {
        const text = stepErrorText(new Error("y".repeat(3000)));
        expect(text).toHaveLength(MAX_STEP_ERROR_CHARS + 1);
        expect(stepErrorText(undefined)).toBeUndefined();
        expect(stepErrorText(new Error("   "))).toBe("Error");
    });

    it("stores a failed step's message without its keys", () => {
        expect(
            failedStepMessage(new Error("key sk-abcdefgh12345678 bad")),
        ).toBe("key [REDACTED] bad");
        expect(
            failedStepMessage(new Error("Authorization: Bearer abcdefghijkl")),
        ).toBe("Authorization: [REDACTED]");
        expect(failedStepMessage("")).toBe("The step failed.");
    });
});
