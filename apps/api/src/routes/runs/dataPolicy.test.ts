import { describe, expect, it } from "vitest";
import type { ICreateRunRequest } from "@flash-evals/api-contract";
import {
    assertBifrostIdIsModel,
    judgesOnBifrostRun,
    sttConfigForSnapshot,
    validateRunDataPolicy,
} from "./creation.js";

const base = {
    models: [{ modelId: "google/gemma-4-31b-it", transport: "gateway" }],
} as unknown as ICreateRunRequest;

describe("validateRunDataPolicy", () => {
    it("allows rules when every call runs through a routing gateway", () => {
        expect(() =>
            validateRunDataPolicy({
                ...base,
                dataPolicy: { onlyHosts: ["vertex"], zeroDataRetention: true },
            }),
        ).not.toThrow();
        // No transport: the .env default decides.
        expect(() =>
            validateRunDataPolicy(
                {
                    ...base,
                    models: [{ modelId: "x/y" }],
                    dataPolicy: { zeroDataRetention: true },
                } as unknown as ICreateRunRequest,
                { flashEvalsLlmProvider: "gateway" },
            ),
        ).not.toThrow();
    });

    it("lets a Meta-served gateway model allow only the maker's own host", () => {
        expect(() =>
            validateRunDataPolicy({
                ...base,
                models: [{ modelId: "meta/muse-ember", transport: "gateway" }],
                dataPolicy: { onlyHosts: ["meta"] },
            } as unknown as ICreateRunRequest),
        ).not.toThrow();
    });

    it("rejects a model or judge that would go to OpenAI or Bifrost directly", () => {
        expect(() =>
            validateRunDataPolicy({
                ...base,
                models: [{ modelId: "gpt-4o", transport: "openai" }],
                dataPolicy: { zeroDataRetention: true },
            } as unknown as ICreateRunRequest),
        ).toThrow("gpt-4o must run through Vercel AI Gateway, OpenRouter");
        expect(() =>
            validateRunDataPolicy(
                {
                    ...base,
                    benchmark: { judge: { modelId: "judge-model" } },
                    dataPolicy: { onlyHosts: ["vertex"] },
                } as unknown as ICreateRunRequest,
                { flashEvalsLlmProvider: "auto" },
            ),
        ).toThrow("judge-model must run through");
    });

    it("lets Bifrost models and judges with openrouter/ ids follow the rules", () => {
        const run = (modelId: string, judgeModelId?: string) =>
            validateRunDataPolicy(
                {
                    ...base,
                    models: [{ modelId, transport: "bifrost" }],
                    ...(judgeModelId
                        ? { benchmark: { judge: { modelId: judgeModelId } } }
                        : {}),
                    dataPolicy: { onlyHosts: ["google-vertex"] },
                } as unknown as ICreateRunRequest,
                { flashEvalsLlmProvider: "bifrost" },
            );
        expect(() =>
            run(
                "openrouter/google/gemini-2.5-flash",
                "openrouter/openai/gpt-4o",
            ),
        ).not.toThrow();
        expect(() => run("gemini/gemini-2.5-flash")).toThrow(
            'Bifrost sends gemini/gemini-2.5-flash as "gemini/gemini-2.5-flash" to gemini, not OpenRouter',
        );
        // A registry id goes as its Bifrost id (openai/gpt-4o), not OpenRouter.
        expect(() => run("gpt-4o")).toThrow(/as "openai\/gpt-4o" to openai/);
    });

    it("lets a direct maker call run when the host list names the maker", () => {
        const direct = {
            ...base,
            models: [
                {
                    modelId: "anthropic/claude-sonnet-5.5",
                    transport: "anthropic",
                },
                { modelId: "google/gemma-4-31b-it", transport: "google" },
            ],
        } as unknown as ICreateRunRequest;
        expect(() =>
            validateRunDataPolicy({
                ...direct,
                dataPolicy: { onlyHosts: ["anthropic", "google", "vertex"] },
            }),
        ).not.toThrow();
        expect(() =>
            validateRunDataPolicy({
                ...direct,
                dataPolicy: { onlyHosts: ["anthropic"] },
            }),
        ).toThrow(
            'google/gemma-4-31b-it runs on Gemini API directly, which can only follow an allowed-host list that includes "google"',
        );
        expect(() =>
            validateRunDataPolicy({
                ...direct,
                dataPolicy: {
                    onlyHosts: ["anthropic", "google"],
                    zeroDataRetention: true,
                },
            }),
        ).toThrow("anthropic/claude-sonnet-5.5 runs on Anthropic directly");
    });

    it("rejects bad host names", () => {
        expect(() =>
            validateRunDataPolicy({
                ...base,
                dataPolicy: { onlyHosts: ["Vertex AI"] },
            }),
        ).toThrow('"Vertex AI" is not a host name');
        // Vercel's own names can be mixed case.
        expect(() =>
            validateRunDataPolicy({
                ...base,
                dataPolicy: { onlyHosts: ["vertexAnthropic", "claudeaws"] },
            }),
        ).not.toThrow();
    });
});

describe("pilotItems", () => {
    it("keeps the first N items, or all of them without a limit", async () => {
        const { pilotItems } = await import("./creation.js");
        expect(pilotItems([1, 2, 3], 2)).toEqual([1, 2]);
        expect(pilotItems([1, 2, 3], undefined)).toEqual([1, 2, 3]);
        expect(pilotItems([1, 2], 5)).toEqual([1, 2]);
        expect(() => pilotItems([1], 0)).toThrow("at least 1");
        expect(() => pilotItems([1], 1.5)).toThrow("whole number");
    });
});

describe("judges on an all-Bifrost run", () => {
    it("go through Bifrost unless their provider was chosen", () => {
        const input = {
            models: [
                { modelId: "openrouter/openai/gpt-4o", transport: "bifrost" },
            ],
            runJudge: { modelId: "gpt-4o", rubricPrompt: "x" },
            benchmark: { judge: { modelId: "gpt-4o", transport: "openai" } },
        } as unknown as ICreateRunRequest;
        const prepared = judgesOnBifrostRun(input);
        expect(prepared.runJudge?.transport).toBe("bifrost");
        expect(prepared.benchmark?.judge?.transport).toBe("openai");
        const mixed = {
            ...input,
            models: [...input.models, { modelId: "gpt-4o" }],
        } as unknown as ICreateRunRequest;
        expect(judgesOnBifrostRun(mixed)).toBe(mixed);
    });
});

describe("a Bifrost id picked from Bifrost's list", () => {
    it("must be the run model's own", () => {
        expect(() =>
            assertBifrostIdIsModel({
                modelId: "google/gemini-2.5-flash",
                transport: "bifrost",
                transportModelId: "openrouter/google/gemini-2.5-flash",
            }),
        ).not.toThrow();
        expect(() =>
            assertBifrostIdIsModel({
                modelId: "google/gemini-2.5-flash",
                transport: "bifrost",
                transportModelId: "openrouter/openai/gpt-4o",
            }),
        ).toThrow(
            'Bifrost id "openrouter/openai/gpt-4o" is not google/gemini-2.5-flash',
        );
        expect(() =>
            assertBifrostIdIsModel({
                modelId: "gpt-4o",
                transport: "openai",
                transportModelId: "gpt-4o-x",
            }),
        ).toThrow("can only name its own provider id on Bifrost");
    });

    it("decides whether data rules can be followed", () => {
        expect(() =>
            validateRunDataPolicy({
                models: [
                    {
                        modelId: "gpt-4o",
                        transport: "bifrost",
                        transportModelId: "openrouter/openai/gpt-4o",
                    },
                ],
                dataPolicy: { zeroDataRetention: true },
            } as unknown as ICreateRunRequest),
        ).not.toThrow();
    });

    it("applies the rules to transliteration and the transcript judge", () => {
        const transliteration = (providerMode?: string) => ({
            enabled: true,
            targetScript: "latin",
            modelId: "gpt-4o-mini",
            ...(providerMode ? { providerMode } : {}),
        });
        const run = (
            stt: Partial<ICreateRunRequest>,
            config?: { flashEvalsLlmProvider: "gateway" | "openai" },
        ) =>
            validateRunDataPolicy(
                {
                    ...base,
                    ...stt,
                    dataPolicy: { zeroDataRetention: true },
                } as unknown as ICreateRunRequest,
                config,
            );

        expect(() =>
            run({
                sttConfig: {
                    modelId: "soniox::stt-async-v5",
                    transliteration: transliteration("openai"),
                },
            } as unknown as Partial<ICreateRunRequest>),
        ).toThrow("transliteration model gpt-4o-mini must run through");
        expect(() =>
            run({
                sttEvaluation: { transliteration: transliteration("auto") },
            } as unknown as Partial<ICreateRunRequest>),
        ).toThrow("picks its provider automatically");
        expect(() =>
            run(
                {
                    sttVariants: [
                        {
                            config: {
                                evaluator: {
                                    enabled: true,
                                    modelId: "judge-x",
                                    rubricPrompt: "r",
                                },
                            },
                        },
                    ],
                } as unknown as Partial<ICreateRunRequest>,
                {
                    flashEvalsLlmProvider: "openai",
                },
            ),
        ).toThrow("transcript judge judge-x must run through");
        expect(() =>
            run(
                {
                    sttConfig: {
                        modelId: "soniox::stt-async-v5",
                        transliteration: transliteration("gateway"),
                        evaluator: {
                            enabled: true,
                            modelId: "judge-x",
                            rubricPrompt: "r",
                        },
                    },
                } as unknown as Partial<ICreateRunRequest>,
                {
                    flashEvalsLlmProvider: "gateway",
                },
            ),
        ).not.toThrow();
    });

    it("checks an unset transliteration provider as the snapshot records it", () => {
        const sttConfig = {
            modelId: "soniox::stt-async-v5",
            transliteration: {
                enabled: true,
                targetScript: "latin",
                modelId: "gpt-4o-mini",
            },
        };
        const run = (
            flashEvalsLlmProvider?: "auto" | "vercel-ai" | "gateway",
        ) =>
            validateRunDataPolicy(
                {
                    ...base,
                    sttConfig,
                    dataPolicy: { zeroDataRetention: true },
                } as unknown as ICreateRunRequest,
                flashEvalsLlmProvider ? { flashEvalsLlmProvider } : undefined,
            );
        const recorded = (
            flashEvalsLlmProvider?: "auto" | "vercel-ai" | "gateway",
        ) =>
            sttConfigForSnapshot(
                sttConfig as never,
                flashEvalsLlmProvider
                    ? ({ flashEvalsLlmProvider } as never)
                    : undefined,
            )?.transliteration?.providerMode;

        // No .env default: the run records "auto", which can't follow rules.
        expect(recorded()).toBe("auto");
        expect(() => run()).toThrow("picks its provider automatically");
        expect(() => run("auto")).toThrow("picks its provider automatically");
        // "vercel-ai" is the OpenAI key directly, not the gateway.
        expect(recorded("vercel-ai")).toBe("vercel-ai");
        expect(() => run("vercel-ai")).toThrow(
            "transliteration model gpt-4o-mini must run through",
        );
        expect(recorded("gateway")).toBe("gateway");
        expect(() => run("gateway")).not.toThrow();
    });
});
