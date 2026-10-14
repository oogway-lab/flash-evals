import { describe, expect, it } from "vitest";
import { parseSilenceDetect } from "./ffmpeg";
import { planChunkSpans } from "./plan";

function expectContiguous(
    spans: Array<{ startMs: number; endMs: number }>,
    durationMs: number,
) {
    expect(spans[0]?.startMs).toBe(0);
    expect(spans.at(-1)?.endMs).toBe(durationMs);
    for (let i = 1; i < spans.length; i += 1)
        expect(spans[i]!.startMs).toBe(spans[i - 1]!.endMs);
}

describe("planChunkSpans", () => {
    it("keeps a recording within budget as one span", () => {
        expect(
            planChunkSpans({
                durationMs: 120_000,
                silences: [],
                maxChunkMs: 600_000,
            }),
        ).toEqual([{ index: 0, startMs: 0, endMs: 120_000, hardCut: false }]);
    });

    it("cuts at the latest silence before each target without gaps or overlap", () => {
        const spans = planChunkSpans({
            durationMs: 1_500_000,
            silences: [
                { startMs: 500_000, endMs: 501_000 },
                { startMs: 560_000, endMs: 562_000 },
                { startMs: 1_100_000, endMs: 1_100_800 },
            ],
            maxChunkMs: 600_000,
        });
        expect(spans.map((span) => [span.startMs, span.endMs])).toEqual([
            [0, 561_000],
            [561_000, 1_100_400],
            [1_100_400, 1_500_000],
        ]);
        expect(spans.every((span) => !span.hardCut)).toBe(true);
        expectContiguous(spans, 1_500_000);
    });

    it("falls back to a marked hard cut when no silence is near the target", () => {
        const spans = planChunkSpans({
            durationMs: 700_000,
            silences: [{ startMs: 100_000, endMs: 101_000 }],
            maxChunkMs: 600_000,
        });
        expect(spans[0]).toMatchObject({ endMs: 600_000, hardCut: true });
        expectContiguous(spans, 700_000);
    });

    it("never produces a span longer than the budget", () => {
        const silences = Array.from({ length: 200 }, (_, i) => ({
            startMs: i * 37_000,
            endMs: i * 37_000 + 500,
        }));
        const spans = planChunkSpans({
            durationMs: 7_200_000,
            silences,
            maxChunkMs: 600_000,
        });
        expect(
            spans.every((span) => span.endMs - span.startMs <= 600_000),
        ).toBe(true);
        expectContiguous(spans, 7_200_000);
    });
});

describe("parseSilenceDetect", () => {
    it("pairs silence start and end lines in milliseconds", () => {
        expect(
            parseSilenceDetect(
                [
                    "[silencedetect @ 0x1] silence_start: 12.5",
                    "[silencedetect @ 0x1] silence_end: 13.25 | silence_duration: 0.75",
                    "[silencedetect @ 0x1] silence_start: -0.01",
                    "[silencedetect @ 0x1] silence_end: 0.6 | silence_duration: 0.61",
                    "[silencedetect @ 0x1] silence_start: 40",
                ].join("\n"),
            ),
        ).toEqual([
            { startMs: 12_500, endMs: 13_250 },
            { startMs: 0, endMs: 600 },
        ]);
    });
});
