/**
 * Splitting a long transcript into pieces for transliteration, and checking
 * that a piece came back whole.
 *
 * A model asked to transliterate a long transcript in one call can stop early
 * and still report a normal finish (no cut-off, no output limit reached), so
 * text is silently dropped. Pieces of bounded size keep each call short, and a
 * word-count check catches a piece that came back with words missing.
 */

/** Largest piece sent in one call. */
export const TRANSLITERATION_PIECE_CHARS = 1_200;
/** Largest piece when an incomplete piece is tried again in smaller parts. */
export const TRANSLITERATION_RETRY_PIECE_CHARS = 500;

export interface ITranscriptPiece {
    /** The piece's text, trimmed. */
    text: string;
    /** The whitespace that followed the piece in the source ("" for the last). */
    separator: string;
}

/**
 * Splits `text` into pieces of at most `maxChars` characters (trimmed), at
 * line breaks first, then sentence ends, then spaces. A single word longer
 * than `maxChars` is cut where it must be. Joining the pieces with
 * `joinTranscriptPieces` gives back the source's layout.
 */
export function splitTranscriptIntoPieces(
    text: string,
    maxChars: number,
): ITranscriptPiece[] {
    const limit = Math.max(1, Math.floor(maxChars));
    const units = boundedUnits(text, limit);
    const pieces: string[] = [];
    let current = "";
    for (const unit of units) {
        if (current && (current + unit).trim().length > limit) {
            pieces.push(current);
            current = "";
        }
        current += unit;
    }
    if (current) pieces.push(current);
    return pieces
        .map((piece) => ({
            text: piece.trim(),
            separator: trailingWhitespace(piece),
        }))
        .filter((piece) => piece.text.length > 0)
        .map((piece, index, all) => ({
            ...piece,
            separator: index === all.length - 1 ? "" : piece.separator,
        }));
}

/** Rejoins transliterated pieces with the line breaks the source had. */
export function joinTranscriptPieces(
    pieces: Array<{ text: string; separator: string }>,
): string {
    return pieces
        .map(
            (piece) =>
                piece.text +
                (piece.separator.includes("\n")
                    ? piece.separator.replace(/[^\n]/g, "")
                    : piece.separator
                      ? " "
                      : ""),
        )
        .join("")
        .trim();
}

/** Words that carry a letter or digit; lone punctuation does not count. */
export function transcriptWordCount(text: string): number {
    return text.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word))
        .length;
}

/**
 * Transliteration keeps words one for one (a Devanagari word becomes one
 * Latin word), so the reply's word count stays close to the source's. A reply
 * well short of it dropped text; one far above it ran away (repeated itself).
 */
const MIN_WORD_RATIO = 0.75;
const MAX_WORD_RATIO = 1.5;
/** Slack for short pieces, where one word is a large share. */
const WORD_SLACK = 2;

export function transliterationLooksComplete(
    source: string,
    transliterated: string,
): boolean {
    const sourceWords = transcriptWordCount(source);
    if (sourceWords === 0) return true;
    const outputWords = transcriptWordCount(transliterated);
    return (
        outputWords >= Math.floor(sourceWords * MIN_WORD_RATIO) - WORD_SLACK &&
        outputWords <= Math.ceil(sourceWords * MAX_WORD_RATIO) + WORD_SLACK
    );
}

/** Units no longer than `limit`, each keeping the whitespace after it. */
function boundedUnits(text: string, limit: number): string[] {
    return splitKeepingWhitespace(text, /\n+/gu).flatMap((line) =>
        line.trim().length <= limit
            ? [line]
            : splitKeepingWhitespace(line, /(?<=[।॥.?!])\s+/gu).flatMap(
                  (sentence) =>
                      sentence.trim().length <= limit
                          ? [sentence]
                          : splitKeepingWhitespace(sentence, /\s+/gu).flatMap(
                                (word) => hardCut(word, limit),
                            ),
              ),
    );
}

/** Splits after each separator match, keeping the separator on the left. */
function splitKeepingWhitespace(text: string, separator: RegExp): string[] {
    const parts: string[] = [];
    let start = 0;
    for (const match of text.matchAll(separator)) {
        const end = (match.index ?? 0) + match[0].length;
        if (end > start) parts.push(text.slice(start, end));
        start = end;
    }
    if (start < text.length) parts.push(text.slice(start));
    return parts;
}

function hardCut(word: string, limit: number): string[] {
    if (word.trim().length <= limit) return [word];
    const characters = [...word];
    const parts: string[] = [];
    for (let index = 0; index < characters.length; index += limit) {
        parts.push(characters.slice(index, index + limit).join(""));
    }
    return parts;
}

function trailingWhitespace(text: string): string {
    return /\s*$/u.exec(text)?.[0] ?? "";
}
