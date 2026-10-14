export interface ISilenceInterval {
    startMs: number;
    endMs: number;
}

export interface IChunkSpan {
    index: number;
    startMs: number;
    endMs: number;
    /** True when no silence was found near the target and the cut is mid-audio. */
    hardCut: boolean;
}

/**
 * Split a recording into ordered, non-overlapping spans no longer than
 * `maxChunkMs`. Each cut is placed at the middle of the latest silence that
 * starts within `searchWindowMs` before the target, so words are not split.
 * Spans never overlap, so boundary speech is neither duplicated nor dropped
 * when a silence is available.
 */
export function planChunkSpans(input: {
    durationMs: number;
    silences: ISilenceInterval[];
    maxChunkMs: number;
    searchWindowMs?: number;
}): IChunkSpan[] {
    const { durationMs, maxChunkMs } = input;
    if (!(maxChunkMs > 0)) throw new Error("maxChunkMs must be positive.");
    const searchWindowMs = Math.min(
        input.searchWindowMs ?? 90_000,
        Math.floor(maxChunkMs / 2),
    );
    const silences = [...input.silences].sort((a, b) => a.startMs - b.startMs);
    const spans: IChunkSpan[] = [];
    let cursor = 0;
    while (durationMs - cursor > maxChunkMs) {
        const target = cursor + maxChunkMs;
        const windowStart = target - searchWindowMs;
        let cut: number | undefined;
        for (const silence of silences) {
            const mid = Math.round((silence.startMs + silence.endMs) / 2);
            if (mid > windowStart && mid <= target) cut = mid;
        }
        spans.push({
            index: spans.length,
            startMs: cursor,
            endMs: cut ?? target,
            hardCut: cut === undefined,
        });
        cursor = cut ?? target;
    }
    spans.push({
        index: spans.length,
        startMs: cursor,
        endMs: durationMs,
        hardCut: false,
    });
    return spans;
}
