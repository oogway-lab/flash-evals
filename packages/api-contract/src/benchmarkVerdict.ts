/**
 * Statistics and a pass / conditional / fail verdict for a benchmark
 * comparison. Each task is judged on one rate:
 *
 * - judged tasks (head-to-head, or agreement with `judgeDisagreements`): the
 *   share of items the candidate won or tied, with a Wilson interval;
 * - other agreement tasks: mean field agreement, with a Wilson interval on
 *   the total (the widest a 0-to-1 score's spread could be; a t interval
 *   shrinks to a point when scores are nearly equal: 5 of 5 is not
 *   certainty). This is deliberately conservative: when scores sit between
 *   0 and 1 the true spread is smaller, so the interval is wider than it
 *   needs to be and a task can read "uncertain" where a tighter method
 *   would pass. Even a perfect score passes a 0.9 minimum only from about
 *   35 items (the Wilson lower bound for n of n).
 *
 * A task passes only when the whole 95% interval clears the threshold and
 * fails when the whole interval is below it; otherwise it is uncertain. Too
 * few items is "insufficient", never a pass: a comparison that measured
 * nothing is unknown, not equivalent.
 *
 * With `maxDropBelowReference`, a task whose reference model was scored on
 * the same items (e.g. both against stored answers) is judged on the paired
 * per-item difference from the reference instead: the candidate passes when
 * the whole interval of (candidate - reference) stays above
 * -maxDropBelowReference. Matching or beating the reference passes only on
 * enough items: n exact ties still leave an interval of plus or minus
 * 3.84 / (n + 3.84) (5 ties cannot rule out a 2-point drop; 400 can). For a
 * judged task each item scores 1 (won or tied) or 0 (lost), so the target is
 * the reference's own won-or-tied rate minus the allowed drop. The interval
 * combines Wilson intervals on the candidate's per-item gains and losses,
 * allowing for their correlation (they come from the same items), so exact
 * ties on every item still leave the most the two could differ on
 * unseen items (the Wilson upper bound for no disagreement in n items), not a
 * point. Every interval here only moves down when an item gets worse, so a
 * worse result can never get a better verdict. Without a reference score (the
 * reference is the yardstick) the fixed minimums apply.
 */

export type BenchmarkSampleSize = "insufficient" | "uncertain" | "sufficient";
/**
 * "reference": the reference model's own result on a task. It is shown for
 * comparison but never judged: it is what the candidates are measured against.
 */
export type BenchmarkTaskVerdict =
    "pass" | "uncertain" | "fail" | "insufficient" | "reference";
export type BenchmarkModelVerdict =
    "pass" | "conditional" | "fail" | "inconclusive";

/** Fewer items than this is "insufficient": no verdict is drawn. */
export const BENCHMARK_MIN_ITEMS = 5;
/** Fewer items than this can still pass, but is flagged "uncertain". */
export const BENCHMARK_CONFIDENT_ITEMS = 20;

export interface IBenchmarkTaskThreshold {
    /** Minimum mean agreement (0 to 1) for unjudged agreement tasks. */
    minAgreement?: number;
    /** Minimum share of items won or tied (0 to 1) for judged tasks. */
    minWinOrTieRate?: number;
    /**
     * Most a task may fall below the reference model, as a 0 to 1 rate
     * (0.02 = 2 points), on tasks where the reference is scored too.
     * Replaces `minAgreement` and `minWinOrTieRate` there; other tasks keep
     * their fixed targets.
     */
    maxDropBelowReference?: number;
}

/** Limits a candidate must meet to be recommended. */
export interface IBenchmarkPolicy extends IBenchmarkTaskThreshold {
    /** Per-task overrides, keyed by task key. */
    tasks?: Record<string, IBenchmarkTaskThreshold>;
    /** Highest acceptable cost relative to the benchmark, e.g. 0.4. */
    maxRelativeCost?: number;
}

/** Used when a run sets no policy. Proposed defaults, not client limits. */
export const DEFAULT_BENCHMARK_POLICY: Required<
    Pick<IBenchmarkTaskThreshold, "minAgreement" | "minWinOrTieRate">
> = {
    minAgreement: 0.9,
    minWinOrTieRate: 0.9,
};

export interface IRateInterval {
    low: number;
    high: number;
}

/** How a candidate compares with the reference model on the same items. */
export interface IReferenceComparison {
    /** The reference model's own rate (agreement, or won or tied) on the paired items. */
    value: number;
    /** Mean of (candidate - reference) per item; positive means better. */
    difference: number;
    /** 95% interval of that difference. */
    interval?: IRateInterval;
    /** Items both were scored on. */
    items: number;
    /** The allowed drop below the reference, 0 to 1. */
    maxDrop: number;
}

export interface IBenchmarkTaskAssessment {
    /** Which rate the verdict used. */
    metric: "agreement" | "winOrTieRate";
    value?: number;
    interval?: IRateInterval;
    threshold: number;
    /** Set when the verdict compared the candidate with the reference model. */
    reference?: IReferenceComparison;
    sampleSize: BenchmarkSampleSize;
    verdict: BenchmarkTaskVerdict;
}

export interface IBenchmarkModelAssessment {
    verdict: BenchmarkModelVerdict;
    /** Plain-language reasons, most serious first. */
    reasons: string[];
}

const T_95 = [
    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
    2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08,
    2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];
const Z_95 = 1.96;

function tCritical(degreesOfFreedom: number): number {
    if (degreesOfFreedom <= 30) return T_95[degreesOfFreedom - 1]!;
    if (degreesOfFreedom <= 60) return 2.0;
    if (degreesOfFreedom <= 120) return 1.98;
    return Z_95;
}

/**
 * 95% t interval for a mean, clamped to [0, 1] for 0-to-1 scores; pass
 * `lowest = -1` for differences between two such scores.
 */
export function meanInterval(
    values: number[],
    lowest = 0,
): IRateInterval | undefined {
    const n = values.length;
    if (n < 2) return undefined;
    const mean = values.reduce((total, value) => total + value, 0) / n;
    const variance =
        values.reduce((total, value) => total + (value - mean) ** 2, 0) /
        (n - 1);
    const half = tCritical(n - 1) * Math.sqrt(variance / n);
    return {
        low: Math.max(lowest, mean - half),
        high: Math.min(1, mean + half),
    };
}

/** 95% Wilson interval for a proportion. */
export function wilsonInterval(
    successes: number,
    n: number,
): IRateInterval | undefined {
    if (n === 0) return undefined;
    const p = successes / n;
    const z2 = Z_95 * Z_95;
    const denominator = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denominator;
    const half =
        (Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
    return {
        low: Math.max(0, center - half),
        high: Math.min(1, center + half),
    };
}

/**
 * 95% interval for mean agreement (0-to-1 scores): a Wilson interval on the
 * total, as if each item were a 0-or-1 success. A 0-to-1 score varies at most
 * as much as a 0-or-1 one with the same mean, so this is the widest the
 * spread could be. It depends only on the total and the count, so lowering
 * any one score can never raise either end. A t interval is not used: it
 * shrinks to a point when scores are nearly equal (20 items at 1.0 and one at
 * 0.99 would pass where 20 at 1.0 do not), and a lower score can narrow it.
 */
export function agreementInterval(values: number[]): IRateInterval | undefined {
    return wilsonInterval(
        values.reduce((total, value) => total + value, 0),
        values.length,
    );
}

/**
 * 95% interval for the mean per-item difference between two 0-to-1 scores.
 * The difference is split into what the candidate gained and what it lost
 * per item (each 0 to 1, as a share of n), each gets a Wilson interval, and
 * the two are combined by squaring their distances from the estimates
 * (Newcombe's square-and-add, as in his method 10 for paired proportions).
 * Gains and losses come from the same items and never both happen on one
 * item, so they are negatively correlated: the per-item covariance is
 * exactly -gain * loss. The combination adds that back through the
 * correlation sqrt(gain * loss / ((1 - gain)(1 - loss))) (Zou and Donner's
 * MOVER with correlation); treating them as independent covered only about
 * 87% when both happen often.
 * Exact ties add to neither, so n ties gives plus or minus the Wilson upper
 * bound for no disagreement in n items. Making any one item worse lowers the
 * gains or raises the losses, and neither can raise either end (a t interval
 * could: 99 ties and one small loss gave a near-point interval and passed).
 */
export function differenceInterval(
    differences: number[],
): IRateInterval | undefined {
    const n = differences.length;
    if (n === 0) return undefined;
    let gained = 0;
    let lost = 0;
    for (const value of differences) {
        if (value > 0) gained += value;
        else lost -= value;
    }
    const gain = gained / n;
    const loss = lost / n;
    const gains = wilsonInterval(gained, n)!;
    const losses = wilsonInterval(lost, n)!;
    const correlation = gainLossCorrelation(gain, loss);
    const spread = (gainSide: number, lossSide: number) =>
        Math.sqrt(
            gainSide * gainSide +
                lossSide * lossSide +
                2 * correlation * gainSide * lossSide,
        );
    return {
        low: Math.max(
            -1,
            gain - loss - spread(gain - gains.low, losses.high - loss),
        ),
        high: Math.min(
            1,
            gain - loss + spread(gains.high - gain, loss - losses.low),
        ),
    };
}

/**
 * Minus the correlation between the gain share and the loss share of the
 * same items: sqrt(g * l / ((1 - g)(1 - l))), at most 1 since g + l <= 1.
 * For 0-to-1 scores the covariance is still exactly -g * l / n, and the
 * Wilson distances stand in for each side's widest spread, so the cross term
 * comes out at that covariance.
 */
function gainLossCorrelation(gain: number, loss: number): number {
    if (gain <= 0 || loss <= 0) return 0;
    return Math.min(1, Math.sqrt((gain * loss) / ((1 - gain) * (1 - loss))));
}

export function sampleSizeFor(n: number): BenchmarkSampleSize {
    if (n < BENCHMARK_MIN_ITEMS) return "insufficient";
    if (n < BENCHMARK_CONFIDENT_ITEMS) return "uncertain";
    return "sufficient";
}

export function assessTask(input: {
    key: string;
    judged: boolean;
    n: number;
    value?: number;
    interval?: IRateInterval;
    policy?: IBenchmarkPolicy;
    /** Per item: candidate score and the reference model's, same items. */
    referencePairs?: Array<[number, number]>;
}): IBenchmarkTaskAssessment {
    const override = input.policy?.tasks?.[input.key];
    const maxDrop =
        override?.maxDropBelowReference ?? input.policy?.maxDropBelowReference;
    if (
        maxDrop !== undefined &&
        input.referencePairs &&
        input.referencePairs.length > 0
    )
        return assessAgainstReference(input, input.referencePairs, maxDrop);
    const threshold = input.judged
        ? (override?.minWinOrTieRate ??
          input.policy?.minWinOrTieRate ??
          DEFAULT_BENCHMARK_POLICY.minWinOrTieRate)
        : (override?.minAgreement ??
          input.policy?.minAgreement ??
          DEFAULT_BENCHMARK_POLICY.minAgreement);
    const sampleSize = sampleSizeFor(input.n);
    let verdict: BenchmarkTaskVerdict;
    if (sampleSize === "insufficient" || input.value === undefined)
        verdict = "insufficient";
    else {
        // A single value or zero variance gives a point interval.
        const interval = input.interval ?? {
            low: input.value,
            high: input.value,
        };
        verdict =
            interval.low >= threshold
                ? "pass"
                : interval.high < threshold
                  ? "fail"
                  : "uncertain";
    }
    return {
        metric: input.judged ? "winOrTieRate" : "agreement",
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.interval ? { interval: input.interval } : {}),
        threshold,
        sampleSize,
        verdict,
    };
}

/** The paired-difference verdict: pass unless the candidate is clearly
 * more than `maxDrop` below the reference. */
function assessAgainstReference(
    input: {
        judged: boolean;
        value?: number;
        interval?: IRateInterval;
        n: number;
    },
    pairs: Array<[number, number]>,
    maxDrop: number,
): IBenchmarkTaskAssessment {
    const differences = pairs.map(
        ([candidate, reference]) => candidate - reference,
    );
    const difference = mean(differences);
    const reference = mean(pairs.map(([, value]) => value));
    const measured = differenceInterval(differences);
    const interval = measured ?? { low: difference, high: difference };
    const sampleSize = sampleSizeFor(pairs.length);
    const verdict: BenchmarkTaskVerdict =
        sampleSize === "insufficient"
            ? "insufficient"
            : interval.low >= -maxDrop
              ? "pass"
              : interval.high < -maxDrop
                ? "fail"
                : "uncertain";
    return {
        metric: input.judged ? "winOrTieRate" : "agreement",
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.interval ? { interval: input.interval } : {}),
        threshold: Math.max(0, reference - maxDrop),
        reference: {
            value: reference,
            difference,
            ...(measured ? { interval } : {}),
            items: pairs.length,
            maxDrop,
        },
        sampleSize,
        verdict,
    };
}

function mean(values: number[]): number {
    return values.reduce((total, value) => total + value, 0) / values.length;
}

export function assessModel(input: {
    tasks: Array<{ name: string; assessment: IBenchmarkTaskAssessment }>;
    relativeCost?: number;
    failedItems: number;
    policy?: IBenchmarkPolicy;
}): IBenchmarkModelAssessment {
    const failures: string[] = [];
    const doubts: string[] = [];
    for (const { name, assessment } of input.tasks) {
        const label =
            assessment.metric === "agreement" ? "agreement" : "won or tied";
        const shown =
            assessment.value === undefined
                ? "no data"
                : `${percent(assessment.value)}${
                      assessment.interval
                          ? ` (95% CI ${percent(assessment.interval.low)}–${percent(assessment.interval.high)})`
                          : ""
                  }`;
        const target = `target ${percent(assessment.threshold)}`;
        if (assessment.reference) {
            const line = referenceLine(
                name,
                assessment.reference,
                assessment.metric,
            );
            if (assessment.verdict === "fail")
                failures.push(`${line}, more than the allowed drop.`);
            else if (assessment.verdict === "uncertain")
                doubts.push(
                    `${line}; could be either side of the allowed drop.`,
                );
            else if (assessment.verdict === "insufficient")
                doubts.push(
                    `${name}: fewer than ${BENCHMARK_MIN_ITEMS} items compared, so no verdict.`,
                );
            else if (assessment.sampleSize === "uncertain")
                doubts.push(
                    `${name}: passes, but on fewer than ${BENCHMARK_CONFIDENT_ITEMS} items.`,
                );
            continue;
        }
        if (assessment.verdict === "fail")
            failures.push(`${name}: ${label} ${shown}, below ${target}.`);
        else if (assessment.verdict === "uncertain")
            doubts.push(
                `${name}: ${label} ${shown} could be either side of ${target}.`,
            );
        else if (assessment.verdict === "insufficient")
            doubts.push(
                `${name}: fewer than ${BENCHMARK_MIN_ITEMS} items compared, so no verdict.`,
            );
        else if (assessment.sampleSize === "uncertain")
            doubts.push(
                `${name}: passes, but on fewer than ${BENCHMARK_CONFIDENT_ITEMS} items.`,
            );
    }
    const maxCost = input.policy?.maxRelativeCost;
    if (
        maxCost !== undefined &&
        input.relativeCost !== undefined &&
        input.relativeCost > maxCost
    )
        failures.push(
            `Cost is ${percent(input.relativeCost)} of the benchmark's, above the ${percent(maxCost)} limit.`,
        );
    else if (maxCost !== undefined && input.relativeCost === undefined)
        doubts.push("Cost could not be compared with the benchmark.");
    if (input.failedItems > 0)
        doubts.push(
            `Failed on ${input.failedItems} item${input.failedItems === 1 ? "" : "s"} (counted as losses).`,
        );

    const allInsufficient =
        input.tasks.length > 0 &&
        input.tasks.every(
            ({ assessment }) => assessment.verdict === "insufficient",
        );
    const verdict: BenchmarkModelVerdict =
        failures.length > 0
            ? "fail"
            : allInsufficient
              ? "inconclusive"
              : doubts.length > 0
                ? "conditional"
                : "pass";
    return { verdict, reasons: [...failures, ...doubts] };
}

/**
 * "Sales: -2.0 points against the reference's 95% (allowed drop 2 points,
 * failed answers count as 0,
 * 95% CI -4.1 to +0.2)"; judged tasks say "won or tied" first.
 */
function referenceLine(
    name: string,
    reference: IReferenceComparison,
    metric: IBenchmarkTaskAssessment["metric"],
): string {
    const ci = reference.interval
        ? `, 95% CI ${points(reference.interval.low)} to ${points(reference.interval.high)}`
        : "";
    const rate = metric === "winOrTieRate" ? "won or tied " : "";
    return `${name}: ${rate}${points(reference.difference)} against the reference's ${percent(reference.value)} (allowed drop ${Math.round(reference.maxDrop * 1000) / 10} points, failed answers count as 0${ci})`;
}

/** "+3.0 points", "-1.5 points". */
export function points(rate: number): string {
    const value = Math.round(rate * 1000) / 10;
    return `${value > 0 ? "+" : ""}${value.toFixed(1)} points`;
}

function percent(value: number): string {
    return `${Math.round(value * 1000) / 10}%`;
}
