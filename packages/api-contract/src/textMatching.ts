import type { IBenchmarkTextMatching } from "./benchmark.js";

/**
 * Accents on Latin, Greek and Cyrillic letters. Marks on other scripts stay:
 * in Devanagari or Tamil a vowel sign or virama changes the word ("काम" is not
 * "कम").
 */
const ACCENTS_ON_EUROPEAN_LETTERS =
    /([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+/gu;

/**
 * Devanagari chandrabindu (ँ), which people often write as anusvara (ं):
 * "हाँ" and "हां" are the same word.
 */
const CHANDRABINDU = /\u0901/gu;

/**
 * Lowercase, drop accents, spaces and punctuation: "Parle-G" → "parleg";
 * chandrabindu matches anusvara.
 */
export function normalizeText(value: string): string {
    return value
        .normalize("NFKD")
        .replace(ACCENTS_ON_EUROPEAN_LETTERS, "$1")
        .replace(CHANDRABINDU, "\u0902")
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

/** Normalized edit similarity: 1 for equal strings, 0 for nothing shared. */
export function textSimilarity(a: string, b: string): number {
    const longest = Math.max(a.length, b.length);
    if (longest === 0) return 1;
    return 1 - levenshtein(a, b) / longest;
}

function levenshtein(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(
                previous[j]! + 1,
                current[j - 1]! + 1,
                previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        previous = current;
    }
    return previous[b.length]!;
}

/**
 * Rewrites the candidate's and benchmark's values for one field so that
 * spellings the task treats as equal become identical strings. Values that
 * are not strings or string lists pass through unchanged.
 */
export function canonicalizePair(
    candidate: unknown,
    benchmark: unknown,
    matching: IBenchmarkTextMatching | undefined,
): { candidate: unknown; benchmark: unknown } {
    const aliasOf = new Map<string, string>();
    for (const [name, spellings] of Object.entries(matching?.aliases ?? {})) {
        const canonical = normalizeText(name);
        aliasOf.set(canonical, canonical);
        for (const spelling of spellings)
            aliasOf.set(normalizeText(spelling), canonical);
    }
    const canonical = (value: string) => {
        const normalized = normalizeText(value);
        return aliasOf.get(normalized) ?? normalized;
    };
    const mapStrings = (value: unknown): unknown =>
        typeof value === "string"
            ? canonical(value)
            : Array.isArray(value) && value.every((v) => typeof v === "string")
              ? value.map((v) => canonical(v as string))
              : value;

    const benchmarkValue = mapStrings(benchmark);
    let candidateValue = mapStrings(candidate);
    const threshold = matching?.fuzzy;
    if (threshold !== undefined)
        candidateValue = snapToBenchmark(
            candidateValue,
            benchmarkValue,
            threshold,
        );
    return { candidate: candidateValue, benchmark: benchmarkValue };
}

/** Replace each candidate string with its closest unused benchmark string above the threshold. */
function snapToBenchmark(
    candidate: unknown,
    benchmark: unknown,
    threshold: number,
): unknown {
    const targets =
        typeof benchmark === "string"
            ? [benchmark]
            : Array.isArray(benchmark)
              ? benchmark.filter((v): v is string => typeof v === "string")
              : [];
    const unused = new Set(targets);
    const snap = (value: string): string => {
        if (unused.has(value)) {
            unused.delete(value);
            return value;
        }
        let best: string | undefined;
        let bestScore = threshold;
        for (const target of unused) {
            const score = textSimilarity(value, target);
            if (score >= bestScore) {
                best = target;
                bestScore = score;
            }
        }
        if (best === undefined) return value;
        unused.delete(best);
        return best;
    };
    if (typeof candidate === "string") return snap(candidate);
    if (
        Array.isArray(candidate) &&
        candidate.every((v) => typeof v === "string")
    ) {
        // Exact matches claim their targets first so a fuzzy match cannot steal them.
        const exact = candidate.map((v) =>
            unused.delete(v as string) ? v : undefined,
        );
        return candidate.map((v, i) => exact[i] ?? snap(v as string));
    }
    return candidate;
}
