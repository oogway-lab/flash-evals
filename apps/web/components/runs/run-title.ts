import { shortId } from "@/lib/format";

export const RUN_TITLE_MAX_LENGTH = 80;

/**
 * The run's name: the first non-empty line of its note, without leading
 * Markdown heading or list markers, cut to `RUN_TITLE_MAX_LENGTH`.
 */
export function runNoteTitle(body: string | undefined): string | undefined {
    const firstLine = body
        ?.split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:#{1,6}\s+|[-*]\s+)/, "").trim())
        .find((line) => line.length > 0);
    if (!firstLine) return undefined;
    return firstLine.length > RUN_TITLE_MAX_LENGTH
        ? `${firstLine.slice(0, RUN_TITLE_MAX_LENGTH - 1).trimEnd()}…`
        : firstLine;
}

/** The note title, or "Run <short id>" when the run has no note. */
export function runTitle(runId: string, noteBody?: string): string {
    return runNoteTitle(noteBody) ?? `Run ${shortId(runId)}`;
}
