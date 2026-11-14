import {
    BENCHMARK_CONFIDENT_ITEMS,
    BENCHMARK_MIN_ITEMS,
    pickClosestReplacement,
    pipelineSetupLabel,
    sampleSizeFor,
    type BenchmarkModelVerdict,
    type IBenchmarkModelSummary,
    type ILeaderboardRow,
    type IPipelineComparison,
    type IRunConfigSnapshot,
    type IRunContext,
    type ISetupRanking,
    type ISetupRankingRow,
} from "@flash-evals/api-contract";
import type { IModelInfo } from "@/server/runs/modelInfo";
import {
    fmtPercent,
    fmtScore,
    formatCostColumn,
    plural,
    shortId,
} from "@/lib/format";
import { summarizeBestModel } from "./best-model";
import { goldenScoreLabel } from "./golden-score";
import { sttVariantDisplay } from "./stt-variant-display";

/** One model's results on the page, merged from the leaderboard and the comparison. */
export interface IModelResult {
    runModelId: string;
    modelId: string;
    /** Readable name; the raw ID when nothing better is known. */
    name: string;
    /** The run's reference model ("today's model") in a run of two or more. */
    isReference: boolean;
    /** Average cost of one call (one item), in USD. */
    costPerCall?: number;
    /** Cost against the reference model; paired by item on comparison runs. */
    relativeCost?: number;
    comparison?: IBenchmarkModelSummary;
    /** Field match with the stored answers, failed items counted as zero. */
    goldenScore?: number;
    judgeScore?: number;
    transcriptScore?: number;
    wer?: number;
    avgLatencyMs?: number;
    failedCells: number;
    cells: number;
    info?: IModelInfo;
    /** Hosting companies that served this model's answers, most first. */
    servedBy?: Array<{ host: string; answers: number }>;
    /** Thinking sent with this model's calls, and its tokens. */
    thinking?: IModelThinking;
    /** Temperature the run sent with this model's calls; absent: the provider's default. */
    temperature?: number;
    /** The run page this row's answers come from (comparison pages). */
    href?: string;
    /** Items scored, still waiting and failed (comparison pages). */
    progress?: { scored: number; waiting: number; failed: number };
    /** The ranking accuracy (see `setupAccuracy`). */
    accuracy?: number;
    /** No other setup is at least as accurate and costs no more. */
    notBeaten?: boolean;
}

function servedByFor(
    servedBy:
        Record<string, Array<{ host: string; answers: number }>> | undefined,
    runModelId: string,
): Pick<IModelResult, "servedBy"> {
    const hosts = servedBy?.[runModelId];
    return hosts ? { servedBy: hosts } : {};
}

function thinkingFor(
    thinking: Record<string, IModelThinking> | undefined,
    runModelId: string,
): Pick<IModelResult, "thinking"> {
    const entry = thinking?.[runModelId];
    return entry ? { thinking: entry } : {};
}

function temperatureFor(
    temperature: Readonly<Record<string, number>> | undefined,
    runModelId: string,
): Pick<IModelResult, "temperature"> {
    const value = temperature?.[runModelId];
    return value !== undefined ? { temperature: value } : {};
}

/** One model's thinking across its answers. */
export interface IModelThinking {
    /** The level the run asked for, when it asked for one. */
    level?: string;
    /** Answers whose call carried that level. */
    sent: number;
    /** Answers whose call could not carry it, with the first reason. */
    notSent: number;
    reason?: string;
    /** Thinking tokens over all answers that reported them. */
    tokens?: number;
}

/** Per run model, whether its thinking level was sent and how many thinking tokens it used. */
export function thinkingByModel(
    cells: ReadonlyArray<{
        runModelId: string;
        reasoningTokens?: number;
        thinking?: { requested: string; sent: boolean; reason?: string };
    }>,
): Record<string, IModelThinking> {
    const byModel: Record<string, IModelThinking> = {};
    for (const cell of cells) {
        if (!cell.thinking && cell.reasoningTokens === undefined) continue;
        const entry = (byModel[cell.runModelId] ??= { sent: 0, notSent: 0 });
        if (cell.reasoningTokens !== undefined)
            entry.tokens = (entry.tokens ?? 0) + cell.reasoningTokens;
        if (!cell.thinking) continue;
        entry.level ??= cell.thinking.requested;
        if (cell.thinking.sent) entry.sent += 1;
        else {
            entry.notSent += 1;
            entry.reason ??= cell.thinking.reason;
        }
    }
    return byModel;
}

/** Plain words for a model's thinking, e.g. "Thinking high · 1,200 thinking tokens". */
export function describeModelThinking(thinking: IModelThinking): {
    text: string;
    warning?: string;
} {
    const parts: string[] = [];
    if (thinking.level) parts.push(`Thinking ${thinking.level}`);
    if (thinking.tokens !== undefined)
        parts.push(
            `${thinking.tokens.toLocaleString("en-US")} thinking tokens`,
        );
    const warning =
        thinking.notSent > 0
            ? `Thinking ${thinking.level ?? ""} not sent on ${plural(thinking.notSent, "answer")}${thinking.reason ? `: ${thinking.reason}` : "."}`
            : undefined;
    return {
        text: parts.join(" · "),
        ...(warning ? { warning } : {}),
    };
}

/** Per run model, the temperature the run sent (models given one only). */
export function temperatureByModel(
    models: ReadonlyArray<{ id: string; temperature?: number }>,
): Record<string, number> {
    return Object.fromEntries(
        models.flatMap((model) =>
            model.temperature !== undefined
                ? [[model.id, model.temperature]]
                : [],
        ),
    );
}

/** Per run model, which hosting companies served its answers, most first. */
export function servedByModel(
    cells: ReadonlyArray<{ runModelId: string; servedBy?: string }>,
): Record<string, Array<{ host: string; answers: number }>> {
    const counts = new Map<string, Map<string, number>>();
    for (const cell of cells) {
        if (!cell.servedBy) continue;
        const hosts = counts.get(cell.runModelId) ?? new Map<string, number>();
        hosts.set(cell.servedBy, (hosts.get(cell.servedBy) ?? 0) + 1);
        counts.set(cell.runModelId, hosts);
    }
    return Object.fromEntries(
        [...counts].map(([runModelId, hosts]) => [
            runModelId,
            [...hosts]
                .map(([host, answers]) => ({ host, answers }))
                .sort((a, b) => b.answers - a.answers),
        ]),
    );
}

/** The readable name for a model: speech-to-text variant label, registry name, else the ID. */
export function modelDisplayName(
    modelId: string,
    snapshot: IRunConfigSnapshot,
    modelInfo: Record<string, IModelInfo>,
): string {
    return (
        sttVariantDisplay(snapshot, modelId)?.label ??
        modelInfo[modelId]?.label ??
        modelId
    );
}

function costPerCall(row: ILeaderboardRow): number | undefined {
    return row.projectedCostPer1k === undefined
        ? undefined
        : row.projectedCostPer1k / 1000;
}

/**
 * Every model in the run, cheapest per call first (models without a cost
 * last). A reference model only counts as one when the run has two or more
 * models: a single model has nothing to be compared with.
 */
export function buildModelResults(input: {
    leaderboard: ILeaderboardRow[];
    comparison?: IBenchmarkModelSummary[];
    snapshot: IRunConfigSnapshot;
    modelInfo: Record<string, IModelInfo>;
    servedBy?: Record<string, Array<{ host: string; answers: number }>>;
    thinking?: Record<string, IModelThinking>;
    /** Per run model, the temperature the run sent. */
    temperature?: Readonly<Record<string, number>>;
}): IModelResult[] {
    const { leaderboard, comparison, snapshot, modelInfo } = input;
    const hasReference = leaderboard.length > 1;
    const reference = hasReference
        ? leaderboard.find((row) => row.isReference)
        : undefined;
    const referenceCost = reference ? costPerCall(reference) : undefined;
    const results = leaderboard.map((row): IModelResult => {
        const summary = comparison?.find(
            (model) => model.runModelId === row.runModelId,
        );
        const cost = costPerCall(row);
        const isReference = row.runModelId === reference?.runModelId;
        const relativeCost = isReference
            ? undefined
            : summary
              ? summary.relativeCost
              : cost !== undefined &&
                  referenceCost !== undefined &&
                  referenceCost > 0
                ? cost / referenceCost
                : undefined;
        return {
            runModelId: row.runModelId,
            modelId: row.modelId,
            name: modelDisplayName(row.modelId, snapshot, modelInfo),
            isReference,
            ...(cost !== undefined ? { costPerCall: cost } : {}),
            ...(relativeCost !== undefined ? { relativeCost } : {}),
            ...(summary ? { comparison: summary } : {}),
            ...servedByFor(input.servedBy, row.runModelId),
            ...thinkingFor(input.thinking, row.runModelId),
            ...temperatureFor(input.temperature, row.runModelId),
            ...(row.avgFieldScore !== undefined
                ? { goldenScore: row.avgFieldScore }
                : {}),
            ...(row.avgJudgeScore !== undefined
                ? { judgeScore: row.avgJudgeScore }
                : {}),
            ...(row.avgTranscriptScore !== undefined
                ? { transcriptScore: row.avgTranscriptScore }
                : {}),
            ...(row.avgWer !== undefined ? { wer: row.avgWer } : {}),
            ...(row.avgLatencyMs !== undefined
                ? { avgLatencyMs: row.avgLatencyMs }
                : {}),
            failedCells: row.failedCells,
            cells: row.n,
            ...(modelInfo[row.modelId] ? { info: modelInfo[row.modelId] } : {}),
        };
    });
    return results.sort(byCost);
}

/**
 * A pipeline run compared with an eval run, as the eval run page's rows:
 * the eval run's reference (shown as "Reference", never judged) and the
 * pipeline as the one candidate, its cost per call being the cost of one
 * item (the sum of its steps). Cheapest first, as on eval runs.
 */
export function buildPipelineComparisonResults(input: {
    comparison: IPipelineComparison;
    pipelineName: string;
    /** The reference model's readable name; its ID when unknown. */
    referenceName?: string;
    referenceInfo?: IModelInfo;
}): IModelResult[] {
    const { comparison } = input;
    const results = comparison.summary.map((row): IModelResult => {
        if (row.runModelId === comparison.pipelineRunModelId)
            return {
                runModelId: row.runModelId,
                modelId: input.pipelineName,
                name: input.pipelineName,
                isReference: false,
                ...(comparison.pipelineCostPerItem !== undefined
                    ? { costPerCall: comparison.pipelineCostPerItem }
                    : {}),
                ...(row.relativeCost !== undefined
                    ? { relativeCost: row.relativeCost }
                    : {}),
                comparison: row,
                ...(comparison.pipelineLatencyMs !== undefined
                    ? { avgLatencyMs: comparison.pipelineLatencyMs }
                    : {}),
                failedCells: comparison.failedItems,
                cells: comparison.comparedItems,
            };
        return {
            runModelId: row.runModelId,
            modelId: row.modelId,
            name: input.referenceName ?? row.modelId,
            isReference: true,
            ...(comparison.referenceCostPerItem !== undefined
                ? { costPerCall: comparison.referenceCostPerItem }
                : {}),
            comparison: row,
            ...(comparison.referenceLatencyMs !== undefined
                ? { avgLatencyMs: comparison.referenceLatencyMs }
                : {}),
            failedCells: row.failedItems,
            cells: row.comparableItems,
            ...(input.referenceInfo ? { info: input.referenceInfo } : {}),
        };
    });
    return results.sort(byCost);
}

/**
 * A setup comparison's ranking as the run page's rows: the reference (shown
 * as "Reference", never judged), single models by their registry name and
 * pipelines named with their steps' models, each linking to its run.
 * Cheapest first, as on eval runs.
 */
export function buildSetupRankingResults(input: {
    ranking: ISetupRanking;
    modelInfo: Record<string, IModelInfo>;
    hrefFor: (row: ISetupRankingRow) => string;
}): IModelResult[] {
    const label = (modelId: string) =>
        input.modelInfo[modelId]?.label ?? modelId;
    return input.ranking.rows
        .map((row): IModelResult => {
            const pipeline = row.kind === "pipeline";
            const name = pipeline
                ? pipelineSetupLabel(
                      row.name,
                      (row.stepModels ?? []).map(label),
                  )
                : label(row.name);
            const relativeCost =
                row.kind === "reference"
                    ? undefined
                    : row.summary?.relativeCost;
            const info = pipeline ? undefined : input.modelInfo[row.name];
            return {
                runModelId: row.id,
                modelId: pipeline ? name : row.name,
                name,
                isReference: row.kind === "reference",
                ...(row.costPerCall !== undefined
                    ? { costPerCall: row.costPerCall }
                    : {}),
                ...(relativeCost !== undefined ? { relativeCost } : {}),
                ...(row.summary ? { comparison: row.summary } : {}),
                ...(row.latencyMs !== undefined
                    ? { avgLatencyMs: row.latencyMs }
                    : {}),
                // Failures count as misses on the compared items only.
                failedCells: row.comparedFailedItems,
                cells: input.ranking.comparedItems,
                ...(info ? { info } : {}),
                href: input.hrefFor(row),
                progress: {
                    scored: row.scoredItems,
                    waiting: row.waitingItems,
                    failed: row.failedItems,
                },
                ...(row.accuracy !== undefined
                    ? { accuracy: row.accuracy }
                    : {}),
                notBeaten: row.notBeaten,
            };
        })
        .sort(byCost);
}

/**
 * What the candidates are called in the answer: "model" or "pipeline" when
 * they are all one kind, "setup" when models and pipelines are mixed.
 */
export function candidateNoun(
    rows: ReadonlyArray<Pick<ISetupRankingRow, "kind">>,
): CandidateNoun {
    const kinds = new Set(
        rows.filter((row) => row.kind !== "reference").map((row) => row.kind),
    );
    if (kinds.size > 1) return "setup";
    return kinds.has("pipeline") ? "pipeline" : "model";
}

export type CandidateNoun = "model" | "pipeline" | "setup";

function byCost(a: IModelResult, b: IModelResult): number {
    const ac = a.costPerCall ?? Infinity;
    const bc = b.costPerCall ?? Infinity;
    if (ac !== bc) return ac < bc ? -1 : 1;
    return a.name.localeCompare(b.name);
}

/**
 * The page title: the question a run with a reference model answers, else
 * what ran on what.
 */
export function runHeading(input: {
    runId: string;
    results: IModelResult[];
    context?: IRunContext;
}): string {
    const reference = input.results.find((result) => result.isReference);
    if (reference) return `Cheaper than ${reference.name}?`;
    const prompt = input.context?.prompts[0]?.name;
    const dataset = input.context?.datasetName;
    if (prompt && dataset) return `${prompt} on ${dataset}`;
    return `Run ${shortId(input.runId)}`;
}

type MetricNames = Record<"judge" | "field" | "transcript", string>;

/** The field score is named per run: see `goldenScoreLabel`. */
function metricNames(fieldScoreName: string | undefined): MetricNames {
    return {
        judge: "judge score",
        field: fieldScoreName ?? goldenScoreLabel(undefined).scoreName,
        transcript: "transcript score",
    };
}

/** "a judge score", "an exact-match score". */
function withArticle(name: string): string {
    return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
}

export interface IRunAnswer {
    /** The one-sentence answer at the top of the page. */
    sentence: string;
    /** A note when the comparison rests on too few items. */
    sample?: { label: string; detail: string };
    /** Short supporting points, most important first. */
    reasons: string[];
    /** The model the answer is about: closest replacement or best model. */
    pick?: IModelResult;
    pickLabel: string;
    /** On comparison runs, the pick's verdict. */
    verdict?: BenchmarkModelVerdict;
    /** Under the pick's name, e.g. "3 of 5 tasks pass" or "Exact-match score 0.82". */
    pickDetail?: string;
    reference?: IModelResult;
}

/**
 * The plain-English answer for the top of the page, written only from the
 * run's own numbers. On a comparison run it follows the verdicts (the
 * closest replacement); otherwise it names the model with the best score,
 * with failed items counted as zero.
 */
export function describeRunAnswer(input: {
    results: IModelResult[];
    leaderboard: ILeaderboardRow[];
    comparison?: IBenchmarkModelSummary[];
    active: boolean;
    /** How the stored-answer field match is named in this run. */
    fieldScoreName?: string;
    /** What a candidate is called on a comparison; "model" by default. */
    noun?: CandidateNoun;
}): IRunAnswer {
    const answer = input.comparison
        ? comparisonAnswer(input.results, input.comparison, input.noun)
        : scoreAnswer(
              input.results,
              input.leaderboard,
              input.active,
              metricNames(input.fieldScoreName),
          );
    if (input.active)
        answer.reasons.unshift(
            "The run is still in progress, so these numbers will change.",
        );
    return answer;
}

function costClause(pick: IModelResult, prefix = ", at"): string {
    return pick.relativeCost === undefined
        ? ""
        : `${prefix} ${fmtPercent(pick.relativeCost)} of the cost`;
}

function comparisonAnswer(
    results: IModelResult[],
    comparison: IBenchmarkModelSummary[],
    noun: CandidateNoun = "model",
): IRunAnswer {
    const reference = results.find((result) => result.isReference);
    const closest = pickClosestReplacement(comparison, reference?.runModelId);
    const pick = closest
        ? results.find((result) => result.runModelId === closest.runModelId)
        : undefined;
    const base = {
        pickLabel: "Closest replacement",
        ...(reference ? { reference } : {}),
    };
    if (!closest?.assessment || !pick) {
        return {
            ...base,
            sentence: `No ${noun} has been compared yet.`,
            reasons: [],
        };
    }
    const verdict = closest.assessment.verdict;
    const R = reference?.name;
    const P = pick.name;
    let sentence: string;
    if (verdict === "pass")
        sentence = R
            ? `${P} can replace ${R}${costClause(pick, " at")}.`
            : `${P} meets every target.`;
    else if (verdict === "inconclusive")
        sentence = R
            ? `Too few items to tell whether ${withArticle(noun)} can replace ${R}. ${P} is the closest so far${costClause(pick)}.`
            : `Too few items to tell whether ${withArticle(noun)} meets the targets. ${P} is the closest so far.`;
    else
        sentence = R
            ? `No ${noun} can replace ${R} yet. ${P} is the closest${costClause(pick)}.`
            : `No ${noun} meets every target yet. ${P} is the closest.`;

    const reasons = comparisonReasons(
        P,
        noun,
        closest,
        comparison.filter(
            (model) =>
                model.assessment &&
                !model.isBenchmark &&
                model.runModelId !== reference?.runModelId,
        ),
    );

    const tasks = closest.tasks;
    const passing = tasks.filter(
        (task) => task.assessment.verdict === "pass",
    ).length;
    return {
        ...base,
        sentence,
        ...sampleNote(closest.comparableItems),
        reasons,
        pick,
        verdict,
        ...(tasks.length > 0
            ? {
                  pickDetail: `${passing} of ${plural(tasks.length, "task")} pass`,
              }
            : {}),
    };
}

/** The supporting points under a comparison run's answer. */
function comparisonReasons(
    name: string,
    noun: CandidateNoun,
    closest: IBenchmarkModelSummary,
    candidates: IBenchmarkModelSummary[],
): string[] {
    const reasons =
        closest.tasks.length > 0
            ? taskReasons(name, noun, closest, candidates)
            : [...(closest.assessment?.reasons ?? []).slice(0, 4)];
    if (closest.assessment?.verdict === "pass" && reasons.length === 0)
        reasons.push("Meets every target with enough items to be confident.");
    const failing = candidates.filter(
        (model) => model.assessment?.verdict === "fail",
    ).length;
    if (failing > 0 && candidates.length > 1)
        reasons.push(
            `${failing} of ${plural(candidates.length, noun)} miss at least one target.`,
        );
    return reasons;
}

/**
 * Short plain sentences about the closest replacement's tasks: where it
 * falls short, its strongest task, and the task most models get wrong. The
 * full reasons with ranges stay in the model's expanded row.
 */
function taskReasons(
    name: string,
    noun: CandidateNoun,
    closest: IBenchmarkModelSummary,
    candidates: IBenchmarkModelSummary[],
): string[] {
    const reasons: string[] = [];
    const tasks = closest.tasks;
    const below = tasks.filter((task) => task.assessment.verdict === "fail");
    const open = tasks.filter(
        (task) =>
            task.assessment.verdict === "uncertain" ||
            task.assessment.verdict === "insufficient",
    );
    if (below.length > 0)
        reasons.push(
            `${name} is below target on ${listNames(below.map((task) => task.name))}.`,
        );
    else if (open.length > 0)
        reasons.push(
            `${name} isn't clearly below target on any task, but ${
                open.length === tasks.length
                    ? "every task"
                    : `${open.length} of ${tasks.length} tasks`
            } could still go either way.`,
        );
    const scored = tasks.filter((task) => task.assessment.value !== undefined);
    const strongest = scored.reduce<(typeof scored)[number] | undefined>(
        (best, task) =>
            !best || task.assessment.value! > best.assessment.value!
                ? task
                : best,
        undefined,
    );
    if (strongest && tasks.length > 1)
        reasons.push(
            `Strongest: ${strongest.name} (${fmtPercent(strongest.assessment.value)}).`,
        );
    if (closest.failedItems > 0)
        reasons.push(
            `${name} failed ${plural(closest.failedItems, "item")}; they count as misses.`,
        );
    const weak = weakestTask(candidates);
    if (weak)
        reasons.push(
            `${weak.name} is the weak spot: ${weak.count} of ${plural(candidates.length, noun)} are below target.`,
        );
    return reasons;
}

/** The task the most candidates fall below target on, if at least half do. */
function weakestTask(
    candidates: IBenchmarkModelSummary[],
): { name: string; count: number } | undefined {
    const counts = new Map<string, { name: string; count: number }>();
    for (const model of candidates)
        for (const task of model.tasks)
            if (task.assessment.verdict === "fail") {
                const entry = counts.get(task.key) ?? {
                    name: task.name,
                    count: 0,
                };
                entry.count++;
                counts.set(task.key, entry);
            }
    const worst = [...counts.values()].sort((a, b) => b.count - a.count)[0];
    return worst && worst.count > 1 && worst.count * 2 >= candidates.length
        ? worst
        : undefined;
}

function listNames(names: string[]): string {
    if (names.length <= 1) return names.join("");
    return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function sampleNote(items: number): Pick<IRunAnswer, "sample"> {
    const size = sampleSizeFor(items);
    if (size === "insufficient")
        return {
            sample: {
                label: "Too few items for a verdict",
                detail: `${plural(items, "item")} compared. A verdict needs at least ${BENCHMARK_MIN_ITEMS}.`,
            },
        };
    if (size === "uncertain")
        return {
            sample: {
                label: "Small sample",
                detail: `${plural(items, "item")} compared. Results on fewer than ${BENCHMARK_CONFIDENT_ITEMS} items are uncertain.`,
            },
        };
    return {};
}

function scoreOf(
    result: IModelResult,
    metric: "judge" | "field" | "transcript",
): number | undefined {
    return metric === "judge"
        ? result.judgeScore
        : metric === "transcript"
          ? result.transcriptScore
          : result.goldenScore;
}

type IBestModel = NonNullable<ReturnType<typeof summarizeBestModel>>;

function noScoreSentence(results: IModelResult[], active: boolean): string {
    if (active) return "Scores appear as cells finish.";
    const cheapest = results.find((result) => result.costPerCall !== undefined);
    const cost =
        cheapest && results.length > 1
            ? ` ${cheapest.name} costs least, at ${formatCostColumn([cheapest.costPerCall])(cheapest.costPerCall)} per call.`
            : "";
    return `No scores were recorded for this run.${cost}`;
}

/** ", at 5% of Big Model's cost", or nothing when it is not known. */
function referenceCostClause(
    pick: IModelResult,
    reference: IModelResult | undefined,
): string {
    return reference && !pick.isReference && pick.relativeCost !== undefined
        ? `, at ${fmtPercent(pick.relativeCost)} of ${reference.name}'s cost`
        : "";
}

function scoreSentence(
    results: IModelResult[],
    best: IBestModel,
    top: IModelResult[],
    reference: IModelResult | undefined,
    names: MetricNames,
): string {
    const metric = names[best.metric];
    const shown = fmtScore(best.score);
    const pick = top[0]!;
    if (best.tied)
        return `${plural(top.length, "model")} tie on ${metric} (${shown}). ${pick.name} is the cheapest of them${referenceCostClause(pick, reference)}.`;
    if (results.length < 2)
        return `${pick.name} has ${withArticle(metric)} of ${shown}.`;
    const sentence = `${pick.name} has the highest ${metric} (${shown})${referenceCostClause(pick, reference)}.`;
    if (!pick.isReference) return sentence;
    const cheaper = results.find(
        (result) =>
            !result.isReference &&
            result.relativeCost !== undefined &&
            result.relativeCost < 1 &&
            scoreOf(result, best.metric) !== undefined,
    );
    return cheaper
        ? `${sentence} The cheapest model, ${cheaper.name}, scores ${fmtScore(
              scoreOf(cheaper, best.metric),
          )} at ${fmtPercent(cheaper.relativeCost)} of the cost.`
        : sentence;
}

function scoreReasons(
    results: IModelResult[],
    best: IBestModel,
    names: MetricNames,
): string[] {
    const metric = names[best.metric];
    const reasons: string[] = [];
    if (best.scored < results.length)
        reasons.push(
            `Only ${best.scored} of ${plural(results.length, "model")} have ${withArticle(metric)}.`,
        );
    if (best.metric === "transcript") return reasons;
    for (const result of results)
        if (result.failedCells > 0)
            reasons.push(
                `${result.name} failed ${result.failedCells} of ${plural(result.cells, "item")}; failed items count as zero.`,
            );
    return reasons;
}

function scoreAnswer(
    results: IModelResult[],
    leaderboard: ILeaderboardRow[],
    active: boolean,
    names: MetricNames,
): IRunAnswer {
    const reference = results.find((result) => result.isReference);
    const base = {
        pickLabel:
            results.length < 2
                ? "Model"
                : active
                  ? "Leading model"
                  : "Best model",
        ...(reference ? { reference } : {}),
    };
    const best = summarizeBestModel(leaderboard);
    if (!best)
        return {
            ...base,
            sentence: noScoreSentence(results, active),
            reasons: [],
        };
    // Several models can share the top score as displayed; the cheapest of
    // them (results are sorted by cost) is the one worth naming.
    const top = results.filter((result) =>
        best.modelIds.includes(result.modelId),
    );
    const pick = top[0]!;
    const score = scoreOf(pick, best.metric);
    return {
        ...base,
        sentence: scoreSentence(results, best, top, reference, names),
        reasons: scoreReasons(results, best, names),
        pick,
        ...(score !== undefined
            ? {
                  pickDetail: `${capitalize(names[best.metric])} ${fmtScore(score)}`,
              }
            : {}),
    };
}

function capitalize(text: string): string {
    return text[0]!.toUpperCase() + text.slice(1);
}

/**
 * Projected monthly saving from switching the reference model's calls to
 * `pick`: the difference in average cost per call times the calls. Negative
 * when `pick` costs more. Undefined when either cost is unknown.
 */
export function monthlySaving(
    reference: IModelResult | undefined,
    pick: IModelResult | undefined,
    callsPerMonth: number,
): number | undefined {
    if (
        !reference ||
        !pick ||
        pick.isReference ||
        reference.costPerCall === undefined ||
        pick.costPerCall === undefined
    )
        return undefined;
    return (reference.costPerCall - pick.costPerCall) * callsPerMonth;
}
