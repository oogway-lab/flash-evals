import { describe, expect, it } from "vitest";
import {
    trackTranscriptionSpend,
    transcriptionSpend,
    type ITranscriptionSpend,
} from "./spend";

describe("trackTranscriptionSpend", () => {
    it("keeps the known spend when a later part's cost is unknown", async () => {
        const persisted: ITranscriptionSpend[] = [];
        const spend = trackTranscriptionSpend(
            { costUsd: 0, costSource: "computed" },
            async (checkpoint) => {
                persisted.push(checkpoint);
            },
        );
        await spend.record(0.02);
        // e.g. a transliteration whose price is not known.
        await spend.record(undefined);
        expect(spend.current).toEqual({
            costUsd: 0.02,
            costSource: "unavailable",
        });
        // Known parts after an unknown one still add up.
        await spend.record(0.01);
        expect(spend.current.costUsd).toBeCloseTo(0.03);
        expect(spend.current.costSource).toBe("unavailable");
        expect(persisted.at(-1)?.costSource).toBe("unavailable");
    });

    it("stays computed while every part is known", async () => {
        const spend = trackTranscriptionSpend(
            { costUsd: 0, costSource: "computed" },
            async () => undefined,
        );
        await spend.record(0.02);
        await spend.record(0);
        expect(spend.current).toEqual({
            costUsd: 0.02,
            costSource: "computed",
        });
    });
});

describe("transcriptionSpend", () => {
    it("resumes an incomplete checkpoint with its known spend", () => {
        expect(
            transcriptionSpend({ costUsd: 0.05, costSource: "unavailable" }),
        ).toEqual({ costUsd: 0.05, costSource: "unavailable" });
        expect(transcriptionSpend({ costSource: "unavailable" })).toEqual({
            costSource: "unavailable",
        });
        expect(transcriptionSpend(undefined, 0.01)).toEqual({
            costUsd: 0.01,
            costSource: "computed",
        });
    });
});
