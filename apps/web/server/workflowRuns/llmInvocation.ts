import { createHash } from "node:crypto";
import type {
    IWorkflowLlmActualRoute,
    IWorkflowLlmAttempt,
    IWorkflowLlmCacheProvenance,
    IWorkflowLlmCost,
    IWorkflowLlmExecutionProvenance,
    IWorkflowLlmResolvedExecution,
    IWorkflowLlmUsage,
    IWorkflowNodeArtifact,
    WorkflowLlmTransport,
    WorkflowNodeType,
} from "@mosaic/api-contract";
import {
    canonicalJsonString,
    WORKFLOW_LLM_FINGERPRINT_VERSION,
} from "@mosaic/api-contract";
import {
    computeCostFromUsageWithPricing,
    getEvalProvider,
    type ApiKeys,
    type CompletionRequest,
    type CompletionResult,
    type EvalImage,
} from "@mosaic/llm-core";
import { decryptSecret } from "@mosaic/secrets";
import { isRecord } from "@/lib/objects";
import { and, eq, max, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
    providerKeys,
    workflowCellAttempts,
    workflowExactReuse,
    workflowRunCells,
} from "../db/schema";
import type { ModelPricing } from "../llm/pricing";

const ADAPTER_BEHAVIOR_VERSION = 1;

interface IResolvedWorkflowCredential {
    apiKey: string;
    baseUrl?: string;
}

interface IExactReuseHit {
    artifact: IWorkflowNodeArtifact;
    artifactDigest: string;
    originProvenance: IWorkflowLlmExecutionProvenance;
    sourceCellId?: string;
    sourceRunId?: string;
}

interface IPublishReuseInput {
    projectId: string;
    cellId: string;
    fingerprint: string;
    canonicalInputDigest: string;
    artifactDigest: string;
    artifact: IWorkflowNodeArtifact;
    provenance: IWorkflowLlmExecutionProvenance;
}

export interface IWorkflowLlmInvocationDeps {
    resolveCredential(input: {
        teamId: string;
        execution: IWorkflowLlmResolvedExecution;
    }): Promise<IResolvedWorkflowCredential>;
    complete(input: {
        transport: WorkflowLlmTransport;
        transportModelId: string;
        apiKeys: ApiKeys;
        request: CompletionRequest;
    }): Promise<CompletionResult>;
    readReuse(input: {
        projectId: string;
        fingerprint: string;
    }): Promise<IExactReuseHit | undefined>;
    publishReuse(input: IPublishReuseInput): Promise<void>;
    appendAttempts(
        cellId: string,
        attempts: IWorkflowLlmAttempt[],
        safeProviderEvidence?: Record<string, unknown>,
    ): Promise<void>;
    sleep(delayMs: number): Promise<void>;
    random(): number;
}

export interface IWorkflowLlmInvocationInput {
    teamId: string;
    projectId: string;
    cellId: string;
    nodeType: WorkflowNodeType;
    execution: IWorkflowLlmResolvedExecution;
    prompt: string;
    system?: string;
    images?: EvalImage[];
    responseSchema?: {
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean;
    };
    pricing?: ModelPricing;
}

export interface IWorkflowLlmInvocationResult {
    artifact: IWorkflowNodeArtifact;
    latencyMs: number;
    costUsd?: number;
}

// eslint-disable-next-line complexity -- invocation coordinates cache, retry, provider, and provenance states.
export async function executeWorkflowLlmInvocation(
    input: IWorkflowLlmInvocationInput,
    deps: IWorkflowLlmInvocationDeps = defaultDeps,
): Promise<IWorkflowLlmInvocationResult> {
    const credential = await deps.resolveCredential({
        teamId: input.teamId,
        execution: input.execution,
    });
    const identity = fingerprintFor(input);
    if (input.execution.route.cache.mosaicReuse === "allow") {
        const hit = await deps.readReuse({
            projectId: input.projectId,
            fingerprint: identity.fingerprint,
        });
        if (hit) return reusedResult(input, identity.fingerprint, hit);
    }

    const transport = input.execution.route.transportConfig.transport;
    const apiKeys = keysForTransport(transport, credential);
    const route = input.execution.route;
    const requested = {
        transport,
        modelId: route.modelId,
        upstreamProvider: requestedUpstreamProvider(input.execution),
    };
    const maxAttempts =
        route.retry.owner === "mosaic" ? route.retry.maxAttempts : 1;
    const attempts: IWorkflowLlmAttempt[] = [];
    let result: CompletionResult | undefined;
    let lastError: unknown;
    for (let sequence = 1; sequence <= maxAttempts; sequence += 1) {
        const startedAt = performance.now();
        try {
            result = sanitizeCompletionResult(
                await deps.complete({
                    transport,
                    transportModelId:
                        input.execution.capability.transport.transportModelId,
                    apiKeys,
                    request: completionRequest(input),
                }),
                credential.apiKey,
            );
            lastError = undefined;
            const actual = actualRoute(result, input.execution);
            const attempt: IWorkflowLlmAttempt = {
                sequence,
                owner: "mosaic",
                requested,
                actual,
                outcome: result.schemaViolation ? "failed" : "succeeded",
                ...(result.schemaViolation
                    ? { errorClass: "schema_validation" }
                    : {}),
                latencyMs: result.latencyMs,
            };
            attempts.push(attempt);
            await deps.appendAttempts(
                input.cellId,
                [attempt, ...normalizedGatewayAttempts(result, sequence + 1)],
                safeEvidence(result),
            );
            if (result.schemaViolation) {
                lastError = new Error(
                    "Workflow LLM returned output that violated the captured schema.",
                );
                break;
            }
            break;
        } catch (error) {
            lastError = error;
            const errorClass = classifyProviderError(error);
            const attempt: IWorkflowLlmAttempt = {
                sequence,
                owner: "mosaic",
                requested,
                outcome: "failed",
                errorClass,
                latencyMs: performance.now() - startedAt,
            };
            attempts.push(attempt);
            await deps.appendAttempts(input.cellId, [attempt]);
            const shouldRetry =
                route.retry.owner !== "mosaic" ||
                sequence >= maxAttempts ||
                !route.retry.retryableErrorClasses.some(
                    (candidate) => candidate === errorClass,
                );
            if (shouldRetry) break;
            await deps.sleep(retryDelayMs(error, sequence, deps.random()));
        }
    }
    const safeProviderEvidence = safeEvidence(result);
    const gatewayAttempts = normalizedGatewayAttempts(
        result,
        attempts.length + 1,
    );
    if (!result || lastError || result.schemaViolation) {
        if (
            lastError instanceof Error &&
            lastError.message.includes("violated the captured schema")
        )
            throw lastError;
        throw new Error(
            `Workflow LLM invocation failed (${classifyProviderError(lastError)}).`,
        );
    }

    const usage = usageFrom(result);
    const currentCost = costFrom(result, input.pricing);
    const cache = cacheFrom(result);
    const provenance: IWorkflowLlmExecutionProvenance = {
        requested: input.execution.requestedSelection,
        resolved: input.execution,
        actual: actualRoute(result, input.execution),
        attempts: [...attempts, ...gatewayAttempts],
        cache,
        usage,
        currentCost,
        currentLatencyMs: result.latencyMs,
        ...(safeProviderEvidence ? { safeProviderEvidence } : {}),
    };
    const artifactWithoutProvenance: IWorkflowNodeArtifact = {
        text: result.text,
        ...(isRecord(result.parsed)
            ? { json: result.parsed as Record<string, unknown> }
            : {}),
        usage: artifactUsage(usage, currentCost),
        ...(safeProviderEvidence
            ? { providerMetadata: safeProviderEvidence }
            : {}),
    };
    const artifactDigest = digest(
        canonicalJsonString(artifactWithoutProvenance),
    );
    const artifact: IWorkflowNodeArtifact = {
        ...artifactWithoutProvenance,
        executionProvenance: provenance,
    };
    if (input.execution.route.cache.mosaicReuse === "allow")
        await deps.publishReuse({
            projectId: input.projectId,
            cellId: input.cellId,
            fingerprint: identity.fingerprint,
            canonicalInputDigest: identity.canonicalInputDigest,
            artifactDigest,
            artifact,
            provenance,
        });
    return {
        artifact,
        latencyMs: result.latencyMs,
        ...(currentCost.usd !== undefined ? { costUsd: currentCost.usd } : {}),
    };
}

export function workflowLlmFingerprint(input: IWorkflowLlmInvocationInput): {
    fingerprint: string;
    canonicalInputDigest: string;
} {
    return fingerprintFor(input);
}

function completionRequest(
    input: IWorkflowLlmInvocationInput,
): CompletionRequest {
    const route = input.execution.route;
    return {
        model: route.modelId,
        prompt: input.prompt,
        ...(input.system ? { system: input.system } : {}),
        ...(input.images ? { images: input.images } : {}),
        ...(input.responseSchema
            ? { responseSchema: input.responseSchema }
            : {}),
        maxTokens: route.generation.maxOutputTokens,
        ...(route.generation.temperature !== undefined
            ? { temperature: route.generation.temperature }
            : {}),
        ...(route.generation.topP !== undefined
            ? { topP: route.generation.topP }
            : {}),
        ...(route.generation.seed !== undefined
            ? { seed: route.generation.seed }
            : {}),
        ...(route.generation.reasoningEffort
            ? { reasoningEffort: route.generation.reasoningEffort }
            : {}),
        timeoutMs: route.retry.timeoutMs,
        maxRetries: 0,
        retryOwner: route.retry.owner,
        route: completionRoute(input.execution),
        cachePolicy: {
            providerCaching: route.cache.providerCaching,
            ...(route.transportConfig.transport === "openrouter"
                ? {
                      responseCache: route.transportConfig.responseCache,
                  }
                : {}),
        },
    };
}

function completionRoute(
    execution: IWorkflowLlmResolvedExecution,
): NonNullable<CompletionRequest["route"]> {
    const transport = execution.route.transportConfig;
    return {
        transport: transport.transport,
        transportModelId: execution.capability.transport.transportModelId,
        upstreamPolicy:
            transport.transport === "openrouter"
                ? transport.upstreamPolicy
                : transport.transport === "gateway"
                  ? { mode: "auto" }
                  : { mode: "none" },
        ...(transport.transport === "openrouter"
            ? { requireParameters: transport.requireParameters }
            : {}),
    };
}

function fingerprintFor(input: IWorkflowLlmInvocationInput) {
    const canonicalInput = {
        system: input.system,
        prompt: input.prompt,
        responseSchema: input.responseSchema,
        images: (input.images ?? []).map((image) => ({
            mimeType: image.mimeType,
            digest: digest(image.base64Data),
        })),
    };
    const canonicalInputDigest = digest(canonicalJsonString(canonicalInput));
    return {
        canonicalInputDigest,
        fingerprint: digest(
            canonicalJsonString({
                domain: "mosaic.workflow.llm.exact-reuse",
                fingerprintVersion: WORKFLOW_LLM_FINGERPRINT_VERSION,
                adapterBehaviorVersion: ADAPTER_BEHAVIOR_VERSION,
                nodeType: input.nodeType,
                execution: input.execution,
                canonicalInputDigest,
            }),
        ),
    };
}

function reusedResult(
    input: IWorkflowLlmInvocationInput,
    fingerprint: string,
    hit: IExactReuseHit,
): IWorkflowLlmInvocationResult {
    const cache: IWorkflowLlmCacheProvenance = {
        status: "mosaic_reuse",
        fingerprintVersion: WORKFLOW_LLM_FINGERPRINT_VERSION,
        fingerprint,
        ...(hit.sourceRunId ? { sourceRunId: hit.sourceRunId } : {}),
        ...(hit.sourceCellId ? { sourceCellId: hit.sourceCellId } : {}),
        artifactDigest: hit.artifactDigest,
    };
    const provenance: IWorkflowLlmExecutionProvenance = {
        requested: input.execution.requestedSelection,
        resolved: input.execution,
        actual: {
            status: "not_invoked",
            evidenceCompleteness: "complete",
        },
        attempts: [],
        cache,
        usage: {},
        currentCost: { source: "unavailable" },
        currentLatencyMs: 0,
        originCost: hit.originProvenance.currentCost,
        ...(hit.originProvenance.currentLatencyMs !== undefined
            ? { originLatencyMs: hit.originProvenance.currentLatencyMs }
            : {}),
    };
    return {
        artifact: {
            ...hit.artifact,
            usage: {},
            executionProvenance: provenance,
        },
        latencyMs: 0,
    };
}

function actualRoute(
    result: CompletionResult,
    _execution: IWorkflowLlmResolvedExecution,
): IWorkflowLlmActualRoute {
    const actual = result.actualRoute;
    if (!actual)
        return {
            status: "unresolved",
            evidenceCompleteness: "absent",
        };
    if (actual.status === "unavailable")
        return { status: "unavailable", evidenceCompleteness: "absent" };
    if (actual.status === "not_invoked")
        return {
            status: "not_invoked",
            ...(actual.generationId
                ? { generationId: actual.generationId }
                : {}),
            evidenceCompleteness: "complete",
        };
    const identity =
        actual.transport || actual.modelId || actual.upstreamProvider
            ? {
                  ...(actual.transport ? { transport: actual.transport } : {}),
                  ...(actual.modelId ? { modelId: actual.modelId } : {}),
                  ...(actual.upstreamProvider
                      ? { upstreamProvider: actual.upstreamProvider }
                      : {}),
              }
            : undefined;
    if (actual.status === "resolved")
        return {
            status: "resolved",
            identity: {
                transport: actual.transport,
                modelId: actual.modelId,
                ...(actual.upstreamProvider
                    ? { upstreamProvider: actual.upstreamProvider }
                    : {}),
            },
            ...(actual.generationId
                ? { generationId: actual.generationId }
                : {}),
            evidenceCompleteness: actual.evidenceCompleteness,
        };
    return {
        status: "unresolved",
        ...(identity ? { identity } : {}),
        ...(actual.generationId ? { generationId: actual.generationId } : {}),
        evidenceCompleteness: actual.evidenceCompleteness,
    };
}

function normalizedGatewayAttempts(
    result: CompletionResult | undefined,
    startSequence: number,
): IWorkflowLlmAttempt[] {
    return (result?.attempts ?? [])
        .filter((attempt) => attempt.owner === "gateway")
        .map((attempt, index) => ({
            sequence: startSequence + index,
            owner: "gateway" as const,
            requested: {
                transport: attempt.requested.transport,
                modelId: attempt.requested.transportModelId,
            },
            actual: attempt.actual
                ? actualRoute(
                      {
                          text: "",
                          usage: {},
                          latencyMs: 0,
                          actualRoute: attempt.actual,
                      },
                      {} as IWorkflowLlmResolvedExecution,
                  )
                : undefined,
            outcome: attempt.outcome,
            errorClass: attempt.errorClass,
            latencyMs: attempt.latencyMs,
        }));
}

function usageFrom(result: CompletionResult): IWorkflowLlmUsage {
    return {
        ...(result.usage.promptTokens !== undefined
            ? { inputTokens: result.usage.promptTokens }
            : {}),
        ...(result.usage.completionTokens !== undefined
            ? { outputTokens: result.usage.completionTokens }
            : {}),
        ...(result.usage.reasoningTokens !== undefined
            ? { reasoningTokens: result.usage.reasoningTokens }
            : {}),
        ...(result.usage.cacheReadTokens !== undefined
            ? { cacheReadTokens: result.usage.cacheReadTokens }
            : {}),
        ...(result.usage.cacheWriteTokens !== undefined
            ? { cacheWriteTokens: result.usage.cacheWriteTokens }
            : {}),
        ...(result.usage.totalTokens !== undefined
            ? { totalTokens: result.usage.totalTokens }
            : {}),
    };
}

function costFrom(
    result: CompletionResult,
    pricing: ModelPricing | undefined,
): IWorkflowLlmCost {
    if (result.cost) return { ...result.cost } satisfies IWorkflowLlmCost;
    if (pricing) {
        const usd = computeCostFromUsageWithPricing(result.usage, pricing);
        if (usd !== undefined) return { usd, source: "catalog_estimate" };
    }
    return { source: "unavailable" };
}

function cacheFrom(result: CompletionResult): IWorkflowLlmCacheProvenance {
    if (result.cache?.status === "provider_cache")
        return {
            status: "provider_cache",
            kind: result.cache.kind,
            hit: result.cache.hit,
        };
    return { status: "miss" };
}

function artifactUsage(
    usage: IWorkflowLlmUsage,
    cost: IWorkflowLlmCost,
): NonNullable<IWorkflowNodeArtifact["usage"]> {
    return {
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        thinkingTokens: usage.reasoningTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        totalTokens: usage.totalTokens,
        costUsd: cost.usd,
    };
}

function requestedUpstreamProvider(
    execution: IWorkflowLlmResolvedExecution,
): string | undefined {
    const transport = execution.route.transportConfig;
    if (transport.transport !== "openrouter") return undefined;
    if (transport.upstreamPolicy.mode === "exact")
        return transport.upstreamPolicy.only.join(",");
    if (transport.upstreamPolicy.mode === "preference")
        return transport.upstreamPolicy.order.join(",");
    return undefined;
}

function keysForTransport(
    transport: WorkflowLlmTransport,
    credential: IResolvedWorkflowCredential,
): ApiKeys {
    switch (transport) {
        case "openai":
            return { openai: credential.apiKey };
        case "gateway":
            return { gateway: credential.apiKey };
        case "openrouter":
            return {
                openrouter: credential.apiKey,
                ...(credential.baseUrl
                    ? { openrouterBaseUrl: credential.baseUrl }
                    : {}),
            };
        case "bifrost":
            return {
                bifrost: credential.apiKey,
                ...(credential.baseUrl
                    ? { bifrostBaseUrl: credential.baseUrl }
                    : {}),
            };
    }
}

function safeEvidence(
    result: CompletionResult | undefined,
): Record<string, unknown> | undefined {
    if (!result?.actualRoute && !result?.providerMetadata) return undefined;
    const evidence: Record<string, unknown> = {};
    const actual = result.actualRoute;
    if (actual && "generationId" in actual && actual.generationId)
        evidence.generationId = actual.generationId.slice(0, 200);
    if (actual && "upstreamProvider" in actual && actual.upstreamProvider)
        evidence.upstreamProvider = actual.upstreamProvider.slice(0, 100);
    const gatewayId = result.providerMetadata?.gateway?.generationId;
    if (gatewayId) evidence.gatewayGenerationId = gatewayId.slice(0, 200);
    return Object.keys(evidence).length ? evidence : undefined;
}

function sanitizeCompletionResult(
    result: CompletionResult,
    activeCredential: string,
): CompletionResult {
    const safeValue = (value: string | undefined) =>
        value && !value.includes(activeCredential) ? value : undefined;
    const sanitizeActual = (
        actual: CompletionResult["actualRoute"],
    ): CompletionResult["actualRoute"] => {
        if (!actual) return undefined;
        if (actual.status === "unavailable") return actual;
        if (actual.status === "not_invoked") {
            const generationId = safeValue(actual.generationId);
            return {
                status: "not_invoked",
                ...(generationId ? { generationId } : {}),
                evidenceCompleteness: "complete",
            };
        }
        const modelId = safeValue(actual.modelId);
        const upstreamProvider = safeValue(actual.upstreamProvider);
        const generationId = safeValue(actual.generationId);
        if (actual.status === "resolved" && modelId)
            return {
                status: "resolved",
                transport: actual.transport,
                modelId,
                ...(upstreamProvider ? { upstreamProvider } : {}),
                ...(generationId ? { generationId } : {}),
                evidenceCompleteness: actual.evidenceCompleteness,
            };
        return {
            status: "unresolved",
            ...(actual.transport ? { transport: actual.transport } : {}),
            ...(modelId ? { modelId } : {}),
            ...(upstreamProvider ? { upstreamProvider } : {}),
            ...(generationId ? { generationId } : {}),
            evidenceCompleteness:
                modelId || upstreamProvider || generationId
                    ? "partial"
                    : "absent",
        };
    };
    const gatewayGenerationId = safeValue(
        result.providerMetadata?.gateway?.generationId,
    );
    return {
        ...result,
        actualRoute: sanitizeActual(result.actualRoute),
        attempts: result.attempts?.map((attempt) => ({
            ...attempt,
            actual: sanitizeActual(attempt.actual),
        })),
        providerMetadata: gatewayGenerationId
            ? { gateway: { generationId: gatewayGenerationId } }
            : undefined,
    };
}

function retryDelayMs(
    error: unknown,
    failedAttempt: number,
    random: number,
): number {
    const retryAfter = retryAfterMs(error);
    if (retryAfter !== undefined) return Math.min(retryAfter, 30_000);
    const cap = Math.min(250 * 2 ** (failedAttempt - 1), 30_000);
    return Math.floor(Math.max(0, Math.min(1, random)) * cap);
}

function retryAfterMs(error: unknown): number | undefined {
    if (!isRecord(error)) return undefined;
    const direct = error.retryAfterMs;
    if (typeof direct === "number" && Number.isFinite(direct) && direct >= 0)
        return direct;
    const headers = error.headers;
    if (!isRecord(headers)) return undefined;
    const value = headers["retry-after"];
    if (typeof value !== "string") return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

type WorkflowProviderErrorClass =
    | "rate_limit"
    | "timeout"
    | "overloaded"
    | "upstream_unavailable"
    | "authentication"
    | "schema_validation"
    | "provider_error";

function classifyProviderError(error: unknown): WorkflowProviderErrorClass {
    const message =
        error instanceof Error ? error.message.toLowerCase() : String(error);
    if (/429|rate.?limit/.test(message)) return "rate_limit";
    if (/timeout|timed out|abort/.test(message)) return "timeout";
    if (/overload|capacity/.test(message)) return "overloaded";
    if (/502|503|504|unavailable/.test(message)) return "upstream_unavailable";
    if (/401|403|auth|credential|api key/.test(message))
        return "authentication";
    if (/schema|json|validation/.test(message)) return "schema_validation";
    return "provider_error";
}

function digest(value: string): string {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const defaultDeps: IWorkflowLlmInvocationDeps = {
    sleep(delayMs) {
        return new Promise((resolve) => setTimeout(resolve, delayMs));
    },
    random: Math.random,
    async resolveCredential({ teamId, execution }) {
        const transport = execution.route.transportConfig.transport;
        const [row] = await db
            .select()
            .from(providerKeys)
            .where(
                and(
                    eq(providerKeys.id, execution.credential.providerKeyId),
                    eq(providerKeys.teamId, teamId),
                    eq(providerKeys.provider, transport),
                ),
            )
            .limit(1);
        if (
            !row ||
            row.rotationVersion !== execution.credential.rotationVersion
        )
            throw new Error(
                "The stored workflow credential was deleted, rotated, or is outside this team.",
            );
        return {
            apiKey: decryptSecret(row, {
                teamId,
                provider: row.provider,
            }),
            ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
        };
    },
    async complete({ transport, transportModelId, apiKeys, request }) {
        return getEvalProvider(apiKeys, {
            transport,
            exactTransportModelId: transportModelId,
            gatewayFallbackModels: [],
        }).complete(request);
    },
    async readReuse({ projectId, fingerprint }) {
        const [row] = await db
            .select({
                artifact: workflowExactReuse.artifact,
                artifactDigest: workflowExactReuse.artifactDigest,
                originProvenance: workflowExactReuse.originProvenance,
                sourceCellId: workflowExactReuse.sourceCellId,
                sourceRunId: workflowRunCells.workflowRunId,
            })
            .from(workflowExactReuse)
            .leftJoin(
                workflowRunCells,
                eq(workflowRunCells.id, workflowExactReuse.sourceCellId),
            )
            .where(
                and(
                    eq(workflowExactReuse.projectId, projectId),
                    eq(
                        workflowExactReuse.fingerprintVersion,
                        WORKFLOW_LLM_FINGERPRINT_VERSION,
                    ),
                    eq(workflowExactReuse.fingerprint, fingerprint),
                ),
            )
            .limit(1);
        if (!row) return undefined;
        return {
            artifact: row.artifact,
            artifactDigest: row.artifactDigest,
            originProvenance: row.originProvenance,
            ...(row.sourceCellId ? { sourceCellId: row.sourceCellId } : {}),
            ...(row.sourceRunId ? { sourceRunId: row.sourceRunId } : {}),
        };
    },
    async publishReuse(input) {
        await db
            .insert(workflowExactReuse)
            .values({
                projectId: input.projectId,
                fingerprintVersion: WORKFLOW_LLM_FINGERPRINT_VERSION,
                fingerprint: input.fingerprint,
                canonicalInputDigest: input.canonicalInputDigest,
                artifactDigest: input.artifactDigest,
                artifact: input.artifact,
                originProvenance: input.provenance,
                sourceCellId: input.cellId,
            })
            .onConflictDoNothing();
    },
    async appendAttempts(cellId, attempts, safeProviderEvidence) {
        if (!attempts.length) return;
        await db.transaction(async (tx) => {
            await tx.execute(
                sql`select pg_advisory_xact_lock(hashtext(${cellId}))`,
            );
            const [current] = await tx
                .select({ sequence: max(workflowCellAttempts.sequence) })
                .from(workflowCellAttempts)
                .where(eq(workflowCellAttempts.workflowRunCellId, cellId));
            const offset = current?.sequence ?? 0;
            await tx.insert(workflowCellAttempts).values(
                attempts.map((attempt, index) => ({
                    workflowRunCellId: cellId,
                    sequence: offset + index + 1,
                    owner: attempt.owner,
                    requested: attempt.requested,
                    actual: attempt.actual,
                    outcome: attempt.outcome,
                    errorClass: attempt.errorClass,
                    latencyMs: attempt.latencyMs,
                    ...(safeProviderEvidence ? { safeProviderEvidence } : {}),
                })),
            );
        });
    },
};
