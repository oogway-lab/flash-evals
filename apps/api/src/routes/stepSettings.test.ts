import { describe, expect, it } from "vitest";
import type {
    IWorkflowLlmRouteConfig,
    IWorkflowNodeInput,
} from "@flash-evals/api-contract";
import {
    assertStepSettingsSupported,
    simpleGenerationControls,
    withStepSettings,
} from "./workflowRuns.js";
import { ApiBadRequestError, ApiFieldValidationError } from "../errors.js";
import {
    validateInputTemplates,
    validateStepConditions,
    validateStepSettings,
} from "./workflows.js";

const route: IWorkflowLlmRouteConfig = {
    modelId: "gpt-4o",
    generation: { maxOutputTokens: 4096, reasoningEffort: "low" },
    transportConfig: { transport: "openai" },
    structuredOutput: { mode: "text" },
    retry: {
        owner: "flash-evals",
        maxAttempts: 1,
        timeoutMs: 60_000,
        retryableErrorClasses: [],
    },
    cache: { flashEvalsReuse: "force_fresh", providerCaching: "allow" },
};

function node(
    overrides: Partial<IWorkflowNodeInput> & Record<string, unknown>,
): IWorkflowNodeInput {
    return {
        nodeKey: "extract",
        label: "Extract",
        promptVersionId: "00000000-0000-4000-8000-000000000001",
        modelId: "gpt-4o",
        evalConfig: { type: "none" },
        ...overrides,
    } as IWorkflowNodeInput;
}

describe("step settings", () => {
    it("override the route's output limit and add a temperature", () => {
        expect(
            withStepSettings(route, { temperature: 0.2, maxOutputTokens: 900 })
                .generation,
        ).toEqual({
            maxOutputTokens: 900,
            temperature: 0.2,
            reasoningEffort: "low",
        });
        expect(withStepSettings(route, undefined)).toBe(route);
        expect(withStepSettings(route, {}).generation).toEqual(
            route.generation,
        );
    });

    it("are checked when the pipeline is saved", () => {
        expect(() =>
            validateStepSettings(node({ stepSettings: { temperature: 5 } })),
        ).toThrow('Step "Extract" needs a temperature from 0 to 2.');
        expect(() =>
            validateStepSettings(
                node({
                    nodeType: "input",
                    nodeConfig: { type: "input", modality: "text" },
                    stepSettings: { temperature: 1 },
                }),
            ),
        ).toThrow(/only Prompt and LLM text steps/);
        expect(() =>
            validateStepSettings(
                node({ stepSettings: { maxOutputTokens: 1 } }),
            ),
        ).not.toThrow();
    });
});

describe("input templates at save time", () => {
    const nodes = [
        node({ nodeKey: "extract", label: "Extract" }),
        node({ nodeKey: "notes", label: "Notes" }),
        node({
            nodeKey: "write",
            label: "Write",
            stepSettings: {
                inputTemplate:
                    "{{input.transcript}} {{Extract.$ | pick:title}}",
            },
        }),
    ];

    it("accepts a template that reads upstream steps", () => {
        expect(() =>
            validateInputTemplates(nodes, [
                { fromNodeKey: "extract", toNodeKey: "notes" },
                { fromNodeKey: "notes", toNodeKey: "write" },
            ]),
        ).not.toThrow();
    });

    it("refuses one that reads a step that doesn't run before it", () => {
        expect(() =>
            validateInputTemplates(nodes, [
                { fromNodeKey: "notes", toNodeKey: "write" },
            ]),
        ).toThrow(
            'The input template of "Write" reads "Extract", which doesn\'t run before it.',
        );
    });
});

describe("malformed step definitions at save time", () => {
    it("refuse a template or condition that is not text as a bad request", () => {
        expect(() =>
            validateInputTemplates(
                [node({ stepSettings: { inputTemplate: 5 } as never })],
                [],
            ),
        ).toThrow(ApiBadRequestError);
        expect(() =>
            validateStepConditions(
                [
                    node({ nodeKey: "extract", label: "Extract" }),
                    node({
                        nodeKey: "notes",
                        label: "Notes",
                        runCondition: {
                            stepKey: "extract",
                            path: { field: "x" },
                            operator: "equals",
                            values: [true],
                        } as never,
                    }),
                ],
                [{ fromNodeKey: "extract", toNodeKey: "notes" }],
            ),
        ).toThrow(ApiBadRequestError);
    });
});

describe("step temperature against the model", () => {
    it("is refused for a Simple-mode model that takes no temperature", () => {
        const controls = simpleGenerationControls("gpt-5.5", "openai");
        expect(controls).not.toContain("temperature");
        expect(() =>
            assertStepSettingsSupported(
                node({ stepSettings: { temperature: 0.2 } }),
                controls,
            ),
        ).toThrow(/sets a temperature, which its model doesn't take/);
    });

    it("is accepted for a model that takes one, and for models the registry doesn't list", () => {
        const controls = simpleGenerationControls("gpt-4o", "openai");
        expect(controls).toContain("temperature");
        expect(() =>
            assertStepSettingsSupported(
                node({ stepSettings: { temperature: 0.2 } }),
                controls,
            ),
        ).not.toThrow();
        expect(
            simpleGenerationControls("vendor/unlisted-model", "openrouter"),
        ).toContain("temperature");
    });

    it("is refused for a model not listed on the route that is known to refuse sampling", () => {
        // A Bifrost id of an OpenAI reasoning model, and an unlisted Claude 5.
        for (const [modelId, transport] of [
            ["openrouter/openai/gpt-6-luna", "bifrost"],
            ["anthropic/claude-opus-5.9", "openrouter"],
        ] as const)
            expect(simpleGenerationControls(modelId, transport)).not.toContain(
                "temperature",
            );
    });

    it("is refused when a pinned route's captured capability has no temperature", () => {
        expect(() =>
            assertStepSettingsSupported(
                node({ stepSettings: { temperature: 1 } }),
                ["maxOutputTokens", "reasoningEffort"],
            ),
        ).toThrow(ApiFieldValidationError);
        expect(() =>
            assertStepSettingsSupported(
                node({ stepSettings: { maxOutputTokens: 500 } }),
                ["maxOutputTokens"],
            ),
        ).not.toThrow();
    });
});
