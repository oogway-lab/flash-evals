import type {
    IRunSetupModelOption,
    ITaskMap,
    ProviderTransport,
} from "@flash-evals/api-contract";
import { modelOffers } from "./provider-select";

/**
 * Rough characters per token. Romanised Hindi and JSON split finely: a
 * pilot measured about 10,500 tokens for 28,700 characters (2.7).
 */
const CHARS_PER_TOKEN = 3;
/** Assumed answer length; the output limit only caps it. */
export const ASSUMED_OUTPUT_TOKENS = 1_000;
/** A judge reads the transcript, two answers and its instructions. */
const JUDGE_EXTRA_INPUT_TOKENS = 2 * ASSUMED_OUTPUT_TOKENS + 300;
const JUDGE_OUTPUT_TOKENS = 300;

export interface ICostLine {
    modelId: string;
    label: string;
    /** USD per call, or undefined when the provider lists no price. */
    perCall?: number;
    /** USD for all calls. */
    total?: number;
}

export interface IComparisonEstimate {
    items: number;
    inputTokens: number;
    outputTokens: number;
    lines: ICostLine[];
    /** One line per pipeline: every step on every item. */
    pipelineLines: ICostLine[];
    judge?: ICostLine & { calls: number };
    /** Sum of every priced line. */
    total: number;
    /** Some line has no price, so the total is a floor. */
    incomplete: boolean;
    /** Rough wall-clock minutes; see `estimateMinutes`. */
    minutes: number;
}

/** A saved pipeline, as the estimate prices it. */
export interface IPipelineEstimateInput {
    id: string;
    label: string;
    steps: Array<{
        modelId?: string;
        transport?: ProviderTransport;
        /** Length of the step's prompt. */
        promptChars?: number;
    }>;
}

/** Assumed time of one model call; real calls vary a lot. */
export const ASSUMED_SECONDS_PER_CALL = 8;
/** The worker's defaults: cells one eval run works on at once ... */
const EVAL_CALLS_AT_ONCE = 5;
/** ... and steps one pipeline run works on at once. */
const PIPELINE_CALLS_AT_ONCE = 4;

/**
 * Rough minutes until every answer is scored: the eval run and the
 * pipeline runs start together, each pipeline's steps run one after the
 * other per item, and the judge calls run after the answers (pipeline
 * answers wait for the eval run). Assumes `ASSUMED_SECONDS_PER_CALL` per
 * call and the worker's default concurrency; provider limits, long answers
 * and other runs make it longer.
 */
export function estimateMinutes(input: {
    items: number;
    models: number;
    pipelineSteps: number[];
    judgeCalls: number;
}): number {
    if (input.items === 0) return 0;
    const evalSeconds =
        Math.ceil((input.items * input.models) / EVAL_CALLS_AT_ONCE) *
        ASSUMED_SECONDS_PER_CALL;
    const pipelineSeconds = input.pipelineSteps.map(
        (steps) =>
            steps *
            Math.ceil(input.items / PIPELINE_CALLS_AT_ONCE) *
            ASSUMED_SECONDS_PER_CALL,
    );
    const judgeSeconds =
        Math.ceil(input.judgeCalls / EVAL_CALLS_AT_ONCE) *
        ASSUMED_SECONDS_PER_CALL;
    const seconds = Math.max(evalSeconds, ...pipelineSeconds) + judgeSeconds;
    return Math.max(1, Math.ceil(seconds / 60));
}

/** "about 1 minute", "about 25 minutes", "about 2 hours". */
export function fmtMinutes(minutes: number): string {
    if (minutes <= 1) return "about 1 minute";
    if (minutes < 90) return `about ${minutes} minutes`;
    return `about ${Math.round(minutes / 60)} hours`;
}

/** The first offer with a list price, for a step whose provider is a saved route. */
function anyPrice(model: IRunSetupModelOption | undefined) {
    const offer = modelOffers(model).find(
        (candidate) =>
            candidate.inputPerMillion !== undefined &&
            candidate.outputPerMillion !== undefined,
    );
    return offer
        ? { input: offer.inputPerMillion!, output: offer.outputPerMillion! }
        : undefined;
}

/**
 * The model a provider offers under `providerModelId`: a Bifrost step saves
 * Bifrost's own id (`openrouter/google/gemini-2.5-flash`), not the model's.
 */
function offeredUnder(
    models: readonly IRunSetupModelOption[],
    providerModelId: string,
): IRunSetupModelOption | undefined {
    return models.find((model) =>
        modelOffers(model).some((offer) => offer.modelId === providerModelId),
    );
}

/** The line id a pipeline's cost has in the estimate. */
export function pipelineLineId(pipelineId: string): string {
    return `pipeline:${pipelineId}`;
}

function priceFor(
    model: IRunSetupModelOption | undefined,
    transport: ProviderTransport | undefined,
) {
    const offer = modelOffers(model).find(
        (candidate) => candidate.transport === transport,
    );
    return offer?.inputPerMillion !== undefined &&
        offer.outputPerMillion !== undefined
        ? { input: offer.inputPerMillion, output: offer.outputPerMillion }
        : undefined;
}

function callCost(
    price: { input: number; output: number } | undefined,
    inputTokens: number,
    outputTokens: number,
): number | undefined {
    if (!price) return undefined;
    return (inputTokens * price.input + outputTokens * price.output) / 1e6;
}

/**
 * What a comparison will roughly cost, from list prices: the prompt plus an
 * average transcript in, an assumed answer out, for every model on every
 * item, plus one judge call per candidate, item and judged task (per
 * model, item and rubric task). A pipeline is priced as every step running
 * on every item, each reading its prompt plus an average transcript: an
 * upper bound when steps end the chain early or read shorter answers. An
 * estimate, never a quote.
 */
export function estimateComparison(input: {
    items: number;
    promptChars: number;
    avgInputChars: number;
    maxTokens: number;
    models: Array<{ id: string; transport?: ProviderTransport }>;
    referenceModelId: string;
    availableModels: IRunSetupModelOption[];
    taskMap: ITaskMap;
    judge?: { modelId: string; transport?: ProviderTransport };
    pipelines?: IPipelineEstimateInput[];
}): IComparisonEstimate {
    const inputTokens = Math.round(
        (input.promptChars + input.avgInputChars) / CHARS_PER_TOKEN,
    );
    const outputTokens = Math.min(ASSUMED_OUTPUT_TOKENS, input.maxTokens);
    const find = (id: string) =>
        input.availableModels.find((model) => model.id === id);
    const lines = input.models.map((entry): ICostLine => {
        const model = find(entry.id);
        const perCall = callCost(
            priceFor(model, entry.transport),
            inputTokens,
            outputTokens,
        );
        return {
            modelId: entry.id,
            label: model?.label ?? entry.id,
            ...(perCall !== undefined
                ? { perCall, total: perCall * input.items }
                : {}),
        };
    });
    const judgedTasks = input.taskMap.tasks.filter(
        (task) =>
            task.method === "head_to_head" ||
            (task.method === "agreement" && task.judgeDisagreements === true),
    ).length;
    const pipelines = input.pipelines ?? [];
    const pipelineLines = pipelines.map((pipeline): ICostLine => {
        const stepCosts = pipeline.steps.map((step) => {
            const model = step.modelId
                ? (find(step.modelId) ??
                  offeredUnder(input.availableModels, step.modelId))
                : undefined;
            return callCost(
                priceFor(model, step.transport) ?? anyPrice(model),
                Math.round(
                    ((step.promptChars ?? 0) + input.avgInputChars) /
                        CHARS_PER_TOKEN,
                ),
                outputTokens,
            );
        });
        const priced = stepCosts.every((cost) => cost !== undefined);
        const perCall = stepCosts.reduce<number>(
            (sum, cost) => sum + (cost ?? 0),
            0,
        );
        return {
            modelId: pipelineLineId(pipeline.id),
            label: pipeline.label,
            ...(priced && pipeline.steps.length > 0
                ? { perCall, total: perCall * input.items }
                : {}),
        };
    });
    const candidates =
        input.models.filter((entry) => entry.id !== input.referenceModelId)
            .length + pipelines.length;
    // A rubric scores every setup's answer, the reference's included.
    const rubricTasks = input.taskMap.tasks.filter(
        (task) => task.method === "rubric",
    ).length;
    const judgeCalls = input.judge
        ? (judgedTasks * candidates +
              rubricTasks * (input.models.length + pipelines.length)) *
          input.items
        : 0;
    const judgeModel = input.judge ? find(input.judge.modelId) : undefined;
    const judgePerCall =
        input.judge && judgeCalls > 0
            ? callCost(
                  priceFor(judgeModel, input.judge.transport),
                  Math.round(input.avgInputChars / CHARS_PER_TOKEN) +
                      JUDGE_EXTRA_INPUT_TOKENS,
                  JUDGE_OUTPUT_TOKENS,
              )
            : undefined;
    const judge =
        input.judge && judgeCalls > 0
            ? {
                  modelId: input.judge.modelId,
                  label: judgeModel?.label ?? input.judge.modelId,
                  calls: judgeCalls,
                  ...(judgePerCall !== undefined
                      ? {
                            perCall: judgePerCall,
                            total: judgePerCall * judgeCalls,
                        }
                      : {}),
              }
            : undefined;
    const priced = [...lines, ...pipelineLines, ...(judge ? [judge] : [])];
    return {
        items: input.items,
        inputTokens,
        outputTokens,
        lines,
        pipelineLines,
        ...(judge ? { judge } : {}),
        total: priced.reduce((sum, line) => sum + (line.total ?? 0), 0),
        incomplete: priced.some((line) => line.total === undefined),
        minutes: estimateMinutes({
            items: input.items,
            models: input.models.length,
            pipelineSteps: pipelines.map((pipeline) => pipeline.steps.length),
            judgeCalls,
        }),
    };
}

/** "$0.0017", "$1.25", "$40": small amounts keep two significant digits. */
export function fmtUsd(value: number): string {
    if (value === 0) return "$0";
    if (value < 0.01) return `$${Number(value.toPrecision(2))}`;
    if (value < 100) return `$${value.toFixed(2)}`;
    return `$${Math.round(value).toLocaleString("en-US")}`;
}
