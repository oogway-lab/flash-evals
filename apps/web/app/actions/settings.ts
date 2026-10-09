"use server";

import { revalidatePath } from "next/cache";
import {
    isProviderKeyProvider,
    MosaicApiError,
    type IWorkflowLlmRouteCandidatesResponse,
    type IWorkflowLlmRouteConfig,
    type IWorkflowLlmRoute,
    type ISttRouteProbeResponse,
    type ProviderKeyProvider,
    type ReasoningEffort,
    type WorkflowLlmTransport,
} from "@mosaic/api-contract";
import { REASONING_EFFORT_LEVELS } from "@mosaic/llm-core";
import { serverApiClient } from "@/server/api/client";
import { requirePrincipal } from "@/server/auth/session";
import { requireActiveProject } from "@/server/projects/activeProject";
import { clientErrorMessage, UserFacingError } from "@/server/lib/errors";

export interface IProviderKeyActionState {
    ok?: boolean;
    message?: string;
    error?: string;
    resetKey?: number;
}

export interface ISttRouteProbeActionState {
    result?: ISttRouteProbeResponse;
    error?: string;
}

export interface IWorkflowLlmRoutingActionState {
    ok?: boolean;
    message?: string;
    error?: string;
    remediation?: string;
}

export interface ICreateWorkflowLlmRouteForNodeInput {
    transport: WorkflowLlmTransport;
    modelId: string;
    name: string;
    generation?: {
        maxOutputTokens: number;
        temperature?: number;
        topP?: number;
        seed?: number;
        reasoningEffort?: ReasoningEffort;
    };
    timeoutMs?: number;
    maxAttempts?: number;
    mosaicReuse?: "allow" | "force_fresh";
    reasoningEffort?: ReasoningEffort;
}

export interface ICreateWorkflowLlmRouteForNodeResult {
    route?: IWorkflowLlmRoute;
    error?: string;
}

export interface IWorkflowLlmCandidatesActionState {
    result?: IWorkflowLlmRouteCandidatesResponse;
    error?: string;
}

/**
 * Create a workflow route from a provider/model choice without exposing
 * provider-key or capability UUIDs to the canvas client.
 */
export async function createWorkflowLlmRouteForNode(
    input: ICreateWorkflowLlmRouteForNodeInput,
): Promise<ICreateWorkflowLlmRouteForNodeResult> {
    const principal = await requireActiveProject();
    try {
        const api = serverApiClient();
        const route = await api.createWorkflowLlmRouteVersion(
            {
                projectId: principal.projectId,
                name: input.name,
                config: routeConfigForNode(input),
            },
            { teamId: principal.teamId, actorId: principal.userId },
        );
        revalidatePath(`/multiworkflow`);
        return { route };
    } catch (error) {
        return { error: clientErrorMessage(error) };
    }
}

export async function createSttRouteProbeAction(
    _state: ISttRouteProbeActionState,
    formData: FormData,
): Promise<ISttRouteProbeActionState> {
    const principal = await requirePrincipal();
    const projectId = String(formData.get("projectId") ?? "");
    const modelId = String(formData.get("modelId") ?? "");
    if (!projectId || !modelId)
        return { error: "Route probe details are missing." };
    try {
        const result = await serverApiClient().createSttRouteProbe({
            teamId: principal.teamId,
            projectId,
            modelId,
            probedBy: principal.userId,
        });
        revalidateProviderSetupPaths();
        return { result };
    } catch (error) {
        return { error: clientErrorMessage(error) };
    }
}

export async function setProviderKeyAction(
    _state: IProviderKeyActionState,
    formData: FormData,
): Promise<IProviderKeyActionState> {
    const principal = await requirePrincipal();
    const provider = providerFrom(formData);
    const key = String(formData.get("key") ?? "");
    if (!key.trim()) return { error: "Enter an API key before saving." };
    const baseUrl = String(formData.get("baseUrl") ?? "").trim();
    if (provider === "bifrost" && !baseUrl) {
        return {
            error: "Enter the public HTTPS URL of your Bifrost OpenAI-compatible endpoint.",
        };
    }
    try {
        await serverApiClient().setProviderKey({
            teamId: principal.teamId,
            provider,
            key,
            ...((provider === "openrouter" || provider === "bifrost") && baseUrl
                ? { baseUrl }
                : {}),
        });
        revalidateProviderSetupPaths();
        return {
            ok: true,
            message: "Provider key saved.",
            resetKey: Date.now(),
        };
    } catch (error) {
        return { error: clientErrorMessage(error) };
    }
}

export async function clearProviderKeyAction(
    _state: IProviderKeyActionState,
    formData: FormData,
): Promise<IProviderKeyActionState> {
    const principal = await requirePrincipal();
    const provider = providerFrom(formData);
    try {
        await serverApiClient().clearProviderKey({
            teamId: principal.teamId,
            provider,
        });
        revalidateProviderSetupPaths();
        return {
            ok: true,
            message:
                "Stored key cleared. New workflow routes cannot use this provider until a key is stored again. Existing saved routes remain visible, but credential rotation prevents new runs from using the old key.",
            resetKey: Date.now(),
        };
    } catch (error) {
        return { error: clientErrorMessage(error) };
    }
}

export async function loadWorkflowLlmRouteCandidatesAction(
    projectId: string,
    transport: WorkflowLlmTransport,
): Promise<IWorkflowLlmCandidatesActionState> {
    const principal = await requirePrincipal();
    try {
        return {
            result: await serverApiClient().listWorkflowLlmRouteCandidates(
                projectId,
                transport,
                { teamId: principal.teamId, actorId: principal.userId },
            ),
        };
    } catch (error) {
        return { error: clientErrorMessage(error) };
    }
}

export async function saveWorkflowLlmRouteAction(
    _state: IWorkflowLlmRoutingActionState,
    formData: FormData,
): Promise<IWorkflowLlmRoutingActionState> {
    const principal = await requirePrincipal();
    try {
        const routeId = String(formData.get("routeId") ?? "").trim();
        await serverApiClient().createWorkflowLlmRouteVersion(
            {
                projectId: required(formData, "projectId"),
                ...(routeId ? { routeId } : {}),
                name: required(formData, "name"),
                config: routeConfigFrom(formData),
            },
            { teamId: principal.teamId, actorId: principal.userId },
        );
        revalidateProviderSetupPaths();
        return {
            ok: true,
            message: routeId
                ? "A new immutable route version was created."
                : "Route created. Set it as the project default or pin it on a workflow node.",
        };
    } catch (error) {
        return routingError(error);
    }
}

export async function disableWorkflowLlmRouteAction(
    _state: IWorkflowLlmRoutingActionState,
    formData: FormData,
): Promise<IWorkflowLlmRoutingActionState> {
    const principal = await requirePrincipal();
    try {
        await serverApiClient().disableWorkflowLlmRoute({
            teamId: principal.teamId,
            projectId: required(formData, "projectId"),
            routeId: required(formData, "routeId"),
            disabledBy: principal.userId,
        });
        revalidateProviderSetupPaths();
        return {
            ok: true,
            message:
                "Route disabled for future runs. Any matching project default was cleared.",
        };
    } catch (error) {
        return routingError(error);
    }
}

export async function setWorkflowLlmDefaultAction(
    _state: IWorkflowLlmRoutingActionState,
    formData: FormData,
): Promise<IWorkflowLlmRoutingActionState> {
    const principal = await requirePrincipal();
    try {
        await serverApiClient().setWorkflowLlmProjectDefault({
            teamId: principal.teamId,
            projectId: required(formData, "projectId"),
            routeVersionId: required(formData, "routeVersionId"),
            updatedBy: principal.userId,
        });
        revalidateProviderSetupPaths();
        return {
            ok: true,
            message:
                "Project default updated. Saved run snapshots are unchanged.",
        };
    } catch (error) {
        return routingError(error);
    }
}

export async function clearWorkflowLlmDefaultAction(
    _state: IWorkflowLlmRoutingActionState,
    formData: FormData,
): Promise<IWorkflowLlmRoutingActionState> {
    const principal = await requirePrincipal();
    try {
        await serverApiClient().clearWorkflowLlmProjectDefault({
            teamId: principal.teamId,
            projectId: required(formData, "projectId"),
            updatedBy: principal.userId,
        });
        revalidateProviderSetupPaths();
        return {
            ok: true,
            message:
                "Project default cleared. Nodes using the default must be repaired before launch.",
        };
    } catch (error) {
        return routingError(error);
    }
}

function revalidateProviderSetupPaths(): void {
    revalidatePath("/settings");
    revalidatePath("/runs/new");
    revalidatePath("/multiworkflow", "layout");
    revalidatePath("/prompts", "layout");
}

function providerFrom(formData: FormData): ProviderKeyProvider {
    const provider = String(formData.get("provider") ?? "");
    if (!isProviderKeyProvider(provider)) {
        throw new UserFacingError("Unsupported provider.");
    }
    return provider;
}

function transportFrom(formData: FormData): WorkflowLlmTransport {
    const value = required(formData, "transport");
    if (
        value !== "openai" &&
        value !== "gateway" &&
        value !== "openrouter" &&
        value !== "bifrost"
    )
        throw new UserFacingError("Choose a supported LLM transport.");
    return value;
}

function routeConfigForNode(
    input: ICreateWorkflowLlmRouteForNodeInput,
): IWorkflowLlmRouteConfig {
    const generation = {
        maxOutputTokens: input.generation?.maxOutputTokens ?? 4096,
        ...(input.generation?.temperature !== undefined
            ? { temperature: input.generation.temperature }
            : {}),
        ...(input.generation?.topP !== undefined
            ? { topP: input.generation.topP }
            : {}),
        ...(input.generation?.seed !== undefined
            ? { seed: input.generation.seed }
            : {}),
        ...(input.generation?.reasoningEffort &&
        input.generation.reasoningEffort !== "none"
            ? { reasoningEffort: input.generation.reasoningEffort }
            : input.reasoningEffort && input.reasoningEffort !== "none"
              ? { reasoningEffort: input.reasoningEffort }
              : {}),
    };
    return {
        modelId: input.modelId,
        transportConfig:
            input.transport === "openai"
                ? { transport: "openai" }
                : input.transport === "gateway"
                  ? {
                        transport: "gateway",
                        upstreamPolicy: { mode: "gateway_auto" },
                        modelFallback: "disabled",
                    }
                  : input.transport === "bifrost"
                    ? {
                          transport: "bifrost",
                          upstreamPolicy: { mode: "bifrost_default" },
                      }
                    : {
                          transport: "openrouter",
                          upstreamPolicy: { mode: "auto" },
                          requireParameters: true,
                          responseCache: "allow",
                      },
        generation,
        structuredOutput: { mode: "text" },
        retry:
            input.transport === "gateway"
                ? { owner: "gateway", timeoutMs: input.timeoutMs ?? 60_000 }
                : {
                      owner: "mosaic",
                      maxAttempts: input.maxAttempts ?? 1,
                      timeoutMs: input.timeoutMs ?? 60_000,
                      retryableErrorClasses: [
                          "rate_limit",
                          "timeout",
                          "overloaded",
                          "upstream_unavailable",
                      ],
                  },
        cache: {
            mosaicReuse: input.mosaicReuse ?? "force_fresh",
            providerCaching: "allow",
        },
    };
}

function routeConfigFrom(formData: FormData): IWorkflowLlmRouteConfig {
    const transport = transportFrom(formData);
    const maxOutputTokens = positiveInteger(formData, "maxOutputTokens", 4096);
    const timeoutMs = positiveInteger(formData, "timeoutMs", 60_000);
    const generation = {
        maxOutputTokens,
        ...optionalNumber(formData, "temperature"),
        ...optionalNumber(formData, "topP"),
        ...optionalInteger(formData, "seed"),
        ...reasoningEffort(formData),
    };
    return {
        modelId: required(formData, "modelId"),
        transportConfig: transportConfigFrom(formData, transport),
        generation,
        structuredOutput: structuredOutputFrom(formData),
        retry:
            transport === "gateway"
                ? { owner: "gateway", timeoutMs }
                : {
                      owner: "mosaic",
                      maxAttempts: positiveInteger(formData, "maxAttempts", 1),
                      timeoutMs,
                      retryableErrorClasses: [
                          "rate_limit",
                          "timeout",
                          "overloaded",
                          "upstream_unavailable",
                      ],
                  },
        cache: {
            mosaicReuse:
                formData.get("mosaicReuse") === "allow"
                    ? "allow"
                    : "force_fresh",
            providerCaching: "allow",
        },
    };
}

function structuredOutputFrom(
    formData: FormData,
): IWorkflowLlmRouteConfig["structuredOutput"] {
    if (formData.get("structuredOutputMode") !== "json_schema")
        return { mode: "text" };
    return {
        mode: "json_schema",
        schemaName: required(formData, "schemaName"),
        schemaDigest: required(formData, "schemaDigest"),
        strict: formData.get("schemaStrict") === "on",
    };
}

function transportConfigFrom(
    formData: FormData,
    transport: WorkflowLlmTransport,
): IWorkflowLlmRouteConfig["transportConfig"] {
    if (transport === "openai") return { transport };
    if (transport === "gateway")
        return {
            transport,
            upstreamPolicy: { mode: "gateway_auto" },
            modelFallback: "disabled",
        };
    if (transport === "bifrost")
        return {
            transport,
            upstreamPolicy: { mode: "bifrost_default" },
        };
    const upstreamMode = String(formData.get("upstreamMode") ?? "auto") as
        "auto" | "exact" | "preference";
    const providers = String(formData.get("upstreamProviders") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    if (
        (upstreamMode === "exact" || upstreamMode === "preference") &&
        providers.length === 0
    )
        throw new UserFacingError(
            "Enter at least one OpenRouter upstream provider.",
        );
    const upstreamPolicy =
        upstreamMode === "exact"
            ? ({ mode: "exact", only: providers } as const)
            : upstreamMode === "preference"
              ? ({
                    mode: "preference",
                    order: providers,
                    allowFallbacks: formData.get("allowFallbacks") === "on",
                } as const)
              : ({ mode: "auto" } as const);
    return {
        transport,
        upstreamPolicy,
        requireParameters: formData.get("requireParameters") === "on",
        responseCache:
            formData.get("responseCache") === "allow" ? "allow" : "disable",
    };
}

function required(formData: FormData, name: string): string {
    const value = String(formData.get(name) ?? "").trim();
    if (!value) throw new UserFacingError(`${name} is required.`);
    return value;
}

function positiveInteger(
    formData: FormData,
    name: string,
    fallback: number,
): number {
    const raw = String(formData.get(name) ?? "").trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0)
        throw new UserFacingError(`${name} must be a positive whole number.`);
    return value;
}

function optionalNumber(
    formData: FormData,
    name: "temperature" | "topP",
): Partial<Record<typeof name, number>> {
    const raw = String(formData.get(name) ?? "").trim();
    if (!raw) return {};
    const value = Number(raw);
    if (!Number.isFinite(value))
        throw new UserFacingError(`${name} must be a number.`);
    return { [name]: value };
}

function optionalInteger(
    formData: FormData,
    name: "seed",
): Partial<Record<typeof name, number>> {
    const raw = String(formData.get(name) ?? "").trim();
    if (!raw) return {};
    const value = Number(raw);
    if (!Number.isInteger(value))
        throw new UserFacingError(`${name} must be a whole number.`);
    return { [name]: value };
}

function reasoningEffort(formData: FormData): {
    reasoningEffort?: ReasoningEffort;
} {
    const value = String(formData.get("reasoningEffort") ?? "");
    const effort = REASONING_EFFORT_LEVELS.find(
        (candidate) => candidate === value,
    );
    return effort && effort !== "none" ? { reasoningEffort: effort } : {};
}

function routingError(error: unknown): IWorkflowLlmRoutingActionState {
    return {
        error: clientErrorMessage(error),
        ...(error instanceof MosaicApiError && error.remediation
            ? { remediation: error.remediation }
            : {}),
    };
}
