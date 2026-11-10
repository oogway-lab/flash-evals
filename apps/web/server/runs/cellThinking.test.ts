import { describe, expect, it } from "vitest";
import { unsentThinkingOutcome, withThinkingOutcome } from "./cellThinking";

describe("a stored thinking level the worker can't send", () => {
    it("is recorded with the reason", () => {
        expect(
            unsentThinkingOutcome(
                "openrouter/nobody/unknown-model",
                "high",
                undefined,
            ),
        ).toEqual({
            requested: "high",
            sent: false,
            reason: "The model registry lists no thinking levels for openrouter/nobody/unknown-model, so no thinking setting was sent.",
        });
        expect(
            unsentThinkingOutcome(
                "openrouter/minimax/minimax-m3",
                "none",
                undefined,
            ),
        ).toEqual({
            requested: "none",
            sent: false,
            reason: 'openrouter/minimax/minimax-m3 takes thinking levels low, medium, high, not "none", so no thinking setting was sent.',
        });
    });

    it("is nothing when the level is sent or none was asked", () => {
        expect(
            unsentThinkingOutcome("openrouter/openai/gpt-6-luna", "low", "low"),
        ).toBeUndefined();
        expect(
            unsentThinkingOutcome("gpt-4o", undefined, undefined),
        ).toBeUndefined();
    });

    it("never replaces the outcome the call recorded", () => {
        const sent = { requested: "low" as const, sent: true, via: "x" };
        const unsent = { requested: "low" as const, sent: false, reason: "y" };
        expect(withThinkingOutcome({ thinking: sent }, unsent)).toEqual({
            thinking: sent,
        });
        expect(withThinkingOutcome({ costBasis: "reported" }, unsent)).toEqual({
            costBasis: "reported",
            thinking: unsent,
        });
        expect(withThinkingOutcome(undefined, undefined)).toBeUndefined();
    });
});
