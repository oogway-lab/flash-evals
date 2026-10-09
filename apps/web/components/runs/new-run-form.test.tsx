import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen as rtlScreen,
    waitFor,
} from "@testing-library/react";
import { NewRunForm, type IModelOption } from "./new-run-form";
import { pickOption } from "@/components/ui/test-utils";

beforeAll(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

function modelOption(overrides: Partial<IModelOption>): IModelOption {
    return {
        id: "gpt-4o",
        label: "GPT-4o",
        family: "gpt-4o",
        provider: "openai",
        providerLabel: "OpenAI",
        reasoning: false,
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
        costAvailable: true,
        available: true,
        transports: ["openai"],
        ...overrides,
    };
}

const AVAILABLE: IModelOption[] = [
    modelOption({ id: "gpt-4o", label: "GPT-4o" }),
    modelOption({ id: "gpt-4o-mini", label: "GPT-4o mini" }),
    modelOption({
        id: "gpt-5.5",
        label: "GPT-5.5",
        family: "gpt-5",
        reasoning: true,
        available: false,
        unavailableReason: "Not enabled for your API key",
        disabledReason: "Not enabled for your API key",
    }),
];

function renderForm(overrides: Partial<Parameters<typeof NewRunForm>[0]> = {}) {
    const props = {
        datasets: [
            {
                id: "d1",
                name: "DS",
                itemCount: 10,
                labeledItemCount: 10,
                purpose: "golden" as const,
                modality: "image" as const,
            },
        ],
        bundles: [],
        versionOptions: [
            {
                id: "v1",
                label: "Prompt v1",
                reasoningConfig: { effort: "high" as const },
                fieldConfigs: [
                    {
                        field: "x",
                        kind: "factual" as const,
                        spec: { matcher: "exact" as const },
                    },
                ],
            },
        ],
        availableModels: AVAILABLE,
        modelsDegraded: false,
        sttModels: [
            {
                id: "gpt-4o-mini-transcribe",
                label: "GPT-4o mini Transcribe",
                providerLabel: "OpenAI",
                available: true,
            },
        ],
        hasPrompt: true,
        judgePrompts: [],
        createRunAction: vi.fn(
            async (_prevState: unknown, _formData: FormData) => ({}),
        ),
        generateJudgeAction: vi.fn(async () => ({
            ok: true as const,
            rubricPrompt: "GENERATED RUBRIC",
        })),
        ...overrides,
    };
    const utils = render(<NewRunForm {...props} />);
    const modelsValue = () =>
        (
            utils.container.querySelector(
                'input[name="models"]',
            ) as HTMLInputElement | null
        )?.value ?? "";
    const reasoningConfigsValue = () =>
        JSON.parse(
            (
                utils.container.querySelector(
                    'input[name="reasoningConfigs"]',
                ) as HTMLInputElement | null
            )?.value ?? "[]",
        ) as Array<{
            modelId: string;
            reasoningConfig?: { effort: string };
        }>;
    // A model chip by its model ID, or by the reason it is disabled.
    const chip = (key: string) =>
        Array.from(
            utils.container.querySelectorAll<HTMLButtonElement>(
                "button[data-model-id]",
            ),
        ).find(
            (b) => b.dataset.modelId === key || b.textContent?.includes(key),
        ) ?? null;
    return { ...utils, modelsValue, reasoningConfigsValue, chip, props };
}

describe("NewRunForm model selection", () => {
    it("shows transport only when a selected model has multiple routes", () => {
        const { getByLabelText, queryByLabelText } = renderForm({
            availableModels: [
                modelOption({
                    id: "gpt-4o",
                    transports: ["openai", "openrouter"],
                }),
                modelOption({ id: "gpt-4o-mini", transports: ["openai"] }),
            ],
        });
        expect(getByLabelText("Transport for gpt-4o")).not.toBeNull();
        expect(queryByLabelText("Transport for gpt-4o-mini")).toBeNull();
    });
    it("defaults to gpt-4o + gpt-4o-mini and reflects the count", () => {
        const { modelsValue, container } = renderForm();
        expect(modelsValue()).toBe("gpt-4o\ngpt-4o-mini");
        expect(container.textContent).toContain("× 2 models");
    });

    it("filters visible Gateway models by selected model family and preserves provider ids", async () => {
        const { modelsValue, container, getByLabelText, chip } = renderForm({
            availableModels: [
                modelOption({
                    id: "anthropic/claude-sonnet-4.5",
                    label: "Claude Sonnet 4.5",
                    family: "claude-sonnet",
                    provider: "anthropic",
                    providerLabel: "Claude",
                    costAvailable: false,
                }),
                modelOption({
                    id: "google/gemini-2.5-pro",
                    label: "Gemini 2.5 Pro",
                    family: "gemini",
                    provider: "google",
                    providerLabel: "Gemini",
                    costAvailable: false,
                }),
            ],
        });
        expect(container.textContent).toContain("Claude");
        expect(chip("google/gemini-2.5-pro")).toBeNull();
        expect(container.textContent).not.toContain("cost unavailable");
        expect(modelsValue()).toBe(
            "anthropic/claude-sonnet-4.5\ngoogle/gemini-2.5-pro",
        );

        const trigger = getByLabelText("Model family");
        fireEvent.click(trigger);
        pickOption(await rtlScreen.findByRole("option", { name: "Gemini" }));
        expect(chip("google/gemini-2.5-pro")).not.toBeNull();
    });

    it("toggling a model off updates the submitted models field", () => {
        const { modelsValue, chip } = renderForm();
        fireEvent.click(chip("gpt-4o")!);
        expect(modelsValue()).toBe("gpt-4o-mini");
    });

    it("renders unavailable models disabled and unselectable", () => {
        const { chip, modelsValue } = renderForm();
        const unavailable = chip("Not enabled for your API key");
        expect(unavailable).not.toBeNull();
        expect(unavailable).toHaveAttribute("aria-disabled", "true");
        fireEvent.click(unavailable!);
        expect(modelsValue()).not.toContain("gpt-5.5");
    });

    it("renders non-structured models disabled for structured eval runs", async () => {
        const { chip, modelsValue, getByLabelText } = renderForm({
            availableModels: [
                modelOption({ id: "gpt-4o", label: "GPT-4o" }),
                modelOption({
                    id: "meta/llama-4-maverick",
                    label: "Llama 4 Maverick",
                    family: "llama",
                    provider: "meta",
                    providerLabel: "Llama",
                    structuredOutput: false,
                    judgeSuitable: false,
                }),
            ],
        });

        const trigger = getByLabelText("Model family");
        fireEvent.click(trigger);
        pickOption(await rtlScreen.findByRole("option", { name: "Llama" }));

        const unsupported = chip("Structured output is not supported");
        expect(unsupported).not.toBeNull();
        expect(unsupported).toHaveAttribute("aria-disabled", "true");
        fireEvent.click(unsupported!);
        expect(modelsValue()).not.toContain("meta/llama-4-maverick");
    });

    it("allows a current provider-listed model even before catalog capabilities exist", async () => {
        const { chip, modelsValue, getByLabelText } = renderForm({
            availableModels: [
                modelOption({ id: "gpt-4o", label: "GPT-4o" }),
                modelOption({
                    id: "zai/glm-5.1",
                    label: "GLM 5.1",
                    family: "glm",
                    provider: "zai",
                    providerLabel: "Z.AI",
                    structuredOutput: false,
                    judgeSuitable: false,
                    providerListed: true,
                    transports: ["gateway"],
                }),
            ],
        });

        const trigger = getByLabelText("Model family");
        fireEvent.click(trigger);
        pickOption(await rtlScreen.findByRole("option", { name: "Z.AI" }));

        const listed = chip("zai/glm-5.1");
        expect(listed).not.toBeNull();
        expect(listed).not.toHaveAttribute("aria-disabled");
        fireEvent.click(listed!);
        expect(modelsValue()).toContain("zai/glm-5.1");
    });

    it("blocks text-only models for image datasets", async () => {
        const { chip, container, getByLabelText, modelsValue } = renderForm({
            datasets: [
                {
                    id: "d1",
                    name: "Images",
                    itemCount: 10,
                    labeledItemCount: 10,
                    purpose: "golden",
                    modality: "image",
                },
            ],
            availableModels: [
                modelOption({ id: "gpt-4o", label: "GPT-4o", vision: true }),
                modelOption({
                    id: "xai/grok-4.1-fast-reasoning",
                    label: "Grok 4.1 Fast Reasoning",
                    family: "grok",
                    provider: "xai",
                    providerLabel: "Grok",
                    vision: false,
                }),
            ],
            defaultModels: ["gpt-4o", "xai/grok-4.1-fast-reasoning"],
        });

        await waitFor(() => expect(modelsValue()).toBe("gpt-4o"));

        const trigger = getByLabelText("Model family");
        fireEvent.click(trigger);
        pickOption(await rtlScreen.findByRole("option", { name: "Grok" }));

        expect(container.textContent).toContain("no image input");
        const unsupported = chip("Image input is not supported");
        expect(unsupported).not.toBeNull();
        expect(unsupported).toHaveAttribute("aria-disabled", "true");
        fireEvent.click(unsupported!);
        expect(modelsValue()).toBe("gpt-4o");
    });

    it("adds a manually entered model id to the selection", () => {
        const { modelsValue, container, getByText } = renderForm();
        const input = container.querySelector(
            "#manualModel",
        ) as HTMLInputElement;
        fireEvent.change(input, {
            target: { value: "ft:gpt-4o-mini:acme:abc" },
        });
        fireEvent.click(getByText("Add"));
        expect(modelsValue()).toContain("ft:gpt-4o-mini:acme:abc");
        expect(
            rtlScreen.getByRole("button", {
                name: "Remove ft:gpt-4o-mini:acme:abc",
            }),
        ).toBeInTheDocument();
    });

    it("shows the degraded banner when availability is unverified", () => {
        const { queryByRole } = renderForm({ modelsDegraded: true });
        expect(queryByRole("status")).not.toBeNull();
    });

    it("hides the degraded banner when availability is verified", () => {
        const { queryByRole } = renderForm({ modelsDegraded: false });
        expect(queryByRole("status")).toBeNull();
    });

    it("disables submit when no models are selected", () => {
        const { chip, getByRole, modelsValue } = renderForm();
        fireEvent.click(chip("gpt-4o")!);
        fireEvent.click(chip("gpt-4o-mini")!);
        expect(modelsValue()).toBe("");
        expect(
            (
                getByRole("button", {
                    name: /Run evaluation/,
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(true);
    });

    it("disables AI judge generation until a dataset and prompt are selected", () => {
        const { getByRole, container } = renderForm({
            datasets: [],
            versionOptions: [],
        });
        const button = getByRole("button", {
            name: /Generate judge with AI/,
        }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(container.textContent).toContain(
            "Select a dataset and a prompt version first.",
        );
    });

    it("fills the rubric textarea from the AI generation action", async () => {
        const generateJudgeAction = vi.fn(async () => ({
            ok: true as const,
            rubricPrompt: "GENERATED RUBRIC",
        }));
        const { getByRole, getByLabelText } = renderForm({
            generateJudgeAction,
        });

        fireEvent.click(
            getByRole("button", { name: /Generate judge with AI/ }),
        );

        await waitFor(() =>
            expect(generateJudgeAction).toHaveBeenCalledWith("v1", "d1"),
        );
        await waitFor(() =>
            expect(
                (getByLabelText("Judge rubric") as HTMLTextAreaElement).value,
            ).toBe("GENERATED RUBRIC"),
        );
    });

    it("submits the edited rubric and judge model", async () => {
        const createRunAction = vi.fn(
            async (_prevState: unknown, _formData: FormData) => ({}),
        );
        const { getByLabelText, container } = renderForm({ createRunAction });

        fireEvent.change(getByLabelText("Judge rubric"), {
            target: { value: "Score accuracy. Reason first." },
        });
        fireEvent.submit(container.querySelector("form")!);

        await waitFor(() => expect(createRunAction).toHaveBeenCalled());
        const submitted = createRunAction.mock.calls[0][1] as FormData;
        expect(submitted.get("judgeRubric")).toBe(
            "Score accuracy. Reason first.",
        );
        expect(submitted.get("judgeModelId")).toBeTruthy();
        expect(submitted.get("judgeTransport")).toBe("openai");
        expect(
            JSON.parse(String(submitted.get("transportAssignments"))),
        ).toContainEqual(
            expect.objectContaining({ modelId: "gpt-4o", transport: "openai" }),
        );
    });

    it("submits no judge when the rubric is left empty", async () => {
        const createRunAction = vi.fn(
            async (_prevState: unknown, _formData: FormData) => ({}),
        );
        const { container } = renderForm({ createRunAction });

        fireEvent.submit(container.querySelector("form")!);

        await waitFor(() => expect(createRunAction).toHaveBeenCalled());
        const submitted = createRunAction.mock.calls[0][1] as FormData;
        expect(submitted.get("judgeRubric")).toBe("");
    });

    it("pre-fills reasoning effort per model from the selected prompt version", () => {
        const { reasoningConfigsValue } = renderForm({
            availableModels: [
                modelOption({
                    id: "gpt-5.5",
                    label: "GPT-5.5",
                    family: "gpt-5",
                    reasoning: true,
                    reasoningEffort: {
                        supportedLevels: [
                            "none",
                            "low",
                            "medium",
                            "high",
                            "xhigh",
                        ],
                        defaultLevel: "medium",
                    },
                }),
                modelOption({
                    id: "gpt-5.4",
                    label: "GPT-5.4",
                    family: "gpt-5",
                    reasoning: true,
                    reasoningEffort: {
                        supportedLevels: [
                            "none",
                            "low",
                            "medium",
                            "high",
                            "xhigh",
                        ],
                        defaultLevel: "medium",
                    },
                }),
            ],
        });

        expect(reasoningConfigsValue()).toEqual([
            { modelId: "gpt-5.5", reasoningConfig: { effort: "high" } },
            { modelId: "gpt-5.4", reasoningConfig: { effort: "high" } },
        ]);
    });

    it("renders both selectors and runs with a runnable dataset and prompt", async () => {
        const createRunAction = vi.fn(
            async (_prevState: unknown, _formData: FormData) => ({}),
        );
        const { getByRole, container } = renderForm({
            createRunAction,
        });

        // Both spine selectors render and are enabled. Target by trigger id
        // (the "Prompt version" label text also appears on per-model selects).
        expect(
            (
                container.querySelector("#datasetId") as HTMLButtonElement
            )?.getAttribute("aria-disabled"),
        ).not.toBe("true");
        expect(
            (
                container.querySelector("#promptVersionId") as HTMLButtonElement
            )?.getAttribute("aria-disabled"),
        ).not.toBe("true");

        // Run action is reachable and launches the run.
        const submit = getByRole("button", {
            name: /Run evaluation/,
        }) as HTMLButtonElement;
        expect(submit.disabled).toBe(false);
        fireEvent.submit(container.querySelector("form")!);
        await waitFor(() => expect(createRunAction).toHaveBeenCalled());
        const submitted = createRunAction.mock.calls[0][1] as FormData;
        expect(submitted.get("datasetId")).toBe("d1");
        expect(submitted.get("promptVersionId")).toBe("v1");
    });

    it("restores STT variants and shared evaluation when rerunning", async () => {
        const createRunAction = vi.fn(
            async (_state: unknown, _form: FormData) => ({}),
        );
        const { container, getByLabelText } = renderForm({
            createRunAction,
            datasets: [
                {
                    id: "d1",
                    name: "Calls",
                    itemCount: 1,
                    labeledItemCount: 1,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
            initialRunConfig: {
                audioRunMode: "stt_metrics",
                sttVariants: {
                    first: {
                        variantKey: "first",
                        label: "Auto",
                        config: {
                            modelId: "gpt-4o-mini-transcribe",
                            config: { prompt: "Preserve numbers." },
                            evaluator: {
                                enabled: true,
                                modelId: "gpt-4o",
                                rubricPrompt: "Score accuracy.",
                            },
                        },
                    },
                    second: {
                        variantKey: "second",
                        label: "English",
                        config: {
                            modelId: "gpt-4o-mini-transcribe",
                            language: "en",
                        },
                    },
                },
            },
        });
        expect(getByLabelText("Transcript judge rubric")).toHaveValue(
            "Score accuracy.",
        );
        fireEvent.submit(container.querySelector("form")!);
        await waitFor(() => expect(createRunAction).toHaveBeenCalled());
        const form = createRunAction.mock.calls[0]![1];
        expect(JSON.parse(String(form.get("sttVariants")))).toMatchObject([
            {
                variantKey: "first",
                label: "Auto",
                config: { config: { prompt: "Preserve numbers." } },
            },
            {
                variantKey: "second",
                label: "English",
                config: { language: "en" },
            },
        ]);
        expect(JSON.parse(String(form.get("sttEvaluation")))).toMatchObject({
            evaluator: {
                enabled: true,
                modelId: "gpt-4o",
                rubricPrompt: "Score accuracy.",
            },
        });
    });

    it("submits audio datasets in STT metrics mode by default", async () => {
        const createRunAction = vi.fn(
            async (_prevState: unknown, _formData: FormData) => ({}),
        );
        const {
            getByRole,
            getByLabelText,
            getByText,
            queryByLabelText,
            queryByText,
            container,
        } = renderForm({
            createRunAction,
            datasets: [
                {
                    id: "d1",
                    name: "Calls",
                    itemCount: 10,
                    labeledItemCount: 10,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        });
        // Steps run 1 Dataset, 2 Run mode, 3 Variants, 4 Review - no gaps.
        expect(
            getByRole("heading", { name: "3. STT config variants" }),
        ).toBeTruthy();
        expect(getByText("4.")).toBeTruthy();
        expect(getByText("STT metrics only")).toBeTruthy();
        expect(queryByText("Transcript consumer models")).toBeNull();
        expect(queryByLabelText("Prompt version")).toBeNull();
        expect(queryByText("Judge (optional)")).toBeNull();
        expect(queryByLabelText("Judge rubric")).toBeNull();
        fireEvent.click(getByLabelText("Create Latin transcript variant"));
        fireEvent.change(getByLabelText("Transcript language"), {
            target: { value: "hi-Latn" },
        });
        fireEvent.change(getByLabelText("Transliteration temperature"), {
            target: { value: "0.2" },
        });
        fireEvent.click(getByLabelText("Run transcript judge"));
        expect(getByLabelText("Transcript judge reasoning")).toBeTruthy();
        fireEvent.change(getByLabelText("Transcript judge rubric"), {
            target: {
                value: "Score semantic accuracy and speaker attribution.",
            },
        });

        const submit = getByRole("button", {
            name: /Run evaluation/,
        }) as HTMLButtonElement;
        expect(submit.disabled).toBe(false);
        fireEvent.submit(container.querySelector("form")!);

        await waitFor(() => expect(createRunAction).toHaveBeenCalled());
        const submitted = createRunAction.mock.calls[0][1] as FormData;
        expect(submitted.get("datasetId")).toBe("d1");
        expect(submitted.get("audioRunMode")).toBe("stt_metrics");
        expect(submitted.get("promptVersionId")).toBeNull();
        expect(submitted.get("models")).toBe("");
        expect(JSON.parse(String(submitted.get("fieldConfigs")))).toEqual([]);
        expect(submitted.get("sttConfig")).toBeNull();
        expect(JSON.parse(String(submitted.get("sttVariants")))).toEqual([
            expect.objectContaining({
                variantKey: "v1",
                label: "Variant 1",
                config: expect.objectContaining({
                    modelId: "gpt-4o-mini-transcribe",
                }),
            }),
        ]);
        expect(
            JSON.parse(String(submitted.get("sttEvaluation"))),
        ).toMatchObject({
            transcriptVariant: "latin",
            transliteration: {
                enabled: true,
                targetScript: "latin",
                targetLanguage: "hi-Latn",
                modelId: "gpt-4o-mini",
                temperature: 0.2,
            },
            evaluator: {
                enabled: true,
                modelId: "gpt-4o-mini",
                rubricPrompt:
                    "Score semantic accuracy and speaker attribution.",
            },
        });
    });

    it("drops disabled STT template values after a V1 model switch", () => {
        const { getByLabelText, getByRole, container } = renderForm({
            datasets: [
                {
                    id: "d1",
                    name: "Calls",
                    itemCount: 2,
                    labeledItemCount: 2,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
            sttModels: [
                {
                    id: "soniox:stt-async-v5",
                    label: "Soniox",
                    providerLabel: "Soniox",
                    available: true,
                },
                {
                    id: "openai:gpt-4o-transcribe",
                    label: "GPT-4o Transcribe",
                    providerLabel: "OpenAI",
                    available: true,
                },
            ],
        });

        fireEvent.change(getByLabelText("Context"), {
            target: { value: "Soniox-only context" },
        });
        const modelTrigger = getByLabelText(/STT model/);
        fireEvent.keyDown(modelTrigger, { key: "ArrowDown" });
        pickOption(getByRole("option", { name: /GPT-4o Transcribe/ }));

        expect(getByLabelText("Context")).toBeDisabled();
        expect(getByLabelText("Initial prompt")).toBeEnabled();
        const variants = JSON.parse(
            (
                container.querySelector(
                    'input[name="sttVariants"]',
                ) as HTMLInputElement
            ).value,
        ) as Array<{ config: { config?: Record<string, unknown> } }>;
        expect(variants[0]?.config.config).toBeUndefined();
    });

    it("duplicates variants with fresh keys and enforces the six-variant cap", () => {
        const { getByRole, getAllByRole, container } = renderForm({
            datasets: [
                {
                    id: "d1",
                    name: "Calls",
                    itemCount: 2,
                    labeledItemCount: 2,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        });

        fireEvent.click(getByRole("button", { name: "Duplicate" }));
        const variants = JSON.parse(
            (
                container.querySelector(
                    'input[name="sttVariants"]',
                ) as HTMLInputElement
            ).value,
        ) as Array<{ variantKey: string; label: string; config: unknown }>;
        expect(variants).toHaveLength(2);
        expect(variants[1]?.variantKey).not.toBe(variants[0]?.variantKey);
        expect(variants[1]?.config).toEqual(variants[0]?.config);

        const add = getByRole("button", { name: "Add variant" });
        for (let index = 0; index < 4; index += 1) fireEvent.click(add);
        expect(add).toBeDisabled();
        expect(getAllByRole("button", { name: "Remove" })).toHaveLength(6);
    });

    it("switches audio datasets into STT plus prompt eval mode", async () => {
        const createRunAction = vi.fn(
            async (_prevState: unknown, _formData: FormData) => ({}),
        );
        const { getByRole, getByText, container } = renderForm({
            createRunAction,
            datasets: [
                {
                    id: "d1",
                    name: "Calls",
                    itemCount: 10,
                    labeledItemCount: 10,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        });

        fireEvent.click(getByText("STT + prompt eval"));

        expect(getByText("Transcript consumer models")).toBeTruthy();
        expect(
            getByText(
                "These LLMs receive the STT transcript after transcription. The STT model above is the audio model under test.",
            ),
        ).toBeTruthy();
        expect(container.querySelector("#promptVersionId")).not.toBeNull();

        const submit = getByRole("button", {
            name: /Run evaluation/,
        }) as HTMLButtonElement;
        expect(submit.disabled).toBe(false);
        fireEvent.submit(container.querySelector("form")!);

        await waitFor(() => expect(createRunAction).toHaveBeenCalled());
        const submitted = createRunAction.mock.calls[0][1] as FormData;
        expect(submitted.get("audioRunMode")).toBe("prompt_eval");
        expect(submitted.get("promptVersionId")).toBe("v1");
        expect(String(submitted.get("models"))).toContain("gpt-4o");
    });

    it("shows provider-aware STT metadata for audio datasets", () => {
        const { getByText } = renderForm({
            datasets: [
                {
                    id: "d1",
                    name: "Calls",
                    itemCount: 10,
                    labeledItemCount: 10,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
            sttModels: [
                {
                    id: "gpt-4o-mini-transcribe",
                    label: "GPT-4o mini Transcribe",
                    providerId: "openai",
                    providerLabel: "OpenAI",
                    routeId: "openai-audio-transcriptions",
                    outputKind: "plain_transcript",
                    availabilityStatus: "available",
                    available: true,
                    configFields: [
                        {
                            key: "language",
                            label: "Audio language",
                            kind: "text",
                        },
                        {
                            key: "prompt",
                            label: "Initial prompt",
                            kind: "textarea",
                        },
                    ],
                },
            ],
        });

        expect(
            getByText(
                "OpenAI / plain transcript / openai-audio-transcriptions",
            ),
        ).toBeTruthy();
        expect(
            getByText("Configurable: Audio language, Initial prompt"),
        ).toBeTruthy();
    });

    it("shows an inline create-prompt path when no runnable prompt exists", () => {
        const { container, getByRole, queryByText } = renderForm({
            versionOptions: [],
            hasPrompt: false,
        });

        // Inline contextual link, not a full-page redirect wall.
        const link = getByRole("link", { name: /Create a prompt/ });
        expect(link.getAttribute("href")).toBe("/prompts/new");
        expect(queryByText("Go to prompts")).toBeNull();

        // The dataset selector spine is still present.
        expect(container.querySelector("#datasetId")).not.toBeNull();
    });

    it("shows an inline create-dataset path when no runnable dataset exists", () => {
        const { container, getByRole, queryByText } = renderForm({
            datasets: [],
        });

        const link = getByRole("link", { name: /Create a dataset/ });
        expect(link.getAttribute("href")).toBe("/datasets/new");
        expect(queryByText("Go to datasets")).toBeNull();

        // The prompt version selector spine is still present.
        expect(container.querySelector("#promptVersionId")).not.toBeNull();
    });

    it("lets a per-model reasoning override change only that model", async () => {
        const { container, getByLabelText, reasoningConfigsValue } = renderForm(
            {
                availableModels: [
                    modelOption({
                        id: "gpt-5.5",
                        label: "GPT-5.5",
                        family: "gpt-5",
                        reasoning: true,
                        reasoningEffort: {
                            supportedLevels: [
                                "none",
                                "low",
                                "medium",
                                "high",
                                "xhigh",
                            ],
                            defaultLevel: "medium",
                        },
                    }),
                    modelOption({
                        id: "gpt-5.4",
                        label: "GPT-5.4",
                        family: "gpt-5",
                        reasoning: true,
                        reasoningEffort: {
                            supportedLevels: [
                                "none",
                                "low",
                                "medium",
                                "high",
                                "xhigh",
                            ],
                            defaultLevel: "medium",
                        },
                    }),
                ],
            },
        );

        const trigger = getByLabelText("Reasoning effort for gpt-5.5");
        fireEvent.click(trigger);
        pickOption(await rtlScreen.findByRole("option", { name: "Low" }));

        await waitFor(() => {
            expect(reasoningConfigsValue()).toEqual([
                { modelId: "gpt-5.5", reasoningConfig: { effort: "low" } },
                { modelId: "gpt-5.4", reasoningConfig: { effort: "high" } },
            ]);
        });
        expect(container.textContent).toContain("gpt-5.4");
    });
});
