import type {
    ICreateWorkflowRunRequest,
    IRunDataPolicy,
    IWorkflowLlmResolvedExecution,
    IWorkflowRunConfig,
} from "@flash-evals/api-contract";
import {
    bifrostRoutesViaOpenRouter,
    bifrostUpstream,
    DIRECT_MAKER_HOSTS,
    hasDataPolicy,
    isDirectMakerTransport,
    type DirectMakerTransport,
} from "@flash-evals/llm-core";
import { ApiBadRequestError } from "../errors.js";
import { TRANSPORT_LABELS_FOR_MESSAGES } from "../transportLabels.js";
import {
    validateDataPolicyHosts,
    validateRunMaxCost,
} from "./runs/creation.js";

export interface IWorkflowRunStepRoute {
    /** The step's name as shown on the canvas. */
    label: string;
    execution: IWorkflowLlmResolvedExecution;
}

/**
 * The spend limit and data rules a pipeline run is created with, checked
 * the way eval runs check theirs. Every model-backed step (and the judge
 * that scores it, which uses the same route) must follow the data rules:
 * Vercel AI Gateway and OpenRouter routes can, and so can a Bifrost route
 * whose model Bifrost forwards to OpenRouter; OpenAI routes and other
 * Bifrost models can't, and the run is refused rather than sending a call
 * the rules don't allow. An OpenRouter route pinned to exact hosts keeps its pin, so those
 * hosts must all be allowed. A direct Anthropic or Gemini API step is served
 * by the maker itself, so, as in eval runs, it may run only when the rules
 * are an allowed-host list that names the maker.
 */
export function workflowRunConfigFor(
    input: Pick<ICreateWorkflowRunRequest, "maxCostUsd" | "dataPolicy">,
    steps: IWorkflowRunStepRoute[],
): IWorkflowRunConfig {
    validateRunMaxCost(input);
    const dataPolicy = validWorkflowDataPolicy(input.dataPolicy, steps);
    return {
        ...(input.maxCostUsd !== undefined
            ? { maxCostUsd: input.maxCostUsd }
            : {}),
        ...(dataPolicy ? { dataPolicy } : {}),
    };
}

function validWorkflowDataPolicy(
    policy: IRunDataPolicy | undefined,
    steps: IWorkflowRunStepRoute[],
): IRunDataPolicy | undefined {
    if (policy === undefined || policy === null) return undefined;
    if (typeof policy !== "object" || Array.isArray(policy))
        throw new ApiBadRequestError("dataPolicy must be an object.");
    const hosts = validateDataPolicyHosts(policy);
    const normalized: IRunDataPolicy = {
        ...(hosts.length > 0 ? { onlyHosts: hosts } : {}),
        ...(policy.zeroDataRetention === true
            ? { zeroDataRetention: true }
            : {}),
        ...(policy.disallowPromptTraining === true
            ? { disallowPromptTraining: true }
            : {}),
    };
    if (!hasDataPolicy(normalized)) return undefined;
    for (const step of steps) {
        const transport = step.execution.route.transportConfig;
        if (transport.transport === "gateway") continue;
        if (transport.transport === "openrouter") {
            const pinned =
                transport.upstreamPolicy.mode === "exact"
                    ? transport.upstreamPolicy.only
                    : [];
            const outside = pinned.filter((host) => !hosts.includes(host));
            if (hosts.length > 0 && outside.length > 0)
                throw new ApiBadRequestError(
                    `dataPolicy: ${step.label} is pinned to OpenRouter host ${outside.map((host) => `"${host}"`).join(", ")}, which the allowed hosts don't include. Allow it or pick a route without that pin.`,
                );
            continue;
        }
        if (transport.transport === "bifrost") {
            assertBifrostFollows(
                step.label,
                step.execution.capability.transport.transportModelId,
            );
            continue;
        }
        if (isDirectMakerTransport(transport.transport)) {
            assertDirectMakerFollows(
                step.label,
                transport.transport,
                normalized,
            );
            continue;
        }
        throw new ApiBadRequestError(
            `dataPolicy: ${step.label} runs on ${TRANSPORT_LABELS_FOR_MESSAGES[transport.transport]} directly, which can't follow data rules. Pick a Vercel AI Gateway or OpenRouter route for it.`,
        );
    }
    return normalized;
}

/**
 * Bifrost can follow the rules only for a model it forwards to OpenRouter:
 * the step then sends OpenRouter's provider settings (allowed hosts with no
 * fallbacks, zero retention, no training) for Bifrost to pass on. Another
 * upstream (e.g. `gemini/…`) goes to that provider directly, which can't be
 * limited, so the run is refused.
 */
function assertBifrostFollows(label: string, transportModelId: string): void {
    if (bifrostRoutesViaOpenRouter(transportModelId)) return;
    const upstream = bifrostUpstream(transportModelId);
    throw new ApiBadRequestError(
        `dataPolicy: ${label} runs on Bifrost as "${transportModelId}", which Bifrost sends ${upstream ? `to ${upstream}` : "to its default provider"} rather than OpenRouter, so the data rules can't be passed on. Pick a Bifrost model ID that starts with "openrouter/", or a Vercel AI Gateway or OpenRouter route.`,
    );
}

/**
 * A direct Anthropic or Gemini API call is served by the maker itself: it
 * follows an allowed-host list that names the maker, but not retention or
 * training rules, which depend on the account's agreement with the maker.
 */
function assertDirectMakerFollows(
    label: string,
    transport: DirectMakerTransport,
    policy: IRunDataPolicy,
): void {
    const makerHosts = DIRECT_MAKER_HOSTS[transport];
    if (
        !policy.zeroDataRetention &&
        !policy.disallowPromptTraining &&
        (policy.onlyHosts ?? []).some((host) => makerHosts.includes(host))
    )
        return;
    throw new ApiBadRequestError(
        `dataPolicy: ${label} runs on ${TRANSPORT_LABELS_FOR_MESSAGES[transport]} directly, which can only follow an allowed-host list that includes "${makerHosts[0]}". Pick a Vercel AI Gateway or OpenRouter route to use the other rules.`,
    );
}
