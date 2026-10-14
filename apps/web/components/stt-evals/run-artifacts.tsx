"use client";

import { useState } from "react";
import type { IWorkflowRunDetailResponse } from "@mosaic/api-contract";
import { MISSING_VALUE } from "@/lib/format";
import type { toTranscriptMetricDetails } from "@/components/runs/types";
import { formatTranscriptPercent } from "@/components/runs/transcript-score-details";

// STT metric scores (WER-style fractions) read to three places.
export const STT_SCORE_DIGITS = 3;

export function isAudioItem(item: IWorkflowRunDetailResponse["items"][number]) {
    return (
        Boolean(item.storageKey) &&
        (item.type === "audio" || item.mimeType?.startsWith("audio/") === true)
    );
}

/** Use the existing authenticated media route; do not fetch audio until playback. */
export function AudioRecording({
    item,
    compact = false,
}: {
    item: IWorkflowRunDetailResponse["items"][number];
    /** Row-height player for the item list. */
    compact?: boolean;
}) {
    const [failed, setFailed] = useState(false);
    if (!isAudioItem(item) || !item.storageKey) return null;
    const src = `/api/images/${item.storageKey.split("/").map(encodeURIComponent).join("/")}`;
    return (
        <>
            <audio
                controls
                preload="none"
                src={src}
                aria-label={`Original recording ${item.id.slice(0, 8)}`}
                className={
                    compact ? "h-8 w-full max-w-72" : "w-full min-w-52 max-w-sm"
                }
                onError={() => setFailed(true)}
                onPlaying={() => setFailed(false)}
                onPlay={(event) => {
                    for (const player of document.querySelectorAll("audio"))
                        if (player !== event.currentTarget) player.pause();
                }}
            />
            {failed && (
                <span
                    role="alert"
                    className="block text-copy-14 text-destructive"
                >
                    Audio could not be loaded.{" "}
                    <a href={src} className="underline underline-offset-4">
                        Open original recording
                    </a>
                    .
                </span>
            )}
        </>
    );
}

export function cellOutput(
    cell: IWorkflowRunDetailResponse["cells"][number],
): string | undefined {
    const segments = transcriptSegments(cell);
    if (segments.length > 0) {
        return segments
            .map(
                (segment) =>
                    `${speakerLabel(segment.speaker)} ${formatTimeRange(segment)}: ${segment.text}`,
            )
            .join(" ");
    }
    return cell.outputJson?.text || cell.error || undefined;
}

export type TranscriptSegment = NonNullable<
    NonNullable<
        IWorkflowRunDetailResponse["cells"][number]["outputJson"]
    >["segments"]
>[number];

export function transcriptSegments(
    cell: IWorkflowRunDetailResponse["cells"][number],
): TranscriptSegment[] {
    const segments = cell.outputJson?.segments;
    return Array.isArray(segments)
        ? segments.filter(
              (segment): segment is TranscriptSegment =>
                  typeof segment === "object" &&
                  segment !== null &&
                  typeof segment.text === "string" &&
                  segment.text.trim().length > 0,
          )
        : [];
}

export function speakerLabel(speaker: string | undefined): string {
    return speaker ? `Speaker ${speaker}` : `Speaker ${MISSING_VALUE}`;
}

export function formatTimeRange(segment: TranscriptSegment): string {
    const start = formatMilliseconds(segment.startMs);
    const end = formatMilliseconds(segment.endMs);
    return start || end
        ? `${start ?? MISSING_VALUE}–${end ?? MISSING_VALUE}`
        : MISSING_VALUE;
}

function formatMilliseconds(value: number | undefined): string | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? `${(value / 1000).toFixed(2)}s`
        : undefined;
}

export function InlineRates({
    details,
}: {
    details: ReturnType<typeof toTranscriptMetricDetails>;
}) {
    return (
        <span className="text-label-12 text-muted-foreground">
            WER {details ? formatTranscriptPercent(details.wer) : MISSING_VALUE}{" "}
            / CER{" "}
            {details ? formatTranscriptPercent(details.cer) : MISSING_VALUE}
        </span>
    );
}
