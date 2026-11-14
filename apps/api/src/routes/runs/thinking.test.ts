import { installBifrostModelInfo } from "@flash-evals/llm-core";
import { describe, expect, it } from "vitest";
import {
    resolveReasoningEffort,
    validateRequestedThinking,
} from "./creation.js";

// Bifrost ids as Bifrost lists them for OpenRouter, each with its registry
// model's default thinking level and a non-default level it takes.
const BIFROST_IDS: Array<[string, string, string]> = [
    ["openrouter/anthropic/claude-sonnet-5.5", "low", "medium"],
    ["openrouter/openai/gpt-6-luna", "medium", "low"],
    ["openrouter/deepseek/deepseek-v4.1-flash", "low", "none"],
    ["openrouter/google/gemini-3.5-flash-lite", "low", "high"],
    ["openrouter/anthropic/claude-haiku-5.5", "low", "none"],
    ["openrouter/anthropic/claude-sonnet-4.6", "low", "medium"],
    ["openrouter/google/gemma-4-31b-it", "none", "medium"],
    ["openrouter/z-ai/glm-5.2", "medium", "low"],
    ["openrouter/minimax/minimax-m3", "medium", "high"],
];

describe("thinking for Bifrost ids", () => {
    it.each(BIFROST_IDS)(
        "%s keeps a chosen level and records its default",
        (modelId, defaultLevel, level) => {
            expect(resolveReasoningEffort(modelId, level as never)).toBe(level);
            expect(resolveReasoningEffort(modelId)).toBe(defaultLevel);
            expect(() =>
                validateRequestedThinking({
                    reasoningConfigs: [
                        {
                            modelId,
                            reasoningConfig: { effort: level as never },
                        },
                    ],
                    transportAssignments: [{ modelId, transport: "bifrost" }],
                }),
            ).not.toThrow();
        },
    );

    it("refuses a level the model behind a Bifrost id doesn't take", () => {
        expect(() =>
            validateRequestedThinking({
                reasoningConfigs: [
                    {
                        modelId: "openrouter/minimax/minimax-m3",
                        reasoningConfig: { effort: "none" },
                    },
                ],
                transportAssignments: [
                    {
                        modelId: "openrouter/minimax/minimax-m3",
                        transport: "bifrost",
                    },
                ],
            }),
        ).toThrow(/takes thinking levels low, medium, high, not "none"/);
    });

    it("checks a registry id against the Bifrost id it is sent as", () => {
        expect(() =>
            validateRequestedThinking({
                reasoningConfigs: [
                    {
                        modelId: "anthropic/claude-sonnet-5.5",
                        reasoningConfig: { effort: "high" },
                    },
                ],
                transportAssignments: [
                    {
                        modelId: "anthropic/claude-sonnet-5.5",
                        transport: "bifrost",
                        transportModelId:
                            "openrouter/anthropic/claude-sonnet-5.5",
                    },
                ],
            }),
        ).not.toThrow();
    });
});

describe("thinking checked against the team's Bifrost list", () => {
    it("refuses a level Bifrost's list says the model can't take", () => {
        const modelId = "openrouter/minimax/minimax-m3";
        installBifrostModelInfo("team-bifrost-list", [
            { id: modelId, reasoning: false },
        ]);
        const request = {
            reasoningConfigs: [
                { modelId, reasoningConfig: { effort: "high" as const } },
            ],
            transportAssignments: [{ modelId, transport: "bifrost" as const }],
        };
        expect(() => validateRequestedThinking(request)).not.toThrow();
        expect(() =>
            validateRequestedThinking(request, {
                bifrostModelList: "team-bifrost-list",
            }),
        ).toThrow(/Bifrost's model list says OpenRouter takes no thinking/);
    });
});

describe("thinking requested for an eval run", () => {
    it("refuses a level the model doesn't take", () => {
        expect(() =>
            validateRequestedThinking({
                reasoningConfigs: [
                    {
                        modelId: "anthropic/claude-opus-5.5",
                        reasoningConfig: { effort: "none" },
                    },
                ],
            }),
        ).toThrow(/takes thinking levels low, medium, high, xhigh, not "none"/);
    });

    it("refuses a chosen level the chosen provider can't send", () => {
        const request = (effort: "high" | "low") => ({
            reasoningConfigs: [
                {
                    modelId: "meta/llama-3.3-70b",
                    reasoningConfig: { effort },
                },
            ],
            transportAssignments: [
                {
                    modelId: "meta/llama-3.3-70b",
                    transport: "gateway" as const,
                },
            ],
        });
        expect(() => validateRequestedThinking(request("high"))).toThrow(
            /"high" thinking for meta\/llama-3.3-70b can't be sent through Vercel AI Gateway/,
        );
        // The model's default level is recorded per call instead.
        expect(() => validateRequestedThinking(request("low"))).not.toThrow();
    });

    it("accepts levels every route can send", () => {
        expect(() =>
            validateRequestedThinking({
                reasoningConfigs: [
                    {
                        modelId: "anthropic/claude-sonnet-4.6",
                        reasoningConfig: { effort: "high" },
                    },
                ],
                transportAssignments: [
                    {
                        modelId: "anthropic/claude-sonnet-4.6",
                        transport: "openrouter",
                    },
                ],
            }),
        ).not.toThrow();
    });
});
