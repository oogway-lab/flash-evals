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
    it("shows each selected model's provider with its price, keyless providers unavailable", () => {
        const { getByLabelText } = renderForm({
            availableModels: [
                modelOption({
                    id: "gpt-4o",
                    transports: ["gateway"],
                    providers: [
                        {
                            transport: "gateway",
                            modelId: "openai/gpt-4o",
                            inputPerMillion: 2.5,
                            outputPerMillion: 10,
                            keySaved: true,
                        },
                        {
                            transport: "openrouter",
                            modelId: "openai/gpt-4o",
                            inputPerMillion: 2.5,
                            outputPerMillion: 10,
                            keySaved: false,
                        },
                    ],
                }),
            ],
            defaultModels: ["gpt-4o"],
        });
        expect(getByLabelText("Provider for gpt-4o").textContent).toContain(
            "Vercel AI Gateway · $2.50 / $10.00",
        );
    });

    it("blocks the run and names the missing key when no provider has one", () => {
        const { container } = renderForm({
            availableModels: [
                modelOption({
                    id: "zai/glm-5.2",
                    label: "GLM 5.2",
                    transports: [],
                    available: false,
                    disabledReason: "No key for OpenRouter.",
                    providers: [
                        {
                            transport: "openrouter",
                            modelId: "z-ai/glm-5.2",
                            inputPerMillion: 0.006,
                            outputPerMillion: 6.8,
                            keySaved: false,
                        },
                    ],
                }),
            ],
            defaultModels: ["zai/glm-5.2"],
            savedKeyProviders: [],
        });
        expect(container.textContent).toContain("No key for OpenRouter.");
        expect(container.textContent).toContain(
            "OpenRouter · $0.006 / $6.80 · no key",
        );
        expect(container.textContent).toContain(
            "No provider has a key, so no model can run",
        );
        expect(
            rtlScreen.getByRole("button", { name: /Run evaluation/ }),
        ).toBeDisabled();
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

    it("sends a temperature only for models given one, and none for OpenAI reasoning models", () => {
        const { container, getByLabelText, queryByLabelText, getByText } =
            renderForm({
                availableModels: [
                    modelOption({ id: "gpt-4o", label: "GPT-4o" }),
                    modelOption({ id: "gpt-4o-mini", label: "GPT-4o mini" }),
                    modelOption({
                        id: "gpt-5.5",
                        label: "GPT-5.5",
                        family: "gpt-5",
                        reasoning: true,
                    }),
                ],
                defaultModels: ["gpt-4o", "gpt-4o-mini", "gpt-5.5"],
            });
        const temperatures = () =>
            (
                container.querySelector(
                    'input[name="temperatureAssignments"]',
                ) as HTMLInputElement | null
            )?.value;

        expect(temperatures()).toBeUndefined();
        fireEvent.change(getByLabelText("Temperature for gpt-4o"), {
            target: { value: "0.3" },
        });
        expect(JSON.parse(temperatures() ?? "[]")).toEqual([
            { modelId: "gpt-4o", temperature: 0.3 },
        ]);
        expect(queryByLabelText("Temperature for gpt-5.5")).toBeNull();
        expect(getByText("No temperature")).toBeTruthy();
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
                modelId: "gpt-6-luna",
                temperature: 0.2,
            },
            evaluator: {
                enabled: true,
                modelId: "gpt-6-luna",
                rubricPrompt:
                    "Score semantic accuracy and speaker attribution.",
            },
        });
    });

    it("sends level volume first only for the variant that turns it on", () => {
        const { getAllByRole, getByLabelText, getByRole, container } =
            renderForm({
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
        const serialized = () =>
            JSON.parse(
                (
                    container.querySelector(
                        'input[name="sttVariants"]',
                    ) as HTMLInputElement
                ).value,
            ) as Array<{ config: Record<string, unknown> }>;

        expect(getByLabelText("Level volume first")).not.toBeChecked();
        expect(serialized()[0]?.config).not.toHaveProperty("levelVolume");
        fireEvent.click(getByRole("button", { name: "Add variant" }));
        const toggles = getAllByRole("checkbox", {
            name: /Level volume first/,
        });
        expect(toggles).toHaveLength(2);
        fireEvent.click(toggles[1]!);

        const variants = serialized();
        expect(variants[0]?.config).not.toHaveProperty("levelVolume");
        expect(variants[1]?.config).toMatchObject({ levelVolume: true });
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

    it("sends level volume first for the STT model under test only when ticked", () => {
        const { getByText, getByRole, container } = renderForm({
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
        fireEvent.click(getByText("STT + prompt eval"));
        const sttConfig = () =>
            JSON.parse(
                (
                    container.querySelector(
                        'input[name="sttConfig"]',
                    ) as HTMLInputElement
                ).value,
            ) as Record<string, unknown>;
        const toggle = getByRole("checkbox", { name: /Level volume first/ });

        expect(toggle).not.toBeChecked();
        expect(sttConfig()).not.toHaveProperty("levelVolume");
        expect(getByText(/STT model under test:/).textContent).not.toContain(
            "Volume levelled",
        );
        fireEvent.click(toggle);
        expect(sttConfig()).toMatchObject({ levelVolume: true });
        expect(getByText(/STT model under test:/).textContent).toContain(
            "Volume levelled",
        );
        fireEvent.click(toggle);
        expect(sttConfig()).not.toHaveProperty("levelVolume");
    });

    it("restores level volume first when rerunning an STT plus prompt run", async () => {
        const createRunAction = vi.fn(
            async (_state: unknown, _form: FormData) => ({}),
        );
        const { getByRole, container } = renderForm({
            createRunAction,
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
            initialRunConfig: {
                audioRunMode: "prompt_eval",
                sttConfig: {
                    modelId: "gpt-4o-mini-transcribe",
                    language: "en",
                    levelVolume: true,
                },
            },
        });

        expect(
            getByRole("checkbox", { name: /Level volume first/ }),
        ).toBeChecked();
        fireEvent.submit(container.querySelector("form")!);
        await waitFor(() => expect(createRunAction).toHaveBeenCalled());
        const form = createRunAction.mock.calls[0]![1];
        expect(JSON.parse(String(form.get("sttConfig")))).toMatchObject({
            modelId: "gpt-4o-mini-transcribe",
            language: "en",
            levelVolume: true,
        });
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

describe("NewRunForm benchmark comparison", () => {
    const OUTPUT_SCHEMA = {
        type: "object",
        properties: {
            x: { type: "string", enum: ["a", "b"] },
            summary: { type: "string", description: "Short recap" },
        },
    };

    function renderBenchmarkForm(
        overrides: Partial<Parameters<typeof NewRunForm>[0]> = {},
    ) {
        return renderForm({
            versionOptions: [
                {
                    id: "v1",
                    label: "Prompt v1",
                    fieldConfigs: [],
                    outputSchema: OUTPUT_SCHEMA,
                },
            ],
            ...overrides,
        });
    }

    const submitButton = (
        getByRole: (role: string, options: object) => HTMLElement,
    ) => getByRole("button", { name: /Run evaluation/ }) as HTMLButtonElement;

    it("sends no benchmark while the section is off", async () => {
        const createRunAction = vi.fn(
            async (_prevState: unknown, _formData: FormData) => ({}),
        );
        const { container, queryByLabelText } = renderBenchmarkForm({
            createRunAction,
        });
        expect(queryByLabelText("Benchmark model")).toBeNull();
        fireEvent.submit(container.querySelector("form")!);
        await waitFor(() => expect(createRunAction).toHaveBeenCalled());
        const submitted = createRunAction.mock.calls[0][1] as FormData;
        expect(submitted.has("benchmark")).toBe(false);
        expect(submitted.get("referenceModel")).toBe("gpt-4o");
    });

    it("proposes tasks from the output schema and submits them with the benchmark and judge", async () => {
        const createRunAction = vi.fn(
            async (_prevState: unknown, _formData: FormData) => ({}),
        );
        const { container, getByLabelText, getByRole } = renderBenchmarkForm({
            createRunAction,
        });
        fireEvent.click(getByLabelText("Compare with a benchmark model"));

        // One task per top-level property: a label compares exactly, free
        // text goes head to head (which needs the judge).
        expect(
            (
                getByLabelText("Name", {
                    selector: "#benchmark-task-0-name",
                }) as HTMLInputElement
            ).value,
        ).toBe("X");
        expect(getByRole("group", { name: "Task: Summary" })).not.toBeNull();

        fireEvent.click(getByLabelText("Benchmark model"));
        pickOption(
            await rtlScreen.findByRole("option", { name: "gpt-4o-mini" }),
        );
        fireEvent.change(getByLabelText("Maximum cost (% of benchmark)"), {
            target: { value: "40" },
        });

        expect(submitButton(getByRole).disabled).toBe(false);
        fireEvent.submit(container.querySelector("form")!);
        await waitFor(() => expect(createRunAction).toHaveBeenCalled());
        const submitted = createRunAction.mock.calls[0][1] as FormData;
        expect(submitted.get("referenceModel")).toBe("gpt-4o-mini");
        expect(JSON.parse(String(submitted.get("benchmark")))).toEqual({
            taskMap: {
                tasks: [
                    {
                        key: "x",
                        name: "X",
                        method: "agreement",
                        fields: [{ path: "$.x", matcher: "exact" }],
                    },
                    {
                        key: "summary",
                        name: "Summary",
                        description: "Short recap",
                        method: "head_to_head",
                        paths: ["$.summary"],
                    },
                ],
            },
            judge: { modelId: "gpt-4o", transport: "openai" },
            policy: {
                minAgreement: 0.9,
                minWinOrTieRate: 0.9,
                maxDropBelowReference: 0.02,
                maxRelativeCost: 0.4,
            },
        });
    });

    it("shows task map errors inline and blocks submit until they are fixed", () => {
        const { container, getByLabelText, getByRole } = renderBenchmarkForm();
        fireEvent.click(getByLabelText("Compare with a benchmark model"));
        fireEvent.change(
            getByLabelText("Output field", {
                selector: "#benchmark-task-0-field-0-path",
            }),
            {
                target: { value: "$.missing" },
            },
        );
        expect(container.textContent).toContain(
            'X: "$.missing" is not in the output schema.',
        );
        expect(submitButton(getByRole).disabled).toBe(true);

        fireEvent.change(
            getByLabelText("Output field", {
                selector: "#benchmark-task-0-field-0-path",
            }),
            {
                target: { value: "$.x" },
            },
        );
        expect(container.textContent).not.toContain("Fix these before");
        expect(submitButton(getByRole).disabled).toBe(false);
    });

    it("starts on with the previous settings when rerunning a benchmark run", () => {
        const { getByLabelText, container } = renderBenchmarkForm({
            initialRunConfig: {
                benchmark: {
                    taskMap: {
                        tasks: [
                            {
                                key: "label",
                                name: "Label",
                                method: "agreement",
                                fields: [{ path: "$.x", matcher: "exact" }],
                            },
                        ],
                    },
                    policy: { minAgreement: 0.75 },
                },
            },
        });
        expect(
            (
                getByLabelText(
                    "Compare with a benchmark model",
                ) as HTMLInputElement
            ).checked,
        ).toBe(true);
        expect(
            (getByLabelText("Minimum agreement (%)") as HTMLInputElement).value,
        ).toBe("75");
        const hidden = container.querySelector(
            'input[name="benchmark"]',
        ) as HTMLInputElement;
        expect(JSON.parse(hidden.value)).toMatchObject({
            taskMap: { tasks: [{ key: "label" }] },
            policy: { minAgreement: 0.75 },
        });
    });

    it("asks for a second model and re-proposes tasks on demand", () => {
        const { container, chip, getByLabelText, getByRole } =
            renderBenchmarkForm();
        fireEvent.click(getByLabelText("Compare with a benchmark model"));
        fireEvent.click(getByRole("button", { name: "Remove task X" }));
        fireEvent.click(getByRole("button", { name: "Remove task Summary" }));
        expect(container.textContent).toContain("Add at least one task.");

        fireEvent.click(
            getByRole("button", { name: "Propose from output schema" }),
        );
        expect(container.textContent).not.toContain("Add at least one task.");

        fireEvent.click(chip("gpt-4o-mini")!);
        expect(container.textContent).toContain(
            "Select at least two models: the benchmark and one to compare with it.",
        );
        expect(submitButton(getByRole).disabled).toBe(true);
    });
});
