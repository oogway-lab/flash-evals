import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { pickOption } from "@/components/ui/test-utils";
import { PromptWorkbench } from "./prompt-workbench";
import type {
    IPromptJudgeTestActionState,
    IPromptTestRunActionState,
    IPromptWorkbenchState,
} from "@/app/actions";
import type { ReasoningEffort } from "@mosaic/llm-core";

beforeAll(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

const reasoningModel = {
    id: "gpt-5.5",
    label: "GPT-5",
    providerLabel: "OpenAI",
    reasoning: true,
    vision: true,
    available: true,
    structuredOutput: true,
    reasoningEffort: {
        supportedLevels: ["none", "low", "medium", "high", "xhigh"] as const,
        defaultLevel: "medium" as const,
    },
};

const nonReasoningModel = {
    id: "gpt-4o",
    label: "GPT-4o",
    providerLabel: "OpenAI",
    reasoning: false,
    vision: true,
    available: true,
    structuredOutput: true,
};

function resultForInput(
    inputText: string,
    overrides: Partial<{
        targetModelId: string;
        reasoningEffort: ReasoningEffort;
    }> = {},
): IPromptTestRunActionState {
    return {
        ok: true,
        result: {
            status: "success",
            targetModelId: overrides.targetModelId ?? "gpt-5.5",
            reasoningEffort: overrides.reasoningEffort ?? "medium",
            results: [
                {
                    sampleName: "Single input",
                    inputText,
                    status: "success",
                    rawOutput: '{"dish_name":"pasta","calories_estimate":520}',
                    parsedOutput: {
                        dish_name: "pasta",
                        calories_estimate: 520,
                    },
                    validation: { valid: true, errors: [] },
                    usage: {
                        promptTokens: 1000,
                        completionTokens: 200,
                        reasoningTokens: 42,
                        totalTokens: 1200,
                    },
                    latencyMs: 88,
                    costUsd: 0.00325,
                    costSource: "computed",
                },
            ],
        },
    };
}

function renderWorkbench(
    overrides: Partial<Parameters<typeof PromptWorkbench>[0]> = {},
) {
    const testRunAction = vi.fn(async (formData: FormData) =>
        resultForInput(String(formData.get("testInput") ?? ""), {
            targetModelId: String(formData.get("targetModelId") ?? "gpt-5.5"),
            reasoningEffort: (String(formData.get("reasoningEffort") ?? "") ||
                undefined) as ReasoningEffort | undefined,
        }),
    );
    const props = {
        saveAction: vi.fn(async () => ({})),
        optimizeAction: vi.fn(async () => ({})),
        testRunAction,
        judgeTestAction: vi.fn(
            async (
                _formData: FormData,
            ): Promise<IPromptJudgeTestActionState> => ({
                ok: true,
                result: {
                    score: 0.82,
                    rationale: "Matches the reference closely.",
                },
            }),
        ),
        generateSchemaAction: vi.fn(async () => ({})),
        availableModels: [reasoningModel, nonReasoningModel],
        modelsDegraded: false,
        ...overrides,
    };
    return {
        ...render(<PromptWorkbench {...props} />),
        props,
        testRunAction,
    };
}

describe("PromptWorkbench test panel", () => {
    it("asks before leaving once the draft has unsaved edits", () => {
        const { getByLabelText } = renderWorkbench();
        const leave = () => {
            const event = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
        };
        expect(leave()).toBe(false);

        fireEvent.change(getByLabelText("Output schema"), {
            target: { value: '{"type":"object"}' },
        });
        expect(leave()).toBe(true);
    });

    it("keeps the previous result visible but dimmed while a new test runs", async () => {
        const {
            getByRole,
            getByLabelText,
            findAllByText,
            testRunAction,
            container,
        } = renderWorkbench();
        fireEvent.change(getByLabelText("Output schema"), {
            target: { value: '{"type":"object"}' },
        });
        fireEvent.change(getByLabelText("Text"), {
            target: { value: "tomato pasta" },
        });
        fireEvent.click(getByRole("button", { name: /Run test/ }));
        expect((await findAllByText("Success")).length).toBeGreaterThan(0);

        let finish!: (value: Awaited<ReturnType<typeof testRunAction>>) => void;
        testRunAction.mockImplementationOnce(
            () => new Promise((resolve) => (finish = resolve)),
        );
        fireEvent.click(getByRole("button", { name: /Run test/ }));

        expect(
            await findAllByText("Running test…", {
                selector: '[role="status"]',
            }),
        ).toHaveLength(1);
        // the last result is still there, dimmed and busy
        const busy = container.querySelector(
            '[data-slot="stale-region"][aria-busy="true"]',
        );
        expect(busy).toHaveTextContent('"calories_estimate": 520');
        expect(busy).toHaveClass("opacity-60");

        await act(async () => finish(resultForInput("second")));
        expect(
            container.querySelector(
                '[data-slot="stale-region"][aria-busy="true"]',
            ),
        ).toBeNull();
    });

    it("shows elapsed time while generating a schema", async () => {
        vi.useFakeTimers();
        try {
            let finish!: (value: object) => void;
            const generateSchemaAction = vi.fn(
                () => new Promise<object>((resolve) => (finish = resolve)),
            );
            const { getByRole, getAllByRole } = renderWorkbench({
                generateSchemaAction,
            });
            fireEvent.click(
                getByRole("button", { name: /Generate from prompt/ }),
            );
            await act(async () => {
                await vi.advanceTimersByTimeAsync(2_000);
            });
            const status = getAllByRole("status").find((el) =>
                el.textContent?.includes("Generating schema…"),
            );
            expect(status).toHaveTextContent("Generating schema…2s");
            await act(async () => finish({}));
        } finally {
            vi.useRealTimers();
        }
    });

    it("starts in judge mode when linked from the workflow builder", () => {
        const { container, getByText } = renderWorkbench({
            initialKind: "judge",
        });

        expect(
            container.querySelector<HTMLInputElement>('input[name="kind"]')
                ?.value,
        ).toBe("judge");
        expect(getByText("Save judge")).toBeTruthy();
    });

    it("submits the only enabled transport without requiring a selector", async () => {
        const { getByLabelText, getByRole, testRunAction } = renderWorkbench({
            availableModels: [
                { ...nonReasoningModel, transports: ["openrouter"] },
            ],
        });
        fireEvent.change(getByLabelText("Output schema"), {
            target: { value: '{"type":"object"}' },
        });
        fireEvent.change(getByLabelText("Text"), {
            target: { value: "hello" },
        });
        fireEvent.click(getByRole("button", { name: /Run test/ }));
        await waitFor(() => expect(testRunAction).toHaveBeenCalled());
        expect(
            (testRunAction.mock.calls[0]?.[0] as FormData).get("transport"),
        ).toBe("openrouter");
    });

    it("shows transport only for multi-route models and submits the choice", async () => {
        const { getByLabelText, getByRole, testRunAction } = renderWorkbench({
            availableModels: [
                { ...nonReasoningModel, transports: ["openai", "openrouter"] },
            ],
        });
        fireEvent.change(getByLabelText("Output schema"), {
            target: { value: '{"type":"object"}' },
        });
        fireEvent.change(getByLabelText("Text"), {
            target: { value: "hello" },
        });
        const trigger = getByLabelText("Transport for gpt-4o");
        fireEvent.click(trigger);
        pickOption(await screen.findByRole("option", { name: /openrouter/i }));
        fireEvent.click(getByRole("button", { name: /Run test/ }));
        await waitFor(() => expect(testRunAction).toHaveBeenCalled());
        expect(
            (testRunAction.mock.calls[0]?.[0] as FormData).get("transport"),
        ).toBe("openrouter");
    });
    it("runs a test and renders output, validation, tokens, latency, and cost", async () => {
        const { getByRole, getByLabelText, findAllByText, container } =
            renderWorkbench();
        fireEvent.change(getByLabelText("Output schema"), {
            target: { value: '{"type":"object"}' },
        });
        fireEvent.change(getByLabelText("Text"), {
            target: { value: "tomato pasta" },
        });

        fireEvent.click(getByRole("button", { name: /Run test/ }));

        expect((await findAllByText("Success")).length).toBeGreaterThan(0);
        expect(container.textContent).toContain("pasta");
        expect(container.textContent).toContain("reasoning 42");
        expect(container.textContent).toContain("88ms");
        expect(container.textContent).toContain("$0.0032");
        expect(container.textContent).toContain('"calories_estimate": 520');
    });

    it("shows reasoning effort for capable models and hides it for non-reasoning models", () => {
        const { queryByLabelText, unmount } = renderWorkbench({
            availableModels: [reasoningModel],
        });
        expect(queryByLabelText("Reasoning effort")).not.toBeNull();

        unmount();

        const nonReasoning = renderWorkbench({
            availableModels: [nonReasoningModel],
        });
        expect(nonReasoning.queryByLabelText("Reasoning effort")).toBeNull();
    });

    it("scopes prompt model choices by selected model family", async () => {
        const { getByLabelText, getByRole, testRunAction } = renderWorkbench({
            availableModels: [
                {
                    id: "anthropic/claude-sonnet-4.5",
                    label: "Claude Sonnet 4.5",
                    providerLabel: "Claude",
                    reasoning: false,
                    vision: true,
                    available: true,
                    structuredOutput: true,
                },
                {
                    id: "google/gemini-3-pro-preview",
                    label: "Gemini 3 Pro Preview",
                    providerLabel: "Gemini",
                    reasoning: false,
                    vision: true,
                    available: true,
                    structuredOutput: true,
                },
            ],
        });

        fireEvent.change(getByLabelText("Output schema"), {
            target: { value: '{"type":"object"}' },
        });
        const familyTrigger = getByLabelText("Model family");
        fireEvent.click(familyTrigger);
        pickOption(await screen.findByRole("option", { name: "Gemini" }));
        await waitFor(() =>
            expect(familyTrigger.textContent).toContain("Gemini"),
        );

        fireEvent.click(getByRole("button", { name: /Run test/ }));
        await waitFor(() => expect(testRunAction).toHaveBeenCalled());
        const submitted = testRunAction.mock.calls[0][0] as FormData;
        expect(submitted.get("targetModelId")).toBe(
            "google/gemini-3-pro-preview",
        );
    });

    it("preserves an existing target model that is not in the available list", async () => {
        const { getByLabelText, getByRole, testRunAction } = renderWorkbench({
            initialPrompt: {
                promptId: "p1",
                name: "Existing",
                kind: "eval",
                content: "Return JSON.",
                jsonSchema: '{"type":"object"}',
                targetModelId: "ft:gpt-4o-mini:team:custom",
            },
        });

        expect(getByLabelText("Model family").textContent).toContain("Current");
        expect(getByLabelText("Model").textContent).toContain(
            "ft:gpt-4o-mini:team:custom",
        );

        fireEvent.click(getByRole("button", { name: /Run test/ }));
        await waitFor(() => expect(testRunAction).toHaveBeenCalled());
        const submitted = testRunAction.mock.calls[0][0] as FormData;
        expect(submitted.get("targetModelId")).toBe(
            "ft:gpt-4o-mini:team:custom",
        );
    });

    it("does not allow non-structured models in the workbench model dropdown", async () => {
        renderWorkbench({
            availableModels: [
                {
                    id: "meta/llama-4-maverick",
                    label: "Llama 4 Maverick",
                    providerLabel: "Llama",
                    reasoning: false,
                    vision: false,
                    available: true,
                    structuredOutput: false,
                },
            ],
        });

        fireEvent.click(screen.getByLabelText("Model"));
        const option = await screen.findByRole("option", {
            name: /Llama 4 Maverick/,
        });
        expect(option).toHaveAttribute("aria-disabled", "true");
        expect(option).toHaveTextContent("no structured output");
    });

    it("offers image upload for vision models and disables it with a hint for non-vision models", () => {
        const vision = renderWorkbench({
            availableModels: [nonReasoningModel],
        });
        expect(vision.getByText("Image")).toBeTruthy();
        expect(vision.queryByText(/does not support image input/)).toBeNull();
        vision.unmount();

        const textOnly = renderWorkbench({
            availableModels: [
                {
                    id: "text-only",
                    label: "Text Only",
                    reasoning: false,
                    vision: false,
                    available: true,
                    structuredOutput: true,
                },
            ],
        });
        expect(textOnly.getByText(/does not support image input/)).toBeTruthy();
    });

    it("proposes a generated schema and replaces the editor on accept", async () => {
        const generateSchemaAction = vi.fn(async () => ({
            ok: true,
            schema: '{\n  "type": "object"\n}',
        }));
        const { getByRole, findByText, getByLabelText } = renderWorkbench({
            generateSchemaAction,
        });
        fireEvent.change(getByLabelText("Output schema"), {
            target: { value: '{"existing":true}' },
        });

        fireEvent.click(getByRole("button", { name: /Generate from prompt/ }));
        await findByText(/Replace the current schema/);
        fireEvent.click(getByRole("button", { name: "Replace" }));

        expect(generateSchemaAction).toHaveBeenCalled();
        expect(
            (getByLabelText("Output schema") as HTMLTextAreaElement).value,
        ).toContain('"type": "object"');
    });

    it("blocks running with an empty schema and surfaces Generate", async () => {
        const { getByRole, getByLabelText, findByText } = renderWorkbench();
        fireEvent.change(getByLabelText("Output schema"), {
            target: { value: "" },
        });
        fireEvent.click(getByRole("button", { name: /Run test/ }));
        await findByText(/A schema is required to run/);
    });

    it("explains that the schema is the model's return structure, not the dataset answers", () => {
        const { getByText } = renderWorkbench();
        expect(getByText(/the model returns/i)).toBeInTheDocument();
        expect(getByText(/not your answer data/i)).toBeInTheDocument();
    });

    it("keeps an in-session test history annotated with the config behind each run", async () => {
        const { getByRole, getByLabelText, findAllByText, container } =
            renderWorkbench({ availableModels: [reasoningModel] });
        fireEvent.change(getByLabelText("Output schema"), {
            target: { value: '{"type":"object"}' },
        });
        fireEvent.change(getByLabelText("Text"), {
            target: { value: "first run" },
        });
        fireEvent.click(getByRole("button", { name: /Run test/ }));
        await findAllByText("Success");

        // A second run appends another history entry.
        fireEvent.change(getByLabelText("Text"), {
            target: { value: "second run" },
        });
        fireEvent.click(getByRole("button", { name: /Run test/ }));
        await waitFor(() =>
            expect(
                getByText_count(container, "gpt-5.5"),
            ).toBeGreaterThanOrEqual(2),
        );
        expect(container.textContent).toContain("effort:medium");
        expect(container.textContent).toContain("schema v");

        fireEvent.click(getByRole("button", { name: /Clear/ }));
        // Clearing asks first.
        fireEvent.click(
            await screen.findByRole("button", { name: "Clear history" }),
        );
        await waitFor(() =>
            expect(container.textContent).not.toContain("Test history"),
        );
    });

    it("renders no sample-set vocabulary", () => {
        const { queryByText, queryByRole } = renderWorkbench();
        expect(queryByText(/Saved inputs/)).toBeNull();
        expect(queryByText(/Saved sample/)).toBeNull();
        expect(queryByRole("button", { name: /Promote input/ })).toBeNull();
        expect(queryByRole("button", { name: /Run samples/ })).toBeNull();
        expect(
            queryByRole("button", { name: /Run sample and save/ }),
        ).toBeNull();
    });

    it("save and test are separate actions", async () => {
        const saveAction = vi.fn(
            async (_prevState: unknown, _formData: FormData) => ({ ok: true }),
        );
        const { getByRole, getByLabelText, testRunAction } = renderWorkbench({
            saveAction,
        });
        fireEvent.change(getByLabelText("Output schema"), {
            target: { value: '{"type":"object"}' },
        });
        fireEvent.change(getByLabelText("Text"), {
            target: { value: "a plate of tacos" },
        });

        // Running a test does not save.
        fireEvent.click(getByRole("button", { name: /Run test/ }));
        await waitFor(() => expect(testRunAction).toHaveBeenCalled());
        expect(saveAction).not.toHaveBeenCalled();

        // Saving does not require running a test.
        fireEvent.click(getByRole("button", { name: /Save prompt/ }));
        await waitFor(() => expect(saveAction).toHaveBeenCalled());
    });

    it("saves later versions onto the prompt created by the first save", async () => {
        const saveAction = vi.fn(
            async (_prevState: unknown, _formData: FormData) => ({
                ok: true,
                promptId: "prompt-new",
                promptKind: "eval" as const,
                promptVersionId: `pv-${saveAction.mock.calls.length}`,
            }),
        );
        const { getByRole } = renderWorkbench({ saveAction });

        fireEvent.click(getByRole("button", { name: /Save prompt/ }));
        await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(1));
        expect(
            (saveAction.mock.calls[0][1] as FormData).get("promptId"),
        ).toBeNull();

        // The saved prompt's id reaches the form in an effect after the save
        // settles, so wait for it, not just for the button to re-enable.
        await waitFor(() => {
            expect(
                getByRole("button", { name: /Save prompt/ }),
            ).not.toBeDisabled();
            expect(
                document.querySelector('input[name="promptId"]'),
            ).toHaveValue("prompt-new");
        });
        fireEvent.click(getByRole("button", { name: /Save prompt/ }));
        await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(2));
        expect((saveAction.mock.calls[1][1] as FormData).get("promptId")).toBe(
            "prompt-new",
        );
    });

    it("saves a second judge save onto the judge prompt the first created", async () => {
        const saveAction = vi.fn(
            async (_prevState: unknown, _formData: FormData) => ({
                ok: true,
                promptId: "judge-new",
                promptKind: "judge" as const,
                promptVersionId: `pv-${saveAction.mock.calls.length}`,
            }),
        );
        const { getByRole } = renderWorkbench({
            saveAction,
            initialKind: "judge",
        });

        fireEvent.click(getByRole("button", { name: /Save judge/ }));
        await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(1));
        expect(
            (saveAction.mock.calls[0][1] as FormData).get("promptId"),
        ).toBeNull();

        // The saved prompt's id reaches the form in an effect after the save
        // settles, so wait for it, not just for the button to re-enable.
        await waitFor(() => {
            expect(
                getByRole("button", { name: /Save judge/ }),
            ).not.toBeDisabled();
            expect(
                document.querySelector('input[name="promptId"]'),
            ).toHaveValue("judge-new");
        });
        fireEvent.click(getByRole("button", { name: /Save judge/ }));
        await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(2));
        expect((saveAction.mock.calls[1][1] as FormData).get("promptId")).toBe(
            "judge-new",
        );
    });

    it("does not post a judge prompt's id with a later eval save", async () => {
        const saveAction = vi.fn(
            async (_prevState: unknown, _formData: FormData) => ({
                ok: true,
                promptId: "judge-new",
                promptKind: "judge" as const,
                promptVersionId: `pv-${saveAction.mock.calls.length}`,
            }),
        );
        const { getByLabelText, getByRole } = renderWorkbench({
            saveAction,
            initialKind: "judge",
        });

        fireEvent.click(getByRole("button", { name: /Save judge/ }));
        await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(1));

        const kindTrigger = getByLabelText("Kind");
        fireEvent.click(kindTrigger);
        pickOption(await screen.findByRole("option", { name: "Eval" }));
        await waitFor(() =>
            expect(
                getByRole("button", { name: /Save prompt/ }),
            ).not.toBeDisabled(),
        );
        fireEvent.click(getByRole("button", { name: /Save prompt/ }));
        await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(2));
        expect(
            (saveAction.mock.calls[1][1] as FormData).get("promptId"),
        ).toBeNull();
    });

    it("shows the pending label only on the clicked submit button", async () => {
        // Hold each action open so its pending state is observable, then
        // settle it: React entangles in-flight async actions across roots.
        const deferredAction = () => {
            let settle: (value: IPromptWorkbenchState) => void = () => {};
            const action = vi.fn(
                () =>
                    new Promise<IPromptWorkbenchState>((resolve) => {
                        settle = resolve;
                    }),
            );
            return { action, settle: () => settle({}) };
        };

        const save = deferredAction();
        const first = renderWorkbench({ saveAction: save.action });
        try {
            fireEvent.click(first.getByRole("button", { name: /Save prompt/ }));
            expect(
                await first.findByRole("button", { name: /Saving prompt/ }),
            ).toBeDisabled();
            expect(first.queryByText("Optimizing…")).toBeNull();
            expect(first.queryByText("Optimize with AI")).not.toBeNull();
        } finally {
            await act(async () => save.settle());
            first.unmount();
        }

        const optimize = deferredAction();
        const second = renderWorkbench({ optimizeAction: optimize.action });
        try {
            fireEvent.click(
                second.getByRole("button", { name: /^Optimize with AI$/ }),
            );
            expect(
                await second.findByRole("button", { name: /Optimizing/ }),
            ).toBeDisabled();
            expect(second.queryByText("Saving prompt…")).toBeNull();
            expect(second.queryByText("Save prompt")).not.toBeNull();
        } finally {
            await act(async () => optimize.settle());
        }
    });

    it("re-enables Run test and shows an error when the test action rejects", async () => {
        const testRunAction = vi.fn(async (): Promise<never> => {
            throw new Error("network down");
        });
        const { getByLabelText, getByRole, findByRole } = renderWorkbench({
            testRunAction,
        });
        fireEvent.change(getByLabelText("Output schema"), {
            target: { value: '{"type":"object"}' },
        });
        fireEvent.change(getByLabelText("Text"), {
            target: { value: "soup" },
        });

        fireEvent.click(getByRole("button", { name: /Run test/ }));

        expect((await findByRole("alert")).textContent).toMatch(
            /Test run failed/,
        );
        expect(getByRole("button", { name: /Run test/ })).not.toBeDisabled();
    });

    it("re-enables Generate and shows an error when schema generation rejects", async () => {
        const generateSchemaAction = vi.fn(async (): Promise<never> => {
            throw new Error("network down");
        });
        const { getByRole, findByRole } = renderWorkbench({
            generateSchemaAction,
        });

        fireEvent.click(getByRole("button", { name: /Generate from prompt/ }));

        expect((await findByRole("alert")).textContent).toMatch(
            /Could not generate a schema/,
        );
        expect(
            getByRole("button", { name: /Generate from prompt/ }),
        ).not.toBeDisabled();
    });

    it("re-enables Run judge and shows an error when the judge action rejects", async () => {
        const judgeTestAction = vi.fn(async (): Promise<never> => {
            throw new Error("network down");
        });
        const { getByRole, findByRole } = renderWorkbench({
            initialKind: "judge",
            judgeTestAction,
        });

        fireEvent.click(getByRole("button", { name: /Run judge/ }));

        expect((await findByRole("alert")).textContent).toMatch(
            /Judge test failed/,
        );
        expect(getByRole("button", { name: /Run judge/ })).not.toBeDisabled();
    });

    it("seeds the form from an existing prompt for editing", () => {
        const { getByLabelText } = renderWorkbench({
            initialPrompt: {
                promptId: "prompt-1",
                name: "Seeded prompt",
                description: "Seeded description",
                kind: "eval",
                content: "Seeded content",
                jsonSchema: '{"type":"object"}',
                targetModelId: "gpt-4o",
                fitTags: ["extraction"],
            },
        });
        expect((getByLabelText("Name") as HTMLInputElement).value).toBe(
            "Seeded prompt",
        );
        expect(
            (getByLabelText("Description") as HTMLTextAreaElement).value,
        ).toBe("Seeded description");
        expect((getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe(
            "Seeded content",
        );
        expect(
            (getByLabelText("Output schema") as HTMLTextAreaElement).value,
        ).toContain('"type":"object"');
    });

    it("renders a timeout state and preserves draft content", async () => {
        const testRunAction = vi.fn(
            async (): Promise<IPromptTestRunActionState> => ({
                ok: true,
                result: {
                    status: "failed",
                    targetModelId: "gpt-5.5",
                    results: [
                        {
                            sampleName: "Single input",
                            inputText: "slow meal",
                            status: "timeout",
                            validation: { valid: false, errors: [] },
                            latencyMs: 120000,
                            costSource: "unavailable",
                            error: "Timed out",
                        },
                    ],
                },
            }),
        );
        const { getByLabelText, getByRole, findByText } = renderWorkbench({
            testRunAction,
        });
        const prompt = getByLabelText("Prompt") as HTMLTextAreaElement;
        fireEvent.change(prompt, {
            target: { value: "Return JSON only about soup." },
        });
        fireEvent.change(getByLabelText("Output schema"), {
            target: { value: '{"type":"object"}' },
        });
        fireEvent.change(getByLabelText("Text"), {
            target: { value: "soup" },
        });

        fireEvent.click(getByRole("button", { name: /Run test/ }));

        expect(await findByText("Timeout")).toBeInTheDocument();
        expect(await findByText("Timed out")).toBeInTheDocument();
        expect(prompt.value).toBe("Return JSON only about soup.");
    });

    it("reviews an optimized prompt before accepting it for save", async () => {
        const optimizeAction = vi.fn(async () => ({
            ok: true,
            originalPrompt: "Original prompt text",
            optimizedPrompt: "Optimized prompt text",
            optimizationRationale: "Tighter JSON instructions.",
            optimizationGuidanceSource: {
                title: "OpenAI GPT-5 prompting guide",
                url: "https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide",
                retrievedAt: "2026-06-22",
            },
            structuredOutputNotes: ["Return only the JSON object."],
            fitTags: ["structured-output", "extraction"],
            optimizerAttemptId: "opt-1",
            optimizerModelId: "gpt-5.4-mini",
            optimizationTargetModelId: "gpt-5.5",
        }));
        const saveAction = vi.fn(
            async (_prevState: unknown, _formData: FormData) => ({ ok: true }),
        );
        const { getAllByRole, getByLabelText, getByRole, findByText } =
            renderWorkbench({
                optimizeAction,
                saveAction,
            });
        const prompt = getByLabelText("Prompt") as HTMLTextAreaElement;
        fireEvent.change(prompt, {
            target: { value: "Original prompt text" },
        });

        fireEvent.click(
            getAllByRole("button", { name: /^Optimize with AI$/ })[0],
        );

        expect(await findByText("Optimization review")).toBeInTheDocument();
        expect(await findByText("gpt-5.4-mini")).toBeInTheDocument();
        expect(await findByText("gpt-5.5")).toBeInTheDocument();
        expect(prompt.value).toBe("Original prompt text");

        fireEvent.click(getByRole("button", { name: /Use prompt/ }));

        expect(prompt.value).toBe("Optimized prompt text");

        fireEvent.click(getByRole("button", { name: /Save prompt/ }));
        await waitFor(() => expect(saveAction).toHaveBeenCalled());
        const submitted = saveAction.mock.calls[0][1] as FormData;
        expect(submitted.get("optimizerAttemptId")).toBe("opt-1");
        expect(submitted.get("content")).toBe("Optimized prompt text");
        expect(String(submitted.get("fitTags"))).toContain("structured-output");
    });

    it("renders generic optimization guidance without requiring a link", async () => {
        const optimizeAction = vi.fn(async () => ({
            ok: true,
            originalPrompt: "Original prompt text",
            optimizedPrompt: "Optimized prompt text",
            optimizationRationale: "Tighter JSON instructions.",
            optimizationGuidanceSource: {
                title: "Flash Evals generic prompt optimization guidance",
                url: "internal://mosaic/prompt-optimization",
                retrievedAt: "2026-07-08",
            },
            structuredOutputNotes: ["Return only the JSON object."],
            fitTags: ["structured-output", "extraction"],
            optimizerAttemptId: "opt-1",
            optimizerModelId: "gpt-5.4-mini",
            optimizationTargetModelId: "meta/llama-4-maverick",
        }));
        const { getAllByRole, getByLabelText, findByText, queryByRole } =
            renderWorkbench({ optimizeAction });

        fireEvent.change(getByLabelText("Prompt"), {
            target: { value: "Original prompt text" },
        });
        fireEvent.click(
            getAllByRole("button", { name: /^Optimize with AI$/ })[0],
        );

        expect(
            await findByText("Flash Evals generic prompt optimization guidance"),
        ).toBeInTheDocument();
        expect(
            queryByRole("link", {
                name: /Flash Evals generic prompt optimization guidance/,
            }),
        ).toBeNull();
    });

    it("judge mode collects only declared inputs and renders score plus rationale", async () => {
        const judgeTestAction = vi.fn(
            async (
                _formData: FormData,
            ): Promise<IPromptJudgeTestActionState> => ({
                ok: true,
                result: {
                    score: 0.64,
                    rationale: "Candidate missed one reference detail.",
                },
            }),
        );
        const { getByLabelText, getByRole, queryByLabelText, findByText } =
            renderWorkbench({ judgeTestAction });

        const kindTrigger = getByLabelText("Kind");
        fireEvent.click(kindTrigger);
        pickOption(await screen.findByRole("option", { name: "Judge" }));

        expect(getByLabelText("Candidate output")).toBeInTheDocument();
        expect(getByLabelText("Reference output")).toBeInTheDocument();
        expect(queryByLabelText("Task input")).toBeNull();

        fireEvent.click(getByRole("button", { name: /Run judge/ }));

        expect(await findByText("0.64")).toBeInTheDocument();
        expect(
            await findByText("Candidate missed one reference detail."),
        ).toBeInTheDocument();
        const submitted = judgeTestAction.mock.calls[0][0] as FormData;
        expect(submitted.get("judgeDeclaredInputs")).toBe(
            "candidate_output,reference",
        );
        expect(submitted.get("judgeTaskInput")).toBe("");
    });
});

function getByText_count(container: HTMLElement, text: string): number {
    return (container.textContent?.split(text).length ?? 1) - 1;
}
