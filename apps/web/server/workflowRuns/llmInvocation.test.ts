import type {
    IWorkflowLlmExecutionProvenance,
    IWorkflowLlmResolvedExecution,
} from "@flash-evals/api-contract";
import type { CompletionResult } from "@flash-evals/llm-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/client", () => ({ db: {} }));
const limiter = vi.hoisted(() => ({
    complete: vi.fn(),
    getLimitedEvalProvider: vi.fn(),
}));
vi.mock("../llm/providerConcurrency", () => ({
    getLimitedEvalProvider: limiter.getLimitedEvalProvider,
}));

import {
    billedCostOf,
    BilledStepError,
    completeWithProviderLimit,
    envWorkflowCredential,
    executeWorkflowLlmInvocation,
    savedKeyBaseUrl,
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
            owner: "flash-evals",
            maxAttempts: 2,
            timeoutMs: 12_345,
            retryableErrorClasses: ["rate_limit"],
        },
        cache: {
            flashEvalsReuse: "force_fresh",
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

type IStoredReuse = Parameters<IWorkflowLlmInvocationDeps["publishReuse"]>[0];

/** The invocation with stored-result reuse allowed. */
function withReuse(
    input: IWorkflowLlmInvocationInput,
): IWorkflowLlmInvocationInput {
    return {
        ...input,
        execution: {
            ...input.execution,
            route: {
                ...input.execution.route,
                cache: { flashEvalsReuse: "allow", providerCaching: "allow" },
            },
        },
    };
}

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
        vi.stubEnv("FLASH_EVALS_LLM_PROVIDER", "bifrost");
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
                retryOwner: "flash-evals",
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
                    owner: "flash-evals",
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
                        flashEvalsReuse: "allow" as const,
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
                status: "flash_evals_reuse",
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

    it("carries a schema-failed call's cost so the executor can record it", async () => {
        const harness = deps({
            complete: vi.fn().mockResolvedValue({
                ...completion,
                schemaViolation: true,
                parsed: undefined,
                cost: { usd: 0.0042, source: "provider_reported" },
            }),
        });

        const error = await executeWorkflowLlmInvocation(
            {
                ...invocation,
                responseSchema: { name: "output", schema: { type: "object" } },
            },
            harness,
        ).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BilledStepError);
        expect((error as Error).message).toMatch(
            /violated the captured schema/,
        );
        expect(billedCostOf(error)).toBe(0.0042);
    });

    it("carries no cost when the provider call itself failed", async () => {
        const failed = deps({
            complete: vi
                .fn()
                .mockRejectedValue(new Error("401 invalid API key")),
        });
        const error = await executeWorkflowLlmInvocation(
            invocation,
            failed,
        ).catch((caught: unknown) => caught);
        expect(billedCostOf(error)).toBeUndefined();
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

    it("identifies output exhaustion without exposing provider text", async () => {
        const harness = deps({
            complete: vi
                .fn()
                .mockRejectedValue(
                    new Error(
                        "OpenRouter reached the output token limit for google/gemini-3.8-flash.",
                    ),
                ),
        });
        await expect(
            executeWorkflowLlmInvocation(invocation, harness),
        ).rejects.toThrow("output_limit");
        expect(harness.appendAttempts).toHaveBeenCalledWith("cell-1", [
            expect.objectContaining({ errorClass: "output_limit" }),
        ]);
    });

    it("keeps the provider's message without the keys it echoes", async () => {
        const harness = deps({
            complete: vi
                .fn()
                .mockRejectedValue(
                    new Error(
                        "provider echoed workflow-secret and Authorization: Bearer sk-or-abcdefgh12345678",
                    ),
                ),
        });

        const error = await executeWorkflowLlmInvocation(
            invocation,
            harness,
        ).catch((failure: unknown) => failure);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(
            "Workflow LLM invocation failed (authentication): provider echoed [REDACTED] and Authorization: [REDACTED]",
        );
        expect((error as Error).message).not.toContain("sk-or-");
        // Attempts keep only the error class.
        expect(
            JSON.stringify(vi.mocked(harness.appendAttempts).mock.calls),
        ).not.toContain("provider echoed");
    });

    it("keeps an OpenRouter 404 so the step result says why", async () => {
        const providerMessage =
            "404 No allowed providers are available for the selected model. The provider.only preference permits only: acme-host.";
        const harness = deps({
            complete: vi.fn().mockRejectedValue(new Error(providerMessage)),
        });

        const error = await executeWorkflowLlmInvocation(
            invocation,
            harness,
        ).catch((failure: unknown) => failure);

        expect((error as Error).message).toBe(
            `Workflow LLM invocation failed (provider_error): ${providerMessage}`,
        );
    });

    it("caps a long provider message", async () => {
        const harness = deps({
            complete: vi
                .fn()
                .mockRejectedValue(
                    new Error(`upstream said ${"x".repeat(5000)}`),
                ),
        });

        const error = await executeWorkflowLlmInvocation(
            invocation,
            harness,
        ).catch((failure: unknown) => failure);

        const message = (error as Error).message;
        expect(message.startsWith("Workflow LLM invocation failed (")).toBe(
            true,
        );
        expect(message.length).toBeLessThan(1_100);
        expect(message.endsWith("…")).toBe(true);
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

    it("sends the run's data rules with the call", async () => {
        const dataPolicy = {
            onlyHosts: ["google-vertex"],
            disallowPromptTraining: true,
        };
        const harness = deps();

        await executeWorkflowLlmInvocation(
            withReuse({ ...invocation, dataPolicy }),
            harness,
        );

        expect(harness.readReuse).toHaveBeenCalledOnce();
        expect(harness.complete).toHaveBeenCalledWith(
            expect.objectContaining({
                request: expect.objectContaining({ dataPolicy }),
            }),
        );
    });

    describe("stored results under data rules", () => {
        /** Runs `input` against a shared store of published results. */
        async function runWith(
            store: Map<string, IStoredReuse>,
            input: IWorkflowLlmInvocationInput,
        ) {
            const harness = deps({
                readReuse: vi.fn(async ({ fingerprint }) => {
                    const saved = store.get(fingerprint);
                    return saved
                        ? {
                              artifact: saved.artifact,
                              artifactDigest: saved.artifactDigest,
                              originProvenance:
                                  saved.provenance as IWorkflowLlmExecutionProvenance,
                          }
                        : undefined;
                }),
                publishReuse: vi.fn(async (value) => {
                    if (!store.has(value.fingerprint))
                        store.set(value.fingerprint, value);
                }),
            });
            await executeWorkflowLlmInvocation(withReuse(input), harness);
            return harness;
        }

        it("reuses a result stored under the same rules, hosts in any order", async () => {
            const store = new Map<string, IStoredReuse>();
            await runWith(store, {
                ...invocation,
                dataPolicy: {
                    onlyHosts: ["google-vertex", "anthropic"],
                    zeroDataRetention: true,
                },
            });
            const second = await runWith(store, {
                ...invocation,
                dataPolicy: {
                    onlyHosts: ["anthropic", "google-vertex"],
                    zeroDataRetention: true,
                    disallowPromptTraining: false,
                },
            });

            expect(second.complete).not.toHaveBeenCalled();
        });

        it("calls afresh under other hosts", async () => {
            const store = new Map<string, IStoredReuse>();
            await runWith(store, {
                ...invocation,
                dataPolicy: { onlyHosts: ["google-vertex", "openai"] },
            });
            const second = await runWith(store, {
                ...invocation,
                dataPolicy: { onlyHosts: ["google-vertex"] },
            });

            expect(second.complete).toHaveBeenCalledOnce();
        });

        it("calls afresh under rules when the stored result had none", async () => {
            const store = new Map<string, IStoredReuse>();
            await runWith(store, invocation);
            const second = await runWith(store, {
                ...invocation,
                dataPolicy: { zeroDataRetention: true },
            });

            expect(second.complete).toHaveBeenCalledOnce();
        });

        it("still serves calls without rules, as before", async () => {
            const store = new Map<string, IStoredReuse>();
            await runWith(store, {
                ...invocation,
                dataPolicy: { onlyHosts: ["google-vertex"] },
            });
            const second = await runWith(store, invocation);

            expect(store.size).toBe(2);
            expect(second.complete).not.toHaveBeenCalled();
        });

        it("keeps the fingerprint of a call without rules unchanged", () => {
            const open = workflowLlmFingerprint(invocation);
            const empty = workflowLlmFingerprint({
                ...invocation,
                dataPolicy: { onlyHosts: [] },
            });
            const ruled = workflowLlmFingerprint({
                ...invocation,
                dataPolicy: { onlyHosts: ["google-vertex"] },
            });

            expect(empty).toEqual(open);
            expect(open.openFingerprint).toBeUndefined();
            expect(ruled.fingerprint).not.toBe(open.fingerprint);
            expect(ruled.openFingerprint).toBe(open.fingerprint);
        });
    });

    it("sends a Bifrost step's own model id under the rules and prices an unreported cost at list price", async () => {
        const dataPolicy = { onlyHosts: ["google-vertex"] };
        const harness = deps({
            resolveCredential: vi.fn().mockResolvedValue({
                apiKey: "workflow-secret",
                baseUrl: "https://gateway.example.test",
            }),
            complete: vi.fn().mockResolvedValue({
                ...completion,
                actualRoute: {
                    status: "unresolved",
                    transport: "bifrost",
                    modelId: "openai/gpt-4o",
                    evidenceCompleteness: "partial",
                },
            }),
        });
        const result = await executeWorkflowLlmInvocation(
            {
                ...invocation,
                execution: {
                    ...execution,
                    route: {
                        ...execution.route,
                        transportConfig: {
                            transport: "bifrost",
                            upstreamPolicy: { mode: "bifrost_default" },
                        },
                    },
                    capability: {
                        ...execution.capability,
                        transport: {
                            ...execution.capability.transport,
                            transport: "bifrost",
                            transportModelId: "openrouter/openai/gpt-4o",
                        },
                    },
                },
                pricing: {
                    promptPricePerToken: 0.000001,
                    completionPricePerToken: 0.000002,
                },
                dataPolicy,
            },
            harness,
        );
        expect(harness.complete).toHaveBeenCalledWith(
            expect.objectContaining({
                transport: "bifrost",
                transportModelId: "openrouter/openai/gpt-4o",
                apiKeys: {
                    bifrost: "workflow-secret",
                    bifrostBaseUrl: "https://gateway.example.test",
                },
                request: expect.objectContaining({ dataPolicy }),
            }),
        );
        expect(result.artifact.executionProvenance?.currentCost).toMatchObject({
            source: "catalog_estimate",
        });
        expect(result.costUsd).toBeCloseTo((10 * 1 + 3 * 2) / 1_000_000, 12);
    });

    it.each([
        ["bifrost_list_price", 0.0042],
        ["provider_reported", 0.0031],
    ] as const)(
        "keeps a Bifrost call's %s cost over the registry's list price",
        async (source, usd) => {
            const harness = deps({
                complete: vi.fn().mockResolvedValue({
                    ...completion,
                    cost: { usd, source },
                }),
            });
            const result = await executeWorkflowLlmInvocation(
                {
                    ...invocation,
                    pricing: {
                        promptPricePerToken: 0.000001,
                        completionPricePerToken: 0.000002,
                    },
                },
                harness,
            );
            expect(result.artifact.executionProvenance?.currentCost).toEqual({
                usd,
                source,
            });
            expect(result.costUsd).toBe(usd);
        },
    );

    it("keeps whether the step's thinking level was sent, and its thinking tokens", async () => {
        const harness = deps({
            complete: vi.fn().mockResolvedValue({
                ...completion,
                usage: { ...completion.usage, reasoningTokens: 7 },
                thinking: {
                    requested: "high",
                    sent: false,
                    reason: "No thinking setting on this route.",
                },
            }),
        });
        const result = await executeWorkflowLlmInvocation(invocation, harness);
        expect(result.artifact.thinking).toEqual({
            requested: "high",
            sent: false,
            reason: "No thinking setting on this route.",
        });
        expect(result.artifact.usage?.thinkingTokens).toBe(7);
    });

    it("keeps the call's warnings with the step's answer", async () => {
        const warning =
            "The output limit (16,384 tokens) is more than openrouter/acme/short-1 can give.";
        const harness = deps({
            complete: vi
                .fn()
                .mockResolvedValue({ ...completion, warnings: [warning] }),
        });
        const result = await executeWorkflowLlmInvocation(invocation, harness);
        expect(result.artifact.warnings).toEqual([warning]);
    });

    describe("output modes", () => {
        const schema = {
            name: "output",
            strict: true,
            schema: {
                type: "object",
                properties: { title: { type: "string" } },
                required: ["title"],
                additionalProperties: false,
            },
        };

        it("asks for any JSON object in JSON mode and checks the schema after", async () => {
            const harness = deps({
                complete: vi.fn().mockResolvedValue({
                    ...completion,
                    text: '{"title":"Quarterly review"}',
                }),
            });
            const result = await executeWorkflowLlmInvocation(
                {
                    ...invocation,
                    responseSchema: schema,
                    outputMode: "json_object",
                },
                harness,
            );
            const [call] = vi.mocked(harness.complete).mock.calls[0]!;
            expect(call.request.jsonMode).toBe(true);
            expect(call.request).not.toHaveProperty("responseSchema");
            expect(result.artifact.json).toEqual({ title: "Quarterly review" });
        });

        it("reads the JSON object out of a fenced text reply", async () => {
            const harness = deps({
                complete: vi.fn().mockResolvedValue({
                    ...completion,
                    text: 'Here it is:\n```json\n{"title":"Plan"}\n```',
                }),
            });
            const result = await executeWorkflowLlmInvocation(
                { ...invocation, responseSchema: schema, outputMode: "text" },
                harness,
            );
            const [call] = vi.mocked(harness.complete).mock.calls[0]!;
            expect(call.request).not.toHaveProperty("jsonMode");
            expect(call.request).not.toHaveProperty("responseSchema");
            expect(result.artifact.json).toEqual({ title: "Plan" });
        });

        it("records why a loose reply failed", async () => {
            const noJson = deps({
                complete: vi.fn().mockResolvedValue({
                    ...completion,
                    text: "I could not do it.",
                }),
            });
            await expect(
                executeWorkflowLlmInvocation(
                    {
                        ...invocation,
                        responseSchema: schema,
                        outputMode: "text",
                    },
                    noJson,
                ),
            ).rejects.toThrow(
                "The step's answer could not be read as JSON (text mode): No JSON object was found in the reply.",
            );
            const wrongShape = deps({
                complete: vi.fn().mockResolvedValue({
                    ...completion,
                    text: '{"name":"x"}',
                }),
            });
            await expect(
                executeWorkflowLlmInvocation(
                    {
                        ...invocation,
                        responseSchema: schema,
                        outputMode: "json_object",
                    },
                    wrongShape,
                ),
            ).rejects.toThrow(/doesn't match its output schema/);
            expect(wrongShape.publishReuse).not.toHaveBeenCalled();
        });
    });

    it("sends no data rules when none is set", async () => {
        const harness = deps();

        await executeWorkflowLlmInvocation(
            { ...invocation, dataPolicy: { onlyHosts: [] } },
            harness,
        );

        const [call] = vi.mocked(harness.complete).mock.calls[0]!;
        expect(call.request).not.toHaveProperty("dataPolicy");
    });

    it("calls a maker directly with its own model id and the Settings key", async () => {
        const direct: IWorkflowLlmResolvedExecution = {
            ...execution,
            requestedSelection: { mode: "simple", transport: "anthropic" },
            route: {
                ...execution.route,
                modelId: "anthropic/claude-sonnet-4.6",
                transportConfig: { transport: "anthropic" },
                generation: { maxOutputTokens: 512, reasoningEffort: "low" },
            },
            capability: {
                ...execution.capability,
                transport: {
                    transport: "anthropic",
                    modelId: "anthropic/claude-sonnet-4.6",
                    transportModelId: "claude-sonnet-4-6",
                    upstreamRoutingModes: ["none"],
                    supportedGenerationControls: [
                        "maxOutputTokens",
                        "reasoningEffort",
                    ],
                    supportsStructuredOutput: true,
                    requiresCurrentDiscovery: false,
                },
                supportedUpstreamProviders: undefined,
            },
        };
        const harness = deps({
            resolveCredential: vi
                .fn()
                .mockResolvedValue({ apiKey: "maker-secret" }),
            complete: vi.fn().mockResolvedValue({
                ...completion,
                actualRoute: {
                    status: "resolved",
                    transport: "anthropic",
                    modelId: "claude-sonnet-4-6",
                    upstreamProvider: "anthropic",
                    generationId: "msg-1",
                    evidenceCompleteness: "complete",
                },
                providerMetadata: { servedBy: "anthropic" },
            } satisfies CompletionResult),
        });

        const result = await executeWorkflowLlmInvocation(
            {
                ...invocation,
                execution: direct,
                dataPolicy: { onlyHosts: ["anthropic"] },
            },
            harness,
        );

        expect(harness.complete).toHaveBeenCalledExactlyOnceWith({
            transport: "anthropic",
            transportModelId: "claude-sonnet-4-6",
            apiKeys: { anthropic: "maker-secret" },
            request: expect.objectContaining({
                model: "anthropic/claude-sonnet-4.6",
                reasoningEffort: "low",
                dataPolicy: { onlyHosts: ["anthropic"] },
                route: {
                    transport: "anthropic",
                    transportModelId: "claude-sonnet-4-6",
                    upstreamPolicy: { mode: "none" },
                },
            }),
        });
        expect(result.artifact.executionProvenance?.actual).toEqual({
            status: "resolved",
            identity: {
                transport: "anthropic",
                modelId: "claude-sonnet-4-6",
                upstreamProvider: "anthropic",
            },
            generationId: "msg-1",
            evidenceCompleteness: "complete",
        });
        expect(harness.appendAttempts).toHaveBeenCalledWith(
            "cell-1",
            [
                expect.objectContaining({
                    requested: {
                        transport: "anthropic",
                        modelId: "anthropic/claude-sonnet-4.6",
                    },
                }),
            ],
            { generationId: "msg-1", upstreamProvider: "anthropic" },
        );
        expect(JSON.stringify(result)).not.toContain("maker-secret");
    });

    it("sends the Gemini key as the Gemini API key", async () => {
        const harness = deps({
            resolveCredential: vi
                .fn()
                .mockResolvedValue({ apiKey: "gemini-secret" }),
        });

        await executeWorkflowLlmInvocation(
            {
                ...invocation,
                execution: {
                    ...execution,
                    route: {
                        ...execution.route,
                        modelId: "google/gemma-4-31b-it",
                        transportConfig: { transport: "google" },
                    },
                    capability: {
                        ...execution.capability,
                        transport: {
                            ...execution.capability.transport,
                            transport: "google",
                            transportModelId: "gemma-4-31b-it",
                            upstreamRoutingModes: ["none"],
                        },
                    },
                },
            },
            harness,
        );

        expect(harness.complete).toHaveBeenCalledWith(
            expect.objectContaining({
                transport: "google",
                transportModelId: "gemma-4-31b-it",
                apiKeys: { google: "gemini-secret" },
            }),
        );
    });

    it("gives a direct maker call a slot on that maker's provider limit", async () => {
        limiter.complete.mockResolvedValue(completion);
        limiter.getLimitedEvalProvider.mockReturnValue({
            complete: limiter.complete,
        });
        const request = {
            model: "google/gemini-3-flash",
            prompt: "Hi",
            maxTokens: 10,
        };

        await completeWithProviderLimit({
            transport: "google",
            transportModelId: "gemini-3-flash-preview",
            apiKeys: { google: "key" },
            request,
        });
        expect(limiter.getLimitedEvalProvider).toHaveBeenCalledWith(
            { google: "key" },
            {
                transport: "google",
                exactTransportModelId: "gemini-3-flash-preview",
                gatewayFallbackModels: [],
            },
        );
    });

    it("waits for a provider slot before sending a call", async () => {
        limiter.complete.mockResolvedValue(completion);
        limiter.getLimitedEvalProvider.mockReturnValue({
            complete: limiter.complete,
        });
        const request = { model: "gpt-4o", prompt: "Hi", maxTokens: 10 };

        await expect(
            completeWithProviderLimit({
                transport: "openrouter",
                transportModelId: "openai/gpt-4o",
                apiKeys: { openrouter: "key" },
                request,
            }),
        ).resolves.toBe(completion);
        expect(limiter.getLimitedEvalProvider).toHaveBeenCalledWith(
            { openrouter: "key" },
            {
                transport: "openrouter",
                exactTransportModelId: "openai/gpt-4o",
                gatewayFallbackModels: [],
            },
        );
        expect(limiter.complete).toHaveBeenCalledWith(request);
    });
});

describe("workflow step keys from the server's .env", () => {
    const env = {
        BIFROST_API_KEY: "env-bifrost-key",
        BIFROST_BASE_URL: "https://bifrost.example/v1",
    };

    it("uses the env Bifrost key and address for a step set up with them", () => {
        expect(envWorkflowCredential("bifrost", env)).toEqual({
            apiKey: "env-bifrost-key",
            baseUrl: "https://bifrost.example/v1",
        });
    });

    it("uses the env Vercel AI Gateway key, with no address, for a gateway step", () => {
        expect(
            envWorkflowCredential("gateway", {
                AI_GATEWAY_API_KEY: " env-gateway-key ",
            }),
        ).toEqual({ apiKey: "env-gateway-key" });
    });

    it("says in plain words when the env key is gone", () => {
        expect(() =>
            envWorkflowCredential("bifrost", { BIFROST_API_KEY: "" }),
        ).toThrow(
            "This step was set up with the Bifrost key from the server's .env (BIFROST_API_KEY and BIFROST_BASE_URL), which is no longer set. Set it again, or save a Bifrost key in Settings and start a new run.",
        );
        expect(() =>
            envWorkflowCredential("bifrost", {
                BIFROST_API_KEY: "env-bifrost-key",
            }),
        ).toThrow(/BIFROST_BASE_URL\), which is no longer set/);
        expect(() => envWorkflowCredential("gateway", env)).toThrow(
            "This step was set up with the Vercel AI Gateway key from the server's .env (AI_GATEWAY_API_KEY), which is no longer set. Set it again, or save a Vercel AI Gateway key in Settings and start a new run.",
        );
    });

    it("refuses an env key for a provider whose steps can't use one", () => {
        expect(() =>
            envWorkflowCredential("openrouter", {
                ...env,
                OPENROUTER_API_KEY: "env-openrouter-key",
            }),
        ).toThrow(/openrouter steps can't use/);
    });

    it("never gives a saved key the env address", () => {
        expect(() => savedKeyBaseUrl("bifrost", null)).toThrow(/no base URL/);
        expect(savedKeyBaseUrl("bifrost", "https://saved.example/v1")).toEqual({
            baseUrl: "https://saved.example/v1",
        });
        expect(savedKeyBaseUrl("openrouter", null)).toEqual({});
    });
});
