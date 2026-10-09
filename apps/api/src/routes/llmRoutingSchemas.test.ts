import { describe, expect, it } from "vitest";
import {
    parseCreateWorkflowLlmRouteForModelRequest,
    parseCreateWorkflowLlmRouteVersionRequest,
    parseSetWorkflowLlmProjectDefaultRequest,
    parseWorkflowLlmRouteCandidate,
    parseWorkflowLlmRouteCandidatesResponse,
} from "./llmRoutingSchemas.js";

const ID = "11111111-1111-4111-8111-111111111111";

describe("LLM routing HTTP schemas", () => {
    it("rejects unknown nested transport controls with a field path", () => {
        expect(() =>
            parseCreateWorkflowLlmRouteVersionRequest({
                projectId: ID,
                name: "OpenRouter exact",
                config: {
                    modelId: "gpt-4o",
                    transportConfig: {
                        transport: "openrouter",
                        upstreamPolicy: { mode: "exact", only: ["openai"] },
                        requireParameters: true,
                        responseCache: "disable",
                        unrecognizedFallback: true,
                    },
                    generation: { maxOutputTokens: 512 },
                    structuredOutput: { mode: "text" },
                    retry: { owner: "gateway", timeoutMs: 30_000 },
                    cache: {
                        mosaicReuse: "allow",
                        providerCaching: "allow",
                    },
                },
            }),
        ).toThrow(/config\.transportConfig\.unrecognizedFallback/);
    });

    it("accepts semantic route creation and updates without opaque dependency IDs", () => {
        const request = {
            projectId: ID,
            name: "Gateway flash lite",
            config: {
                modelId: "google/gemini-2.5-flash-lite",
                transportConfig: {
                    transport: "gateway" as const,
                    upstreamPolicy: { mode: "gateway_auto" as const },
                    modelFallback: "disabled" as const,
                },
                generation: { maxOutputTokens: 128 },
                structuredOutput: { mode: "text" as const },
                retry: {
                    owner: "gateway" as const,
                    timeoutMs: 60_000,
                },
                cache: {
                    mosaicReuse: "allow" as const,
                    providerCaching: "allow" as const,
                },
            },
        };

        expect(parseCreateWorkflowLlmRouteVersionRequest(request)).toEqual(
            request,
        );
        expect(
            parseCreateWorkflowLlmRouteVersionRequest({
                ...request,
                routeId: ID,
            }),
        ).toMatchObject({ routeId: ID });
    });

    it("rejects dependency and authenticated-context fields on semantic route requests", () => {
        const request = {
            projectId: ID,
            name: "Gateway flash lite",
            config: {
                modelId: "google/gemini-2.5-flash-lite",
                transportConfig: {
                    transport: "gateway",
                    upstreamPolicy: { mode: "gateway_auto" },
                    modelFallback: "disabled",
                },
                generation: { maxOutputTokens: 128 },
                structuredOutput: { mode: "text" },
                retry: { owner: "gateway", timeoutMs: 60_000 },
                cache: {
                    mosaicReuse: "allow",
                    providerCaching: "allow",
                },
            },
        };

        for (const forbidden of [
            "providerKeyId",
            "capabilityVersionId",
            "teamId",
            "createdBy",
        ]) {
            expect(() =>
                parseCreateWorkflowLlmRouteVersionRequest({
                    ...request,
                    [forbidden]: ID,
                }),
            ).toThrow(new RegExp(forbidden));
        }
    });

    it("accepts only safe provider-listed route candidate fields", () => {
        const candidate = {
            transport: "gateway",
            modelId: "google/gemini-2.5-flash-lite",
            label: "Gemini 2.5 Flash Lite",
            modelProvider: "google",
            modelProviderLabel: "Google",
            source: "provider_model_listing",
            availability: "provider_listed_candidate",
            requiresMutationDiscovery: true,
            support: {
                upstreamRoutingModes: ["none"],
                supportedGenerationControls: ["maxOutputTokens", "temperature"],
                supportsStructuredOutput: true,
            },
        };

        expect(parseWorkflowLlmRouteCandidate(candidate)).toEqual(candidate);
        expect(() =>
            parseWorkflowLlmRouteCandidate({
                ...candidate,
                providerKeyId: ID,
            }),
        ).toThrow(/providerKeyId/);
        expect(() =>
            parseWorkflowLlmRouteCandidate({
                ...candidate,
                capabilityVersionId: ID,
            }),
        ).toThrow(/capabilityVersionId/);

        expect(
            parseWorkflowLlmRouteCandidatesResponse({
                transport: "gateway",
                coverage: "provider_model_listing",
                candidates: [candidate],
            }),
        ).toMatchObject({
            transport: "gateway",
            coverage: "provider_model_listing",
        });
    });

    it("does not accept clear semantics through the set-default request", () => {
        expect(() =>
            parseSetWorkflowLlmProjectDefaultRequest({
                teamId: ID,
                projectId: ID,
                routeVersionId: null,
                updatedBy: ID,
            }),
        ).toThrow(/routeVersionId/);
    });

    it("accepts node-level controls when creating a provider/model route", () => {
        expect(
            parseCreateWorkflowLlmRouteForModelRequest({
                projectId: ID,
                name: "Gateway flash lite",
                config: {
                    modelId: "google/gemini-2.5-flash-lite",
                    transportConfig: {
                        transport: "gateway",
                        upstreamPolicy: { mode: "gateway_auto" },
                        modelFallback: "disabled",
                    },
                    generation: {
                        maxOutputTokens: 128,
                        temperature: 0,
                        topP: 0.9,
                        seed: 123,
                        reasoningEffort: "low",
                    },
                    structuredOutput: { mode: "text" },
                    retry: { owner: "gateway", timeoutMs: 60_000 },
                    cache: {
                        mosaicReuse: "force_fresh",
                        providerCaching: "allow",
                    },
                },
            }),
        ).toMatchObject({
            config: {
                generation: { maxOutputTokens: 128, seed: 123 },
                retry: { timeoutMs: 60_000 },
                cache: { mosaicReuse: "force_fresh" },
            },
        });
    });
});
