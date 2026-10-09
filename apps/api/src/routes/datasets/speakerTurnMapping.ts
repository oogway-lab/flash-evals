type SpeakerTurn = Record<string, unknown>;

export function isSpeakerTurnTranscript(
    value: unknown,
): value is SpeakerTurn[] {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((turn) =>
            isRecord(turn)
                ? Boolean(turnText(turn)) && hasValidOptionalSpeaker(turn)
                : false,
        )
    );
}

export function normalizeSpeakerTurns(
    value: unknown,
): SpeakerTurn[] | undefined {
    if (!isSpeakerTurnTranscript(value)) return undefined;
    const genericTimesAreSeconds = hasFractionalGenericTime(value);
    return value.map((record) => {
        const speaker = firstString(record, [
            "speaker",
            "speaker_label",
            "speaker_id",
        ]);
        const startMs = turnTimeMs(record, "start", genericTimesAreSeconds);
        const endMs = turnTimeMs(record, "end", genericTimesAreSeconds);
        return {
            speaker: speaker ?? "Speaker",
            text: turnText(record)!,
            ...(startMs !== undefined ? { startMs } : {}),
            ...(endMs !== undefined ? { endMs } : {}),
        };
    });
}

export function transcriptFromTurns(value: unknown): string | undefined {
    if (!isSpeakerTurnTranscript(value)) return undefined;
    return value.map((turn) => turnText(turn)).join(" ");
}

export function valueShape(value: unknown): string {
    if (Array.isArray(value)) {
        if (isSpeakerTurnTranscript(value)) {
            return "a speaker-turn transcript array";
        }
        return "an array";
    }
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (isRecord(value)) return "an object";
    return `a ${typeof value}`;
}

function hasValidOptionalSpeaker(turn: SpeakerTurn): boolean {
    const speaker = Object.entries(turn).find(([key]) =>
        ["speaker", "speakerlabel", "speakerid"].includes(
            normalizeFieldName(key),
        ),
    );
    return (
        speaker === undefined ||
        (typeof speaker[1] === "string" && Boolean(speaker[1].trim()))
    );
}

function turnText(turn: SpeakerTurn): string | undefined {
    return firstString(turn, ["text", "content"]);
}

function firstString(
    value: SpeakerTurn,
    aliases: string[],
): string | undefined {
    for (const alias of aliases) {
        const match = Object.entries(value).find(
            ([key]) => normalizeFieldName(key) === normalizeFieldName(alias),
        )?.[1];
        if (typeof match === "string" && match.trim()) return match.trim();
    }
    return undefined;
}

function turnTimeMs(
    turn: SpeakerTurn,
    boundary: "start" | "end",
    genericTimesAreSeconds: boolean,
): number | undefined {
    const milliseconds = numberAlias(turn, `${boundary}Ms`);
    if (milliseconds !== undefined) return milliseconds;
    if (!genericTimesAreSeconds) return undefined;
    const seconds = numberAlias(turn, boundary);
    if (seconds === undefined) return undefined;
    const converted = Math.round(seconds * 1_000);
    return Number.isFinite(converted) ? converted : undefined;
}

function hasFractionalGenericTime(turns: unknown[]): boolean {
    return turns.some(
        (turn) =>
            isRecord(turn) &&
            [numberAlias(turn, "start"), numberAlias(turn, "end")].some(
                (value) => value !== undefined && !Number.isInteger(value),
            ),
    );
}

function numberAlias(value: SpeakerTurn, alias: string): number | undefined {
    const match = Object.entries(value).find(
        ([key]) => normalizeFieldName(key) === normalizeFieldName(alias),
    )?.[1];
    return typeof match === "number" && Number.isFinite(match) && match >= 0
        ? match
        : undefined;
}

function normalizeFieldName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRecord(value: unknown): value is SpeakerTurn {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
