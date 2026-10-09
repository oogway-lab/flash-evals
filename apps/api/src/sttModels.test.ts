import { describe, expect, it } from "vitest";
import { resolveApiFeatureFlags } from "./featureFlags.js";
import {
    STT_STANDARD_CONFIG_FIELDS,
    parseSttMetricsModelId,
    sttConfigFieldsForModelId,
    sttMetricsModelId,
    sttModelIdentityForId,
} from "@mosaic/api-contract";
import type { IApiConfig } from "./config.js";
import {
    invalidSttConfigMessages,
    resolveSttModelDefinition,
    sttModelOptions,
    unsupportedSttConfigKeys,
} from "./sttModels.js";

function config(overrides: Partial<IApiConfig> = {}): IApiConfig {
    return {
        nodeEnv: "test",
        port: 3001,
        databaseUrl: "postgres://test",
        storageAdapter: "local",
        supabaseUrl: "",
        supabaseServiceRoleKey: "",
        supabaseStorageBucket: "",
        clerkSecretKey: "clerk-secret",
        mosaicTenancyMode: "single-org",
        mosaicAllowedEmailDomain: "example.com",
        corsOrigins: [],
        mosaicLlmProvider: "auto",
        sttCapabilityProbes: {},
        profilingEnabled: false,
        featureFlags: resolveApiFeatureFlags({}),
        ...overrides,
    };
}

describe("sttModelOptions", () => {
    it("marks direct OpenAI transcription models runnable when OPENAI_API_KEY exists", () => {
        const models = sttModelOptions(config({ openaiApiKey: "sk-test" }));

        expect(models).toContainEqual(
            expect.objectContaining({
                id: "gpt-4o-mini-transcribe",
                providerId: "openai",
                availabilityStatus: "available",
                available: true,
                configFields: expect.arrayContaining([
                    expect.objectContaining({ key: "language" }),
                    expect.objectContaining({ key: "prompt" }),
                ]),
            }),
        );
        expect(models).toContainEqual(
            expect.objectContaining({
                id: "whisper-1",
                providerId: "openai",
                availabilityStatus: "available",
                available: true,
                configFields: expect.arrayContaining([
                    expect.objectContaining({
                        key: "timestampGranularity",
                        kind: "select",
                    }),
                ]),
            }),
        );
    });

    it("marks Soniox async transcription runnable when SONIOX_API_KEY exists", () => {
        const models = sttModelOptions(config({ sonioxApiKey: "soniox-test" }));

        expect(models).toContainEqual(
            expect.objectContaining({
                id: "soniox:stt-async-v5",
                providerId: "soniox",
                routeId: "soniox-async-file-transcription",
                availabilityStatus: "available",
                available: true,
                configFields: expect.arrayContaining([
                    expect.objectContaining({ key: "language" }),
                    expect.objectContaining({ key: "context" }),
                    expect.objectContaining({ key: "diarization" }),
                ]),
            }),
        );
    });

    it("keeps configured-but-unverified OpenRouter and Bifrost routes disabled", () => {
        const models = sttModelOptions(
            config({
                openrouterApiKey: "openrouter-test",
                bifrostApiKey: "bifrost-test",
            }),
        );

        expect(models).toContainEqual(
            expect.objectContaining({
                id: "openrouter:whisper-large-v3-turbo",
                providerId: "openrouter",
                availabilityStatus: "unverified_route",
                available: false,
            }),
        );
        expect(models).toContainEqual(
            expect.objectContaining({
                id: "bifrost:whisper-large-v3-turbo",
                providerId: "bifrost",
                availabilityStatus: "unverified_route",
                available: false,
            }),
        );
    });

    it("keeps Vercel Gateway STT disabled until beta route access is verified", () => {
        const models = sttModelOptions(config({ aiGatewayApiKey: "vck-test" }));

        expect(models).toContainEqual(
            expect.objectContaining({
                id: "vercel:openai/gpt-4o-transcribe",
                providerId: "vercel-gateway",
                routeId: "vercel-ai-gateway-stt",
                availabilityStatus: "unverified_route",
                available: false,
                configFields: [],
            }),
        );
        expect(models).toContainEqual(
            expect.objectContaining({
                id: "vercel:openai/whisper-1",
                providerId: "vercel-gateway",
                routeId: "vercel-ai-gateway-stt",
                availabilityStatus: "unverified_route",
                available: false,
                configFields: expect.arrayContaining([
                    expect.objectContaining({
                        key: "timestampGranularity",
                        kind: "select",
                    }),
                ]),
            }),
        );
    });

    it("allows capability probes to enable verified Vercel Gateway STT routes", () => {
        const models = sttModelOptions(
            config({ aiGatewayApiKey: "vck-test" }),
            {
                "vercel:openai/whisper-1": {
                    status: "available",
                },
            },
        );

        expect(models).toContainEqual(
            expect.objectContaining({
                id: "vercel:openai/whisper-1",
                availabilityStatus: "available",
                available: true,
            }),
        );
    });

    it("enables implemented probe-gated routes after a successful probe", () => {
        const models = sttModelOptions(
            config({ openrouterApiKey: "openrouter-test" }),
            {
                "openrouter:whisper-large-v3-turbo": {
                    status: "available",
                },
            },
        );

        expect(models).toContainEqual(
            expect.objectContaining({
                id: "openrouter:whisper-large-v3-turbo",
                availabilityStatus: "available",
                available: true,
            }),
        );
    });

    it("represents direct Gemini routes honestly", () => {
        const models = sttModelOptions(config());

        expect(models).toContainEqual(
            expect.objectContaining({
                id: "gemini:gemini-2.5-flash-lite",
                providerId: "gemini",
                outputKind: "audio_understanding_transcript",
                availabilityStatus: "missing_key",
                available: false,
                configFields: expect.arrayContaining([
                    expect.objectContaining({ key: "language" }),
                    expect.objectContaining({ key: "prompt" }),
                    expect.objectContaining({
                        key: "temperature",
                        kind: "number",
                    }),
                    expect.objectContaining({
                        key: "thinking",
                        kind: "select",
                    }),
                ]),
            }),
        );
    });

    it("surfaces provider probe failures without crashing setup", () => {
        const models = sttModelOptions(
            config({ sonioxApiKey: "soniox-test" }),
            {
                "soniox:stt-async-v5": {
                    status: "provider_error",
                    reason: "Soniox API rejected the probe.",
                },
            },
        );

        expect(models).toContainEqual(
            expect.objectContaining({
                id: "soniox:stt-async-v5",
                availabilityStatus: "provider_error",
                available: false,
                unavailableReason: "Soniox API rejected the probe.",
            }),
        );
    });

    it("keeps missing keys disabled even if a stale probe says available", () => {
        const models = sttModelOptions(config(), {
            "soniox:stt-async-v5": { status: "available" },
        });

        expect(models).toContainEqual(
            expect.objectContaining({
                id: "soniox:stt-async-v5",
                availabilityStatus: "missing_key",
                available: false,
            }),
        );
    });
});

describe("STT variant contract", () => {
    it("round-trips variant-aware and legacy synthetic model ids", () => {
        const variantId = sttMetricsModelId("soniox:stt-async-v5", "v2");

        expect(variantId).toBe("stt:soniox:stt-async-v5#v2");
        expect(parseSttMetricsModelId(variantId)).toEqual({
            modelId: "soniox:stt-async-v5",
            variantKey: "v2",
        });
        expect(parseSttMetricsModelId("stt:soniox:stt-async-v5")).toEqual({
            modelId: "soniox:stt-async-v5",
            variantKey: undefined,
        });
    });

    it("exposes keywords only for context or initial-prompt models", () => {
        expect(
            sttConfigFieldsForModelId("soniox:stt-async-v5").map(
                (field) => field.key,
            ),
        ).toContain("keywords");
        expect(
            sttConfigFieldsForModelId("openai:gpt-4o-transcribe").map(
                (field) => field.key,
            ),
        ).toContain("keywords");
        expect(
            sttConfigFieldsForModelId("vercel:openai/whisper-1").map(
                (field) => field.key,
            ),
        ).not.toContain("keywords");
    });

    it("wires a thinking-token budget alongside thinking effort", () => {
        const fields = sttConfigFieldsForModelId("gemini:gemini-2.5-flash").map(
            (field) => field.key,
        );

        expect(fields).toContain("thinking");
        expect(fields).toContain("thinkingBudgetTokens");
    });

    it("does not claim prompt support on routes that ignore it", () => {
        expect(
            sttConfigFieldsForModelId("openrouter:whisper-large-v3-turbo").map(
                (field) => field.key,
            ),
        ).toEqual(["language", "timestampGranularity", "temperature"]);
        expect(
            sttConfigFieldsForModelId("openai:gpt-4o-transcribe-diarize").map(
                (field) => field.key,
            ),
        ).toEqual(["language", "temperature"]);
    });

    it("defines the ordered standard STT configuration template", () => {
        expect(STT_STANDARD_CONFIG_FIELDS.map((field) => field.key)).toEqual([
            "language",
            "prompt",
            "context",
            "keywords",
            "diarization",
            "timestampGranularity",
            "temperature",
            "thinking",
            "thinkingBudgetTokens",
        ]);
    });
});

describe("invalidSttConfigMessages", () => {
    it("rejects unsupported Vercel timestamp granularity values", () => {
        expect(
            invalidSttConfigMessages("vercel:openai/whisper-1", {
                timestampGranularity: "character",
            }),
        ).toEqual([
            "Timestamp granularity must be one of the supported options.",
        ]);
    });

    it("validates prompt-driven audio-understanding temperature and thinking fields", () => {
        expect(
            invalidSttConfigMessages("gemini:gemini-2.5-flash", {
                temperature: "0.2",
                thinking: "max",
            }),
        ).toEqual([
            "Temperature must be a finite number.",
            "Thinking effort must be one of the supported options.",
        ]);
        expect(
            invalidSttConfigMessages("gemini:gemini-2.5-flash", {
                temperature: 0.2,
                thinking: "medium",
            }),
        ).toEqual([]);
    });

    it("enforces the verified Gemini thinking-budget ranges", () => {
        expect(
            invalidSttConfigMessages("gemini:gemini-2.5-flash", {
                thinkingBudgetTokens: -1,
            }),
        ).toEqual([]);
        expect(
            invalidSttConfigMessages("gemini:gemini-2.5-flash", {
                thinkingBudgetTokens: 25_000,
            }),
        ).toEqual([
            "Thinking budget (tokens) must be -1, 0, or between 1 and 24576.",
        ]);
        expect(
            invalidSttConfigMessages("gemini:gemini-2.5-flash-lite", {
                thinkingBudgetTokens: 0,
            }),
        ).toEqual(["Thinking budget (tokens) must be between 512 and 24576."]);
    });
});

describe("resolveSttModelDefinition", () => {
    it("accepts legacy and provider-prefixed OpenAI aliases", () => {
        expect(resolveSttModelDefinition("gpt-4o-mini-transcribe")?.id).toBe(
            "gpt-4o-mini-transcribe",
        );
        expect(
            resolveSttModelDefinition("openai:gpt-4o-mini-transcribe")?.id,
        ).toBe("gpt-4o-mini-transcribe");
    });
});

describe("sttModelIdentityForId", () => {
    it("keeps direct Gemini and OpenRouter transcription routes distinct", () => {
        expect(sttModelIdentityForId("gemini:gemini-2.5-flash")).toEqual({
            providerId: "gemini",
            routeId: "gemini-generate-content-audio",
            canonicalModelId: "gemini-2.5-flash",
        });
        expect(
            sttModelIdentityForId("openrouter:whisper-large-v3-turbo"),
        ).toMatchObject({
            providerId: "openrouter",
            routeId: "openrouter-audio-transcriptions",
        });
    });
});

describe("unsupportedSttConfigKeys", () => {
    it("reports config keys that the selected model does not declare", () => {
        expect(
            unsupportedSttConfigKeys("gpt-4o-mini-transcribe", {
                language: "hi",
                prompt: "Names: Acme",
                diarization: true,
            }),
        ).toEqual(["diarization"]);
    });
});

describe("invalidSttConfigMessagesForProviderFields", () => {
    it("rejects config values that do not match the model field type", () => {
        expect(
            invalidSttConfigMessages("soniox:stt-async-v5", {
                context: 42,
                diarization: "true",
            }),
        ).toEqual([
            "Context must be text.",
            "Diarization must be true or false.",
        ]);
    });

    it("allows valid config values for the selected model", () => {
        expect(
            invalidSttConfigMessages("soniox:stt-async-v5", {
                context: "Acme terms",
                diarization: true,
            }),
        ).toEqual([]);
    });
});
