import type { IRunConfigSnapshot } from "@flash-evals/api-contract";

/** How the field-by-field match with the stored answers is named in a run. */
export interface IGoldenScoreLabel {
    /** Column, axis and heading text. */
    label: string;
    /** In a sentence: "has the highest exact-match score". */
    scoreName: string;
    /** On a score pill. */
    pill: string;
    /** One line on what it measures. */
    explanation: string;
}

const EXACT: IGoldenScoreLabel = {
    label: "Exact match, all stored fields",
    scoreName: "exact-match score",
    pill: "exact match",
    explanation:
        "Share of the stored answer's fields the output matches exactly. Every stored field counts and no match settings apply, so lists and wording rarely match. Failed items count as zero.",
};

const CONFIGURED: IGoldenScoreLabel = {
    label: "Stored answer match",
    scoreName: "stored-answer match score",
    pill: "stored match",
    explanation:
        "Share of the stored answer's fields the output matches, using the run's field match settings. Failed items count as zero.",
};

/**
 * The field-by-field score against the stored answers. A run saved with an
 * empty list of field match settings (the run form sends none) compares
 * every stored field exactly, so it is named for what it is. Otherwise the
 * run's, its pipeline's or the dataset's settings apply.
 */
export function goldenScoreLabel(
    snapshot: IRunConfigSnapshot | undefined,
): IGoldenScoreLabel {
    const configs = snapshot?.fieldConfigs;
    return Array.isArray(configs) && configs.length === 0 ? EXACT : CONFIGURED;
}
