import { describe, expect, it } from "vitest";
import { validateGenerationFields } from "./generation-validation";

const valid = {
    maxOutputTokens: "4096",
    timeoutMs: "60000",
    temperature: "",
    topP: "",
    seed: "",
    maxAttempts: "1",
};

describe("validateGenerationFields", () => {
    it("accepts defaults and empty optional fields", () => {
        expect(validateGenerationFields(valid)).toEqual({});
        expect(
            validateGenerationFields({
                ...valid,
                temperature: "0.7",
                topP: "1",
                seed: "42",
            }),
        ).toEqual({});
    });

    it("flags out-of-range and non-integer values instead of falling back", () => {
        expect(
            validateGenerationFields({
                maxOutputTokens: "0",
                timeoutMs: "abc",
                temperature: "3",
                topP: "1.5",
                seed: "1.2",
                maxAttempts: "0",
            }),
        ).toEqual({
            maxOutputTokens: "Enter a whole number of at least 1.",
            timeoutMs: "Enter a timeout of at least 1 ms.",
            temperature: "Temperature must be between 0 and 2.",
            topP: "Top P must be between 0 and 1.",
            seed: "Seed must be a whole number.",
            maxAttempts: "Enter at least 1 attempt.",
        });
    });

    it("skips attempts when the transport has no Flash Evals retries", () => {
        const { maxAttempts: _omit, ...gateway } = valid;
        expect(validateGenerationFields(gateway)).toEqual({});
    });
});
