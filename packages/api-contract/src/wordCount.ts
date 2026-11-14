/**
 * Word counting for `word_count` rule checks. Shared by the scorer and the
 * UI so a count shown on screen is the count that was scored.
 */

/** Zero-width space and byte-order mark: invisible word breaks. */
const ZERO_WIDTH_BREAKS = /[\u200B\uFEFF]/gu;
/**
 * A bare list number such as "1." or "2)". The first word of a line (after
 * any bullet) is taken as one; later on the line, only the next number in
 * the same style is ("1) a 2) b 3) c"), so "1. We sold 50." keeps "50.".
 */
const LIST_MARKER = /^(\p{Nd}{1,2})([.)])$/u;

/**
 * Words in a field's value: runs of non-whitespace, so punctuation sticks to
 * its word and any script that separates words with spaces (Hindi included)
 * counts the same way. Only runs with a letter or digit count, so bullets
 * and dashes ("-", "•", "—") are not words, nor is a bare list number
 * ("1.", "2)") that starts a line or continues its numbering inline
 * ("1) a 2) b", ASCII digits only); "2026" is, and so is "50."
 * mid-sentence. "99. Wow" at a line start drops the 99 (accepted).
 * Zero-width spaces separate words. (Zero-width joiners stay:
 * they sit inside Indic words.) A string is counted as is; a list of strings
 * is counted as one text (one item per line). Anything else (a
 * missing field, null, a number, an object, a list holding non-text) has no
 * word count and returns undefined.
 */
export function countWords(value: unknown): number | undefined {
    if (typeof value === "string")
        return value
            .replace(ZERO_WIDTH_BREAKS, " ")
            .split(/\r?\n/u)
            .reduce((total, line) => total + lineWords(line), 0);
    if (Array.isArray(value) && value.every((item) => typeof item === "string"))
        return countWords(value.join("\n"));
    return undefined;
}

function lineWords(line: string): number {
    let words = 0;
    let atLineStart = true;
    // The last list number taken on this line, e.g. "1)".
    let marker: { number: number; style: string } | undefined;
    for (const token of line.match(/\S+/gu) ?? []) {
        if (!/[\p{L}\p{N}]/u.test(token)) continue;
        const listNumber = LIST_MARKER.exec(token);
        const value = listNumber ? Number(listNumber[1]) : Number.NaN;
        const isMarker =
            listNumber !== null &&
            (atLineStart ||
                (marker?.style === listNumber[2] &&
                    marker.number + 1 === value));
        if (isMarker) marker = { number: value, style: listNumber[2]! };
        else words++;
        atLineStart = false;
    }
    return words;
}

/** "75–100", "at least 75" or "at most 100"; "" when neither is set. */
export function wordLimitText(min?: number, max?: number): string {
    if (min !== undefined && max !== undefined)
        return min === max ? `exactly ${min}` : `${min}–${max}`;
    if (min !== undefined) return `at least ${min}`;
    if (max !== undefined) return `at most ${max}`;
    return "";
}

/** "$.meta.summary" → "meta.summary", for messages people read. */
function fieldName(path: string): string {
    return path.replace(/^\$\.?/, "") || path;
}

/**
 * Why one field breaks a word limit, e.g. "summary: 68 words (needs
 * 75–100)", or undefined when it is within the limit. `words` undefined
 * means the field is missing or not text, which breaks the rule too.
 */
export function wordCountProblem(
    path: string,
    value: unknown,
    min?: number,
    max?: number,
): string | undefined {
    const words = countWords(value);
    const needs = `needs ${wordLimitText(min, max)} words`;
    if (words === undefined)
        return value === undefined || value === null
            ? `${fieldName(path)}: missing (${needs})`
            : `${fieldName(path)}: not text (${needs})`;
    if (
        (min !== undefined && words < min) ||
        (max !== undefined && words > max)
    )
        return `${fieldName(path)}: ${words} ${words === 1 ? "word" : "words"} (${needs})`;
    return undefined;
}
