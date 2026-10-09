import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
    sttConfigFieldsForModelId,
    type IRunSetupResponse,
    type IWorkflowLlmRoute,
} from "@mosaic/api-contract";
import { SttNodeInspector } from "./stt-node-inspector";
import type { SttCanvasNode, SttNodeData } from "./stt-canvas";
import { pickOption } from "@/components/ui/test-utils";

afterEach(cleanup);
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

const setup: IRunSetupResponse = {
    datasets: [
        {
            id: "audio-1",
            name: "Calls",
            itemCount: 2,
            labeledItemCount: 0,
            purpose: "evaluation",
            modality: "audio",
        },
        {
            id: "image-1",
            name: "Screenshots",
            itemCount: 3,
            labeledItemCount: 0,
            purpose: "evaluation",
            modality: "image",
        },
        {
            id: "text-1",
            name: "Messages",
            itemCount: 4,
            labeledItemCount: 0,
            purpose: "evaluation",
            modality: "text",
        },
    ],
    bundles: [],
    versionOptions: [
        { id: "prompt-v1", label: "Draft v1", fieldConfigs: [] },
        { id: "prompt-v2", label: "Draft v2", fieldConfigs: [] },
    ],
    availableModels: [
        {
            id: "model-1",
            label: "Model 1",
            family: "test",
            provider: "test",
            providerLabel: "Test",
            reasoning: true,
            vision: true,
            structuredOutput: true,
            judgeSuitable: true,
            costAvailable: true,
            available: true,
            transports: ["openai"],
            reasoningEffort: {
                supportedLevels: ["none", "low", "high"],
                defaultLevel: "low",
            },
        },
    ],
    modelsDegraded: false,
    hasPrompt: false,
    judgePrompts: [],
    sttModels: [
        {
            id: "soniox:stt-async-v5",
            label: "Soniox",
            providerLabel: "Soniox",
            available: true,
            configFields: sttConfigFieldsForModelId("soniox:stt-async-v5"),
        },
    ],
};

const llmRoutes: IWorkflowLlmRoute[] = [
    {
        id: "route-1",
        teamId: "team-1",
        projectId: "project-1",
        name: "Gemma exact",
        createdAt: "2026-07-25T00:00:00.000Z",
        latestVersion: {
            id: "route-version-1",
            routeId: "route-1",
            version: 1,
            providerKeyId: "key-1",
            providerKeyRotationVersion: "rotation-1",
            capabilityVersionId: "capability-1",
            createdAt: "2026-07-25T00:00:00.000Z",
            config: {
                modelId: "model-1",
                transportConfig: { transport: "openai" },
                generation: {
                    maxOutputTokens: 2048,
                    reasoningEffort: "high",
                },
                structuredOutput: { mode: "text" },
                retry: {
                    owner: "mosaic",
                    maxAttempts: 1,
                    timeoutMs: 60_000,
                    retryableErrorClasses: ["timeout"],
                },
                cache: {
                    mosaicReuse: "force_fresh",
                    providerCaching: "allow",
                },
            },
        },
    },
];
const routeV1 = llmRoutes[0]!.latestVersion!;
const routeV2 = {
    ...routeV1,
    id: "route-version-2",
    version: 2,
    createdAt: "2026-07-25T01:00:00.000Z",
};
llmRoutes[0] = {
    ...llmRoutes[0]!,
    latestVersion: routeV2,
    versions: [routeV1, routeV2],
};

function root(nodeKey: string, diarization: boolean): SttCanvasNode {
    return {
        id: nodeKey,
        type: "stt",
        position: { x: 0, y: 0 },
        data: {
            nodeKey,
            label: nodeKey,
            nodeType: "stt",
            nodeConfig: {
                type: "stt",
                sttConfig: {
                    modelId: "soniox:stt-async-v5",
                    config: { diarization },
                },
            },
            evalConfig: { type: "none" },
        },
    };
}

function editDiarization(node: SttCanvasNode): SttNodeData {
    let saved = node.data;
    render(
        <SttNodeInspector
            node={node}
            setup={setup}
            onClose={() => undefined}
            onChange={(data) => {
                saved = data;
            }}
            onRemove={() => undefined}
            onDuplicate={() => undefined}
        />,
    );
    fireEvent.click(screen.getByLabelText("Diarization"));
    cleanup();
    return saved;
}

describe("SttNodeInspector", () => {
    it("keeps an exact v1 pin when the managed route latest version is v2", () => {
        render(
            <SttNodeInspector
                node={
                    {
                        id: "prompt-v1-pin",
                        type: "prompt",
                        position: { x: 0, y: 0 },
                        data: {
                            nodeKey: "prompt-v1-pin",
                            label: "Pinned prompt",
                            nodeType: "prompt",
                            nodeConfig: { type: "prompt" },
                            promptVersionId: "prompt-v1",
                            modelId: "model-1",
                            reasoningConfig: { effort: "high" },
                            llmExecutionSelection: {
                                mode: "pinned_route",
                                routeVersionId: "route-version-1",
                            },
                            evalConfig: { type: "none" },
                        },
                    } as SttCanvasNode
                }
                setup={setup}
                llmRoutes={llmRoutes}
                onClose={() => undefined}
                onChange={() => undefined}
                onRemove={() => undefined}
                onDuplicate={() => undefined}
            />,
        );

        fireEvent.click(
            screen.getByText("Advanced verified route configuration"),
        );
        expect(
            document.getElementById("node-execution-provider"),
        ).toHaveTextContent("OpenAI");
        expect(
            document.getElementById("node-execution-model"),
        ).toHaveTextContent("Model 1 · Test");
        expect(
            screen.getByRole("combobox", { name: "Saved configuration" }),
        ).toHaveTextContent("Gemma exact · v1");
        expect(
            screen.getByText(/saved configuration is immutable/i),
        ).toBeInTheDocument();
    });

    it("filters datasets by input modality and clears an incompatible binding", async () => {
        const onChange = vi.fn();
        const node = {
            id: "input-1",
            type: "input",
            position: { x: 0, y: 0 },
            data: {
                nodeKey: "input-1",
                label: "Input",
                nodeType: "input",
                nodeConfig: {
                    type: "input",
                    modality: "audio",
                    datasetId: "audio-1",
                },
                evalConfig: { type: "none" },
            },
        } as SttCanvasNode;
        render(
            <SttNodeInspector
                node={node}
                setup={setup}
                onClose={() => undefined}
                onChange={onChange}
                onRemove={() => undefined}
                onDuplicate={() => undefined}
            />,
        );

        fireEvent.click(screen.getByRole("combobox", { name: "Dataset" }));
        expect(
            await screen.findByRole("option", { name: "Calls (2)" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("option", { name: "Screenshots (3)" }),
        ).not.toBeInTheDocument();
        fireEvent.keyDown(document.activeElement ?? document.body, {
            key: "Escape",
        });

        fireEvent.click(screen.getByRole("combobox", { name: "Modality" }));
        pickOption(await screen.findByRole("option", { name: "Image" }));
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({
                nodeConfig: {
                    type: "input",
                    modality: "image",
                    datasetId: undefined,
                },
            }),
        );
    });

    it("configures a saved prompt version and can select an existing configuration", async () => {
        const onChange = vi.fn();
        const node = {
            id: "prompt-1",
            type: "prompt",
            position: { x: 0, y: 0 },
            data: {
                nodeKey: "prompt-1",
                label: "Prompt",
                nodeType: "prompt",
                nodeConfig: { type: "prompt" },
                promptVersionId: "prompt-v1",
                modelId: "model-1",
                evalConfig: { type: "none" },
            },
        } as SttCanvasNode;
        render(
            <SttNodeInspector
                node={node}
                setup={setup}
                llmRoutes={llmRoutes}
                onClose={() => undefined}
                onChange={onChange}
                onRemove={() => undefined}
                onDuplicate={() => undefined}
            />,
        );

        fireEvent.click(
            screen.getByRole("combobox", { name: "Prompt version" }),
        );
        pickOption(await screen.findByRole("option", { name: "Draft v2" }));
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ promptVersionId: "prompt-v2" }),
        );

        fireEvent.click(
            screen.getByRole("combobox", { name: "Saved configuration" }),
        );
        pickOption(
            await screen.findByRole("option", {
                name: "Gemma exact · v1",
            }),
        );
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({
                modelId: "model-1",
                reasoningConfig: { effort: "high" },
                llmExecutionSelection: {
                    mode: "pinned_route",
                    routeVersionId: "route-version-1",
                },
            }),
        );
    });

    it("selects provider then model and saves node-level generation settings", async () => {
        const onCreateLlmRoute = vi.fn().mockResolvedValue({
            route: llmRoutes[0],
        });
        const onRouteCreated = vi.fn();
        render(
            <SttNodeInspector
                node={
                    {
                        id: "prompt-new-config",
                        type: "prompt",
                        position: { x: 0, y: 0 },
                        data: {
                            nodeKey: "prompt-new-config",
                            label: "Prompt",
                            nodeType: "prompt",
                            nodeConfig: { type: "prompt" },
                            promptVersionId: "prompt-v1",
                            evalConfig: { type: "none" },
                        },
                    } as SttCanvasNode
                }
                setup={setup}
                llmRoutes={llmRoutes}
                onClose={() => undefined}
                onChange={() => undefined}
                onRemove={() => undefined}
                onDuplicate={() => undefined}
                onCreateLlmRoute={onCreateLlmRoute}
                onRouteCreated={onRouteCreated}
            />,
        );

        // An unresolved node opens the section on its own.
        expect(
            screen.getByRole("button", {
                name: "Advanced verified route configuration",
            }),
        ).toHaveAttribute("aria-expanded", "true");
        expect(document.getElementById("node-execution-model")).toBeDisabled();
        fireEvent.click(document.getElementById("node-execution-provider")!);
        pickOption(await screen.findByRole("option", { name: "OpenAI" }));
        fireEvent.click(document.getElementById("node-execution-model")!);
        pickOption(
            await screen.findByRole("option", { name: "Model 1 · Test" }),
        );
        fireEvent.change(screen.getByLabelText("Temperature"), {
            target: { value: "0.35" },
        });
        fireEvent.change(screen.getByLabelText("Seed"), {
            target: { value: "42" },
        });
        fireEvent.click(
            screen.getByRole("button", { name: "Use this configuration" }),
        );

        await waitFor(() =>
            expect(onCreateLlmRoute).toHaveBeenCalledWith(
                expect.objectContaining({
                    transport: "openai",
                    modelId: "model-1",
                    generation: {
                        maxOutputTokens: 4096,
                        temperature: 0.35,
                        seed: 42,
                    },
                    timeoutMs: 60_000,
                    maxAttempts: 1,
                    mosaicReuse: "force_fresh",
                }),
            ),
        );
        expect(onRouteCreated).toHaveBeenCalledWith(llmRoutes[0]);
    });

    it("shows a spinner while Simple-mode models load, and an error with retry on failure", async () => {
        let reject!: (error: unknown) => void;
        const onLoadLlmModels = vi
            .fn()
            .mockReturnValueOnce(
                new Promise((_resolve, rejectLoad) => (reject = rejectLoad)),
            )
            .mockResolvedValueOnce({ candidates: [] });
        render(
            <SttNodeInspector
                node={
                    {
                        id: "simple-node",
                        type: "llm_text",
                        position: { x: 0, y: 0 },
                        data: {
                            nodeKey: "simple-node",
                            label: "Simple node",
                            nodeType: "llm_text",
                            nodeConfig: { type: "llm_text", promptText: "Hi" },
                            llmExecutionSelection: {
                                mode: "simple",
                                transport: "gateway",
                            },
                            evalConfig: { type: "none" },
                        },
                    } as SttCanvasNode
                }
                setup={setup}
                onClose={() => undefined}
                onChange={vi.fn()}
                onRemove={() => undefined}
                onDuplicate={() => undefined}
                onLoadLlmModels={onLoadLlmModels}
            />,
        );

        const trigger = document.getElementById("node-simple-model")!;
        expect(trigger).toHaveTextContent("Loading models…");
        expect(
            within(trigger).getByRole("status", { name: "Loading models" }),
        ).toBeInTheDocument();

        await act(async () => reject(new TypeError("fetch failed")));
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Couldn’t load models for this provider.",
        );
        expect(trigger).not.toHaveTextContent("Loading models…");

        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(onLoadLlmModels).toHaveBeenCalledTimes(2));
        await waitFor(() =>
            expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
        );
    });

    it("does not offer the previous provider's models while another provider loads", async () => {
        const onLoadLlmModels = vi
            .fn()
            .mockResolvedValueOnce({
                candidates: [
                    {
                        transport: "gateway",
                        modelId: "provider/new-model",
                        label: "New model",
                        modelProvider: "provider",
                        modelProviderLabel: "Provider",
                        source: "provider_model_listing",
                        availability: "provider_listed_candidate",
                        requiresMutationDiscovery: true,
                        support: {
                            upstreamRoutingModes: ["auto"],
                            supportedGenerationControls: ["maxOutputTokens"],
                            supportsStructuredOutput: false,
                        },
                    },
                ],
            })
            .mockReturnValueOnce(new Promise(() => {}));
        render(
            <SttNodeInspector
                node={
                    {
                        id: "simple-node",
                        type: "llm_text",
                        position: { x: 0, y: 0 },
                        data: {
                            nodeKey: "simple-node",
                            label: "Simple node",
                            nodeType: "llm_text",
                            nodeConfig: { type: "llm_text", promptText: "Hi" },
                            llmExecutionSelection: {
                                mode: "simple",
                                transport: "gateway",
                            },
                            evalConfig: { type: "none" },
                        },
                    } as SttCanvasNode
                }
                setup={setup}
                onClose={() => undefined}
                onChange={vi.fn()}
                onRemove={() => undefined}
                onDuplicate={() => undefined}
                onLoadLlmModels={onLoadLlmModels}
            />,
        );
        const trigger = document.getElementById("node-simple-model")!;
        await waitFor(() =>
            expect(trigger).not.toHaveTextContent("Loading models…"),
        );

        fireEvent.click(document.getElementById("node-simple-provider")!);
        pickOption(await screen.findByRole("option", { name: /OpenAI/ }));
        await waitFor(() => expect(onLoadLlmModels).toHaveBeenCalledTimes(2));
        expect(trigger).toHaveTextContent("Loading models…");

        fireEvent.click(trigger);
        expect(
            await screen.findByRole("option", { name: /Model 1/ }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("option", { name: /New model/ }),
        ).not.toBeInTheDocument();
    });

    it("uses the provider-listed model directly in Simple mode", async () => {
        const onChange = vi.fn();
        render(
            <SttNodeInspector
                node={
                    {
                        id: "simple-node",
                        type: "llm_text",
                        position: { x: 0, y: 0 },
                        data: {
                            nodeKey: "simple-node",
                            label: "Simple node",
                            nodeType: "llm_text",
                            nodeConfig: { type: "llm_text", promptText: "Hi" },
                            modelId: "gpt-4o",
                            llmExecutionSelection: {
                                mode: "simple",
                                transport: "gateway",
                            },
                            evalConfig: { type: "none" },
                        },
                    } as SttCanvasNode
                }
                setup={setup}
                onClose={() => undefined}
                onChange={onChange}
                onRemove={() => undefined}
                onDuplicate={() => undefined}
                onLoadLlmModels={vi.fn().mockResolvedValue({
                    candidates: [
                        {
                            transport: "gateway",
                            modelId: "provider/new-model",
                            label: "New model",
                            modelProvider: "provider",
                            modelProviderLabel: "Provider",
                            source: "provider_model_listing",
                            availability: "provider_listed_candidate",
                            requiresMutationDiscovery: true,
                            support: {
                                upstreamRoutingModes: ["auto"],
                                supportedGenerationControls: [
                                    "maxOutputTokens",
                                ],
                                supportsStructuredOutput: false,
                            },
                        },
                    ],
                })}
            />,
        );

        fireEvent.click(document.getElementById("node-simple-model")!);
        pickOption(await screen.findByRole("option", { name: /New model/ }));

        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({
                modelId: "provider/new-model",
                llmExecutionSelection: {
                    mode: "simple",
                    transport: "gateway",
                },
            }),
        );
    });

    it.each([
        {
            nodeType: "llm_text" as const,
            nodeConfig: { type: "llm_text" as const, promptText: "Summarize" },
        },
        {
            nodeType: "transliterate" as const,
            nodeConfig: {
                type: "transliterate" as const,
                transliteration: {
                    enabled: true,
                    targetScript: "latin" as const,
                    modelId: "legacy-model",
                },
            },
        },
        {
            nodeType: "judge" as const,
            nodeConfig: { type: "judge" as const, rubricPrompt: "Be fair" },
        },
    ])(
        "repairs an unresolved $nodeType node with an immutable route",
        async ({ nodeType, nodeConfig }) => {
            const onChange = vi.fn();
            render(
                <SttNodeInspector
                    node={
                        {
                            id: `${nodeType}-1`,
                            type: nodeType,
                            position: { x: 0, y: 0 },
                            data: {
                                nodeKey: `${nodeType}-1`,
                                label: nodeType,
                                nodeType,
                                nodeConfig,
                                modelId: "legacy-model",
                                evalConfig: { type: "none" },
                            },
                        } as SttCanvasNode
                    }
                    setup={setup}
                    llmRoutes={llmRoutes}
                    onClose={() => undefined}
                    onChange={onChange}
                    onRemove={() => undefined}
                    onDuplicate={() => undefined}
                />,
            );

            expect(
                screen.getByText(/needs an explicit llm route/i),
            ).toBeInTheDocument();
            fireEvent.click(
                screen.getByRole("combobox", {
                    name: "Saved configuration",
                }),
            );
            pickOption(
                await screen.findByRole("option", {
                    name: "Gemma exact · v1",
                }),
            );
            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({
                    llmExecutionSelection: {
                        mode: "pinned_route",
                        routeVersionId: "route-version-1",
                    },
                }),
            );
            cleanup();
        },
    );

    it("shows the repair alert outside a collapsed section and focuses the route control", async () => {
        render(
            <SttNodeInspector
                node={
                    {
                        id: "llm-repair",
                        type: "llm_text",
                        position: { x: 0, y: 0 },
                        data: {
                            nodeKey: "llm-repair",
                            label: "Needs repair",
                            nodeType: "llm_text",
                            nodeConfig: {
                                type: "llm_text",
                                promptText: "Summarize",
                            },
                            modelId: "legacy-model",
                            evalConfig: { type: "none" },
                        },
                    } as SttCanvasNode
                }
                setup={setup}
                llmRoutes={llmRoutes}
                onClose={() => undefined}
                onChange={() => undefined}
                onRemove={() => undefined}
                onDuplicate={() => undefined}
            />,
        );

        const alert = screen
            .getByText(/needs an explicit llm route/i)
            .closest('[role="alert"]');
        expect(alert).not.toBeNull();
        // The alert sits outside the collapsible; the route control is in it,
        // and the collapsible starts open so the control is visible.
        expect(alert?.closest("[data-closed]")).toBeNull();
        expect(
            screen.getByRole("button", {
                name: "Advanced verified route configuration",
            }),
        ).toHaveAttribute("aria-expanded", "true");
        const route = document.getElementById("node-execution-route");
        expect(route?.parentElement?.closest("[data-closed]")).toBeNull();
        await waitFor(() => expect(route).toHaveFocus());
    });

    it("persists independent Soniox diarization settings through save and reload", () => {
        const enabled = editDiarization(root("soniox-enabled", false));
        const disabled = editDiarization(root("soniox-disabled", true));
        const reloaded = JSON.parse(
            JSON.stringify([enabled, disabled]),
        ) as SttNodeData[];

        expect(reloaded.map((data) => data.nodeConfig)).toEqual([
            {
                type: "stt",
                sttConfig: {
                    modelId: "soniox:stt-async-v5",
                    config: { diarization: true },
                },
            },
            {
                type: "stt",
                sttConfig: {
                    modelId: "soniox:stt-async-v5",
                    config: { diarization: false },
                },
            },
        ]);

        render(
            <SttNodeInspector
                node={{ ...root("reloaded", false), data: reloaded[0]! }}
                setup={setup}
                onClose={() => undefined}
                onChange={() => undefined}
                onRemove={() => undefined}
                onDuplicate={() => undefined}
            />,
        );
        expect(screen.getByLabelText("Diarization")).toBeChecked();
    });

    it("does not persist values from disabled template fields", () => {
        const node = root("soniox", false);
        node.data.nodeConfig = {
            type: "stt",
            sttConfig: {
                modelId: "soniox:stt-async-v5",
                config: { prompt: "unsupported", context: "old" },
            },
        };
        let saved = node.data;
        render(
            <SttNodeInspector
                node={node}
                setup={setup}
                onClose={() => undefined}
                onChange={(data) => {
                    saved = data;
                }}
                onRemove={() => undefined}
                onDuplicate={() => undefined}
            />,
        );

        expect(screen.getByLabelText("Initial prompt")).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Context"), {
            target: { value: "updated" },
        });

        expect(saved.nodeConfig).toEqual({
            type: "stt",
            sttConfig: {
                modelId: "soniox:stt-async-v5",
                config: { context: "updated" },
            },
        });
    });
});
