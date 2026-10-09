import type {
    IWorkflowLlmExecutionProvenance,
    IWorkflowLlmResolvedExecution,
} from "@mosaic/api-contract";
import type { CompletionResult } from "@mosaic/llm-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", () => ({ db: {} }));

import {
    executeWorkflowLlmInvocation,
    workflowLlmFingerprint,
    type IWorkflowLlmInvocationDeps,
    type IWorkflowLlmInvocationInput,
} from "./llmInvocation";

const execution: IWorkflowLlmResolvedExecution = {
    contractVersion: 1,
    requestedSelection: {
        mode: "pinned_route",
        routeVersionId: "route-version-1",
    },
    routeId: "route-1",
    routeVersionId: "route-version-1",
    routeVersion: 1,
    route: {
        modelId: "gpt-4o",
        transportConfig: {
            transport: "openrouter",
            upstreamPolicy: { mode: "exact", only: ["openai"] },
            requireParameters: true,
            responseCache: "disable",
        },
        generation: {
            maxOutputTokens: 777,
            temperature: 0.2,
            topP: 0.8,
            seed: 42,
        },
        structuredOutput: { mode: "text" },
        retry: {
            owner: "mosaic",
            maxAttempts: 2,
            timeoutMs: 12_345,
            retryableErrorClasses: ["rate_limit"],
        },
        cache: {
            mosaicReuse: "force_fresh",
            providerCaching: "allow",
        },
    },
    credential: {
        providerKeyId: "key-1",
        rotationVersion: "rotation-1",
        hint: "…1234",
    },
    capability: {
        capabilityVersionId: "capability-1",
        capabilityDigest: "sha256:capability",
        capturedAt: "2026-07-25T00:00:00.000Z",
        stale: false,
        transport: {
            transport: "openrouter",
            transportModelId: "openai/gpt-4o",
            upstreamRoutingModes: ["exact"],
            supportedGenerationControls: [
                "maxOutputTokens",
                "temperature",
                "topP",
                "seed",
            ],
            supportsStructuredOutput: true,
            requiresCurrentDiscovery: true,
        },
        supportedUpstreamProviders: ["openai"],
    },
};

const completion: CompletionResult = {
    text: "done",
    usage: {
        promptTokens: 10,
        completionTokens: 3,
        totalTokens: 13,
    },
    latencyMs: 25,
    actualRoute: {
        status: "resolved",
        transport: "openrouter",
        modelId: "openai/gpt-4o",
        upstreamProvider: "openai",
        generationId: "gen-1",
        evidenceCompleteness: "complete",
    },
    cache: { status: "miss" },
};

const invocation: IWorkflowLlmInvocationInput = {
    teamId: "team-1",
    projectId: "project-1",
    cellId: "cell-1",
    nodeType: "prompt",
    execution,
    prompt: "Prompt bytes",
    system: "System bytes",
    images: [{ mimeType: "image/png", base64Data: "image-bytes" }],
};

function deps(overrides: Partial<IWorkflowLlmInvocationDeps> = {}) {
    const resolved: IWorkflowLlmInvocationDeps = {
        resolveCredential: vi.fn().mockResolvedValue({
            apiKey: "workflow-secret",
            baseUrl: "https://openrouter.test/v1",
        }),
        complete: vi.fn().mockResolvedValue(completion),
        readReuse: vi.fn().mockResolvedValue(undefined),
        publishReuse: vi.fn().mockResolvedValue(undefined),
        appendAttempts: vi.fn().mockResolvedValue(undefined),
        sleep: vi.fn().mockResolvedValue(undefined),
        random: vi.fn().mockReturnValue(0.5),
        ...overrides,
    };
    return resolved;
}

describe("workflow explicit LLM invocation", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
    });

    it("ignores hostile ambient routing and forwards the complete captured route", async () => {
        vi.stubEnv("MOSAIC_LLM_PROVIDER", "bifrost");
        vi.stubEnv("OPENAI_API_KEY", "ambient-secret");
        const harness = deps();

        const result = await executeWorkflowLlmInvocation(invocation, harness);

        expect(harness.resolveCredential).toHaveBeenCalledWith({
            teamId: "team-1",
            execution,
        });
        expect(harness.complete).toHaveBeenCalledExactlyOnceWith({
            transport: "openrouter",
            transportModelId: "openai/gpt-4o",
            apiKeys: {
                openrouter: "workflow-secret",
                openrouterBaseUrl: "https://openrouter.test/v1",
            },
            request: expect.objectContaining({
                model: "gpt-4o",
                maxTokens: 777,
                temperature: 0.2,
                topP: 0.8,
                seed: 42,
                timeoutMs: 12_345,
                maxRetries: 0,
                retryOwner: "mosaic",
                route: {
                    transport: "openrouter",
                    transportModelId: "openai/gpt-4o",
                    upstreamPolicy: {
                        mode: "exact",
                        only: ["openai"],
                    },
                    requireParameters: true,
                },
                cachePolicy: {
                    providerCaching: "allow",
                    responseCache: "disable",
                },
            }),
        });
        expect(JSON.stringify(result)).not.toContain("workflow-secret");
        expect(JSON.stringify(result)).not.toContain("ambient-secret");
    });

    it("fails credential rotation before any provider call", async () => {
        const harness = deps({
            resolveCredential: vi
                .fn()
                .mockRejectedValue(new Error("credential rotated")),
        });

        await expect(
            executeWorkflowLlmInvocation(invocation, harness),
        ).rejects.toThrow("credential rotated");

        expect(harness.complete).not.toHaveBeenCalled();
        expect(harness.appendAttempts).not.toHaveBeenCalled();
        expect(harness.publishReuse).not.toHaveBeenCalled();
    });

    it("persists requested and actual attempt evidence with usage and cache provenance", async () => {
        const harness = deps();

        const result = await executeWorkflowLlmInvocation(invocation, harness);

        expect(harness.appendAttempts).toHaveBeenCalledWith(
            "cell-1",
            [
                expect.objectContaining({
                    owner: "mosaic",
                    outcome: "succeeded",
                    requested: {
                        transport: "openrouter",
                        modelId: "gpt-4o",
                        upstreamProvider: "openai",
                    },
                    actual: expect.objectContaining({
                        status: "resolved",
                        identity: {
                            transport: "openrouter",
                            modelId: "openai/gpt-4o",
                            upstreamProvider: "openai",
                        },
                        generationId: "gen-1",
                    }),
                }),
            ],
            {
                generationId: "gen-1",
                upstreamProvider: "openai",
            },
        );
        expect(result.artifact.executionProvenance).toMatchObject({
            usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
            cache: { status: "miss" },
            actual: {
                status: "resolved",
                evidenceCompleteness: "complete",
            },
        });
    });

    it("force-fresh repeats independently and never reads Flash Evals reuse", async () => {
        const harness = deps();

        await executeWorkflowLlmInvocation(invocation, harness);
        await executeWorkflowLlmInvocation(invocation, harness);

        expect(harness.readReuse).not.toHaveBeenCalled();
        expect(harness.complete).toHaveBeenCalledTimes(2);
        expect(harness.publishReuse).not.toHaveBeenCalled();
    });

    it("allows exact reuse only after explicit opt-in and cites the sealed origin", async () => {
        let published:
            | Parameters<IWorkflowLlmInvocationDeps["publishReuse"]>[0]
            | undefined;
        const allowInput = {
            ...invocation,
            execution: {
                ...execution,
                route: {
                    ...execution.route,
                    cache: {
                        ...execution.route.cache,
                        mosaicReuse: "allow" as const,
                    },
                },
            },
        };
        const first = deps({
            publishReuse: vi.fn(async (value) => {
                published = value;
            }),
        });
        await executeWorkflowLlmInvocation(allowInput, first);
        const second = deps({
            readReuse: vi.fn(async () => ({
                artifact: published!.artifact,
                artifactDigest: published!.artifactDigest,
                originProvenance: published!
                    .provenance as IWorkflowLlmExecutionProvenance,
                sourceCellId: "origin-cell",
                sourceRunId: "origin-run",
            })),
        });

        const reused = await executeWorkflowLlmInvocation(allowInput, second);

        expect(second.complete).not.toHaveBeenCalled();
        expect(reused.costUsd).toBeUndefined();
        expect(reused.artifact.executionProvenance).toMatchObject({
            actual: { status: "not_invoked" },
            attempts: [],
            usage: {},
            currentCost: { source: "unavailable" },
            cache: {
                status: "mosaic_reuse",
                sourceCellId: "origin-cell",
                sourceRunId: "origin-run",
            },
        });
    });

    it("misses when any execution-affecting fingerprint dimension changes", () => {
        const base = workflowLlmFingerprint(invocation).fingerprint;
        const variants: IWorkflowLlmInvocationInput[] = [
            { ...invocation, prompt: "changed prompt" },
            {
                ...invocation,
                images: [
                    { mimeType: "image/png", base64Data: "changed image" },
                ],
            },
            {
                ...invocation,
                responseSchema: {
                    name: "out",
                    schema: { type: "object" },
                },
            },
            {
                ...invocation,
                execution: {
                    ...execution,
                    credential: {
                        ...execution.credential,
                        rotationVersion: "rotation-2",
                    },
                },
            },
            {
                ...invocation,
                execution: {
                    ...execution,
                    route: {
                        ...execution.route,
                        generation: {
                            ...execution.route.generation,
                            temperature: 0.3,
                        },
                    },
                },
            },
            {
                ...invocation,
                execution: {
                    ...execution,
                    route: {
                        ...execution.route,
                        transportConfig: {
                            transport: "openrouter",
                            upstreamPolicy: {
                                mode: "exact",
                                only: ["azure"],
                            },
                            requireParameters: true,
                            responseCache: "disable",
                        },
                    },
                },
            },
        ];

        expect(
            variants.map(
                (variant) => workflowLlmFingerprint(variant).fingerprint,
            ),
        ).not.toContain(base);
        expect(
            new Set([
                base,
                ...variants.map(
                    (variant) => workflowLlmFingerprint(variant).fingerprint,
                ),
            ]).size,
        ).toBe(variants.length + 1);
    });

    it("retries only captured transient classes and never publishes failures", async () => {
        const complete = vi
            .fn()
            .mockRejectedValueOnce(new Error("429 rate limit"))
            .mockResolvedValueOnce(completion);
        const harness = deps({ complete });

        await executeWorkflowLlmInvocation(invocation, harness);

        expect(complete).toHaveBeenCalledTimes(2);
        expect(harness.sleep).toHaveBeenCalledWith(125);
        expect(harness.publishReuse).not.toHaveBeenCalled();
        expect(harness.appendAttempts).toHaveBeenNthCalledWith(1, "cell-1", [
            expect.objectContaining({
                outcome: "failed",
                errorClass: "rate_limit",
            }),
        ]);
        expect(harness.appendAttempts).toHaveBeenNthCalledWith(
            2,
            "cell-1",
            [expect.objectContaining({ outcome: "succeeded" })],
            expect.anything(),
        );

        const failed = deps({
            complete: vi
                .fn()
                .mockRejectedValue(new Error("401 invalid API key")),
        });
        await expect(
            executeWorkflowLlmInvocation(invocation, failed),
        ).rejects.toThrow("authentication");
        expect(failed.complete).toHaveBeenCalledTimes(1);
        expect(failed.publishReuse).not.toHaveBeenCalled();
    });

    it("does not publish incomplete structured output", async () => {
        const harness = deps({
            complete: vi.fn().mockResolvedValue({
                ...completion,
                schemaViolation: true,
                parsed: undefined,
            }),
        });

        await expect(
            executeWorkflowLlmInvocation(
                {
                    ...invocation,
                    responseSchema: {
                        name: "output",
                        schema: { type: "object" },
                    },
                },
                harness,
            ),
        ).rejects.toThrow("violated the captured schema");

        expect(harness.publishReuse).not.toHaveBeenCalled();
        expect(harness.appendAttempts).toHaveBeenCalledWith(
            "cell-1",
            [
                expect.objectContaining({
                    outcome: "failed",
                    errorClass: "schema_validation",
                }),
            ],
            expect.anything(),
        );
    });

    it("does not expose provider error payloads containing secrets", async () => {
        const harness = deps({
            complete: vi
                .fn()
                .mockRejectedValue(
                    new Error("provider echoed secret-sentinel-123"),
                ),
        });

        const error = await executeWorkflowLlmInvocation(
            invocation,
            harness,
        ).catch((failure: unknown) => failure);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(
            "Workflow LLM invocation failed (provider_error).",
        );
        expect(
            JSON.stringify(vi.mocked(harness.appendAttempts).mock.calls),
        ).not.toContain("secret-sentinel-123");
    });

    it("removes an active credential reflected by provider metadata", async () => {
        const reflected = "prefix-workflow-secret-suffix";
        const harness = deps({
            complete: vi.fn().mockResolvedValue({
                ...completion,
                actualRoute: {
                    status: "resolved",
                    transport: "openrouter",
                    modelId: reflected,
                    upstreamProvider: reflected,
                    generationId: reflected,
                    evidenceCompleteness: "complete",
                },
                attempts: [
                    {
                        sequence: 1,
                        owner: "gateway",
                        requested: {
                            transport: "openrouter",
                            transportModelId: "openai/gpt-4o",
                            upstreamPolicy: { mode: "auto" },
                        },
                        actual: {
                            status: "resolved",
                            transport: "openrouter",
                            modelId: reflected,
                            upstreamProvider: reflected,
                            generationId: reflected,
                            evidenceCompleteness: "complete",
                        },
                        outcome: "succeeded",
                    },
                ],
                providerMetadata: {
                    gateway: { generationId: reflected },
                },
            }),
        });

        const result = await executeWorkflowLlmInvocation(invocation, harness);

        expect(JSON.stringify(result)).not.toContain("workflow-secret");
        expect(
            JSON.stringify(vi.mocked(harness.appendAttempts).mock.calls),
        ).not.toContain("workflow-secret");
        expect(result.artifact.executionProvenance?.actual).toEqual({
            status: "unresolved",
            identity: { transport: "openrouter" },
            evidenceCompleteness: "absent",
        });
    });

    it("keeps provider caching distinct from Flash Evals result reuse", async () => {
        const harness = deps({
            complete: vi.fn().mockResolvedValue({
                ...completion,
                cache: {
                    status: "provider_cache",
                    kind: "response",
                    hit: true,
                },
            }),
        });

        const result = await executeWorkflowLlmInvocation(invocation, harness);

        expect(result.artifact.executionProvenance?.cache).toEqual({
            status: "provider_cache",
            kind: "response",
            hit: true,
        });
    });
});
