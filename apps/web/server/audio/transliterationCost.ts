import type { ITransliterationResult } from "./transliteration";

/**
 * Cost of an STT cell whose transcript was transliterated: the transcript's
 * cost plus the transliteration's (as stored on the variant, like the
 * transcript's own cost, also on a cache hit). Unknown when either part is
 * unknown, so a reused variant whose cost was never known stays visible as
 * "unavailable" rather than showing the transcript's cost as complete.
 */
export function sttCellCostWithTransliteration(
    transcript:
        | { costUsd?: number; costSource?: "computed" | "unavailable" }
        | undefined,
    transliteration: Pick<ITransliterationResult, "costUsd"> | undefined,
): { costUsd?: number; costSource?: "computed" | "unavailable" } {
    if (!transliteration)
        return {
            ...(transcript?.costUsd !== undefined
                ? { costUsd: transcript.costUsd }
                : {}),
            ...(transcript?.costSource
                ? { costSource: transcript.costSource }
                : {}),
        };
    if (
        transcript?.costUsd === undefined ||
        transliteration.costUsd === undefined
    )
        return { costSource: "unavailable" };
    return {
        costUsd: transcript.costUsd + transliteration.costUsd,
        costSource: "computed",
    };
}
