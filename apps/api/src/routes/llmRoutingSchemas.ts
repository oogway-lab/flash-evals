import type {
    IClearWorkflowLlmProjectDefaultRequest,
    ICreateWorkflowLlmRouteForModelRequest,
    ICreateWorkflowLlmRouteVersionRequest,
    IDisableWorkflowLlmRouteRequest,
    IRefreshWorkflowLlmCapabilitiesRequest,
    ISetWorkflowLlmProjectDefaultRequest,
    IWorkflowLlmRouteCandidate,
    IWorkflowLlmRouteCandidatesResponse,
    IWorkflowLlmSelection,
} from "@mosaic/api-contract";
import { REASONING_EFFORT_LEVELS } from "@mosaic/llm-core";
import { z } from "zod";
import { ApiFieldValidationError } from "../errors.js";

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);

const generation = z
    .object({
        maxOutputTokens: z.number().int().min(1).max(1_000_000),
        temperature: z.number().min(0).max(2).optional(),
        topP: z.number().min(0).max(1).optional(),
        seed: z.number().int().optional(),
        reasoningEffort: z.enum(REASONING_EFFORT_LEVELS).optional(),
    })
    .strict();

const structuredOutput = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("text") }).strict(),
    z
        .object({
            mode: z.literal("json_schema"),
            schemaName: nonEmpty,
            schemaDigest: nonEmpty,
            strict: z.boolean(),
        })
        .strict(),
]);

const retry = z.discriminatedUnion("owner", [
    z
        .object({
            owner: z.literal("mosaic"),
            maxAttempts: z.number().int().min(1).max(10),
            timeoutMs: z.number().int().min(1).max(600_000),
            retryableErrorClasses: z
                .array(
                    z.enum([
                        "rate_limit",
                        "timeout",
                        "overloaded",
                        "upstream_unavailable",
                    ]),
                )
                .max(4),
        })
        .strict(),
    z
        .object({
            owner: z.literal("gateway"),
            timeoutMs: z.number().int().min(1).max(600_000),
        })
        .strict(),
]);

const upstreamPolicy = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("auto") }).strict(),
    z
        .object({
            mode: z.literal("preference"),
            order: z.array(nonEmpty).min(1),
            allowFallbacks: z.boolean(),
        })
        .strict(),
    z
        .object({
            mode: z.literal("exact"),
            only: z.array(nonEmpty).min(1),
        })
        .strict(),
]);

export const WorkflowLlmTransport = z.enum([
    "openai",
    "gateway",
    "openrouter",
    "bifrost",
]);

const transportConfig = z.discriminatedUnion("transport", [
    z.object({ transport: z.literal("openai") }).strict(),
    z
        .object({
            transport: z.literal("gateway"),
            upstreamPolicy: z
                .object({ mode: z.literal("gateway_auto") })
                .strict(),
            modelFallback: z.literal("disabled"),
        })
        .strict(),
    z
        .object({
            transport: z.literal("openrouter"),
            upstreamPolicy,
            requireParameters: z.boolean(),
            responseCache: z.enum(["allow", "disable"]),
        })
        .strict(),
    z
        .object({
            transport: z.literal("bifrost"),
            upstreamPolicy: z
                .object({ mode: z.literal("bifrost_default") })
                .strict(),
        })
        .strict(),
]);

export const WorkflowLlmRouteConfig = z
    .object({
        transportConfig,
        modelId: nonEmpty,
        generation,
        structuredOutput,
        retry,
        cache: z
            .object({
                mosaicReuse: z.enum(["allow", "force_fresh"]),
                providerCaching: z.literal("allow"),
            })
            .strict(),
    })
    .strict();

const createRouteVersion = z
    .object({
        projectId: uuid,
        routeId: uuid.optional(),
        name: z.string().trim().min(1).max(120),
        config: WorkflowLlmRouteConfig,
    })
    .strict();

const routeCandidateSupport = z
    .object({
        upstreamRoutingModes: z.array(
            z.enum(["none", "auto", "preference", "exact"]),
        ),
        supportedGenerationControls: z.array(
            z.enum([
                "maxOutputTokens",
                "temperature",
                "topP",
                "seed",
                "reasoningEffort",
            ]),
        ),
        supportsStructuredOutput: z.boolean(),
    })
    .strict();

export const WorkflowLlmRouteCandidate = z
    .object({
        transport: WorkflowLlmTransport,
        modelId: nonEmpty,
        label: nonEmpty,
        modelProvider: nonEmpty,
        modelProviderLabel: nonEmpty,
        source: z.literal("provider_model_listing"),
        availability: z.literal("provider_listed_candidate"),
        requiresMutationDiscovery: z.literal(true),
        support: routeCandidateSupport,
    })
    .strict();

export const WorkflowLlmRouteCandidatesResponse = z
    .object({
        transport: WorkflowLlmTransport,
        coverage: z.literal("provider_model_listing"),
        candidates: z.array(WorkflowLlmRouteCandidate),
    })
    .strict();

const refreshCapabilities = z
    .object({
        teamId: uuid,
        projectId: uuid,
        transport: WorkflowLlmTransport,
        providerKeyId: uuid,
        refreshedBy: uuid,
    })
    .strict();

const disableRoute = z
    .object({
        teamId: uuid,
        projectId: uuid,
        routeId: uuid,
        disabledBy: uuid,
    })
    .strict();

const setDefault = z
    .object({
        teamId: uuid,
        projectId: uuid,
        routeVersionId: uuid,
        updatedBy: uuid,
    })
    .strict();

const clearDefault = z
    .object({
        teamId: uuid,
        projectId: uuid,
        updatedBy: uuid,
    })
    .strict();

export const WorkflowLlmSelection = z.discriminatedUnion("mode", [
    z
        .object({
            mode: z.literal("simple"),
            transport: z.enum(["openai", "gateway", "openrouter", "bifrost"]),
        })
        .strict(),
    z.object({ mode: z.literal("project_default") }).strict(),
    z
        .object({
            mode: z.literal("pinned_route"),
            routeVersionId: uuid,
        })
        .strict(),
]);

export function parseCreateWorkflowLlmRouteVersionRequest(
    input: unknown,
): ICreateWorkflowLlmRouteVersionRequest {
    return parse(createRouteVersion, input);
}

export function parseCreateWorkflowLlmRouteForModelRequest(
    input: unknown,
): ICreateWorkflowLlmRouteForModelRequest {
    return parse(createRouteVersion, input);
}

export function parseWorkflowLlmRouteCandidate(
    input: unknown,
): IWorkflowLlmRouteCandidate {
    return parse(WorkflowLlmRouteCandidate, input);
}

export function parseWorkflowLlmRouteCandidatesResponse(
    input: unknown,
): IWorkflowLlmRouteCandidatesResponse {
    return parse(WorkflowLlmRouteCandidatesResponse, input);
}

export function parseRefreshWorkflowLlmCapabilitiesRequest(
    input: unknown,
): IRefreshWorkflowLlmCapabilitiesRequest {
    return parse(refreshCapabilities, input);
}

export function parseDisableWorkflowLlmRouteRequest(
    input: unknown,
): IDisableWorkflowLlmRouteRequest {
    return parse(disableRoute, input);
}

export function parseSetWorkflowLlmProjectDefaultRequest(
    input: unknown,
): ISetWorkflowLlmProjectDefaultRequest {
    return parse(setDefault, input);
}

export function parseClearWorkflowLlmProjectDefaultRequest(
    input: unknown,
): IClearWorkflowLlmProjectDefaultRequest {
    return parse(clearDefault, input);
}

export function parseWorkflowLlmSelection(
    input: unknown,
): IWorkflowLlmSelection {
    return parse(WorkflowLlmSelection, input);
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (result.success) return result.data;
    const issue = result.error.issues[0];
    const unknownKey =
        issue?.code === "unrecognized_keys" ? issue.keys[0] : undefined;
    const path =
        [...(issue?.path ?? []), ...(unknownKey ? [unknownKey] : [])].join(
            ".",
        ) || "body";
    throw new ApiFieldValidationError(
        `Invalid LLM routing field ${path}: ${issue?.message ?? "invalid value"}.`,
        path,
        "Use only documented routing fields and values supported by the selected capability version.",
    );
}
