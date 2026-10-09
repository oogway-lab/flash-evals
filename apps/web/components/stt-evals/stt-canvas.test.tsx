import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IPromptWorkflow, IRunSetupResponse } from "@mosaic/api-contract";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { SttCanvas } from "./stt-canvas";

const flow = vi.hoisted(() => ({
    props: {} as {
        nodes?: Array<{
            ariaLabel?: string;
            data: { needsRepair?: boolean };
        }>;
        onNodesChange?: (changes: unknown[]) => void;
        onEdgesChange?: (changes: unknown[]) => void;
    },
}));

vi.mock("@xyflow/react", () => ({
    addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    MarkerType: { ArrowClosed: "arrowclosed" },
    Position: { Left: "left", Right: "right" },
    ReactFlow: ({
        children,
        ...props
    }: {
        children: React.ReactNode;
        onNodesChange?: (changes: unknown[]) => void;
        onEdgesChange?: (changes: unknown[]) => void;
    }) => {
        flow.props = props;
        return <div>{children}</div>;
    },
    useEdgesState: <T,>(initial: T[]) => {
        const [value, setValue] = React.useState(initial);
        return [value, setValue, vi.fn()] as const;
    },
    useNodesState: <T,>(initial: T[]) => {
        const [value, setValue] = React.useState(initial);
        return [value, setValue, vi.fn()] as const;
    },
}));

const workflow: IPromptWorkflow = {
    id: "workflow-1",
    teamId: "team-1",
    projectId: "project-1",
    name: "Canvas",
    description: "",
    kind: "multi",
    createdAt: "2026-07-20T00:00:00.000Z",
    nodes: [],
    edges: [],
};

const setup = {
    datasets: [],
    bundles: [],
    versionOptions: [{ id: "prompt-v1", label: "Prompt v1", fieldConfigs: [] }],
    availableModels: [{ id: "model-1", label: "Model 1", available: true }],
    modelsDegraded: false,
    hasPrompt: true,
    judgePrompts: [],
    sttModels: [],
} as unknown as IRunSetupResponse;

describe("SttCanvas", () => {
    afterEach(cleanup);

    it("preserves a saved prompt version in the next save payload", () => {
        const { container } = render(
            <SttCanvas
                workflow={{
                    ...workflow,
                    nodes: [
                        {
                            id: "prompt-node-id",
                            workflowId: workflow.id,
                            nodeKey: "prompt-root",
                            label: "Prompt Root",
                            nodeType: "prompt",
                            nodeConfig: { type: "prompt" },
                            promptVersionId: "prompt-v1",
                            modelId: "model-1",
                            llmExecutionSelection: {
                                mode: "pinned_route",
                                routeVersionId: "route-version-1",
                            },
                            evalConfig: { type: "none" },
                        },
                    ],
                }}
                setup={setup}
                saveAction={vi.fn(async () => ({}))}
            />,
        );

        const nodes = JSON.parse(
            container.querySelector<HTMLInputElement>('input[name="nodes"]')
                ?.value ?? "[]",
        );
        expect(nodes[0]).toEqual(
            expect.objectContaining({
                nodeKey: "prompt-root",
                promptVersionId: "prompt-v1",
                modelId: "model-1",
                llmExecutionSelection: {
                    mode: "pinned_route",
                    routeVersionId: "route-version-1",
                },
            }),
        );
    });

    it("adds input and prompt blocks with runnable defaults to the save payload", () => {
        const { container } = render(
            <SttCanvas
                workflow={workflow}
                setup={setup}
                saveAction={vi.fn(async () => ({}))}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: /input/i }));
        fireEvent.click(screen.getByRole("button", { name: /prompt/i }));

        const nodes = JSON.parse(
            container.querySelector<HTMLInputElement>('input[name="nodes"]')
                ?.value ?? "[]",
        );
        expect(nodes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    nodeType: "input",
                    nodeConfig: { type: "input", modality: "audio" },
                }),
                expect.objectContaining({
                    nodeType: "prompt",
                    nodeConfig: { type: "prompt" },
                    promptVersionId: "prompt-v1",
                    modelId: "model-1",
                    llmExecutionSelection: {
                        mode: "simple",
                        transport: "gateway",
                    },
                }),
            ]),
        );
    });

    it("serializes the workflow kind for multi and legacy saves", () => {
        const { container, rerender } = render(
            <SttCanvas
                workflow={workflow}
                setup={setup}
                saveAction={vi.fn(async () => ({}))}
            />,
        );
        expect(
            container.querySelector<HTMLInputElement>('input[name="kind"]')
                ?.value,
        ).toBe("multi");

        rerender(
            <SttCanvas
                workflow={{ ...workflow, kind: "stt" }}
                setup={setup}
                saveAction={vi.fn(async () => ({}))}
            />,
        );
        expect(
            container.querySelector<HTMLInputElement>('input[name="kind"]')
                ?.value,
        ).toBe("stt");
    });

    it("stays dirty after a failed save and clears only after a successful save", async () => {
        const onDirtyChange = vi.fn();
        const saveAction = vi
            .fn()
            .mockResolvedValueOnce({ formError: "Save failed." })
            .mockResolvedValueOnce({ ok: true });
        render(
            <SttCanvas
                workflow={workflow}
                setup={setup}
                saveAction={saveAction}
                onDirtyChange={onDirtyChange}
            />,
        );
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);

        expect(screen.getByRole("status", { name: "" })).toHaveTextContent(
            "Saved",
        );

        fireEvent.click(screen.getByRole("button", { name: /input/i }));
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);
        expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
        const unload = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(unload);
        expect(unload.defaultPrevented).toBe(true);

        fireEvent.click(screen.getByRole("button", { name: "Save canvas" }));
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Save failed.",
        );
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);

        fireEvent.click(screen.getByRole("button", { name: "Save canvas" }));
        await waitFor(() =>
            expect(onDirtyChange).toHaveBeenLastCalledWith(false),
        );
        expect(screen.getByText("Saved")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("does not mark the canvas dirty for selection or measurement changes", () => {
        const onDirtyChange = vi.fn();
        render(
            <SttCanvas
                workflow={workflow}
                setup={setup}
                saveAction={vi.fn(async () => ({}))}
                onDirtyChange={onDirtyChange}
            />,
        );

        act(() => {
            flow.props.onNodesChange?.([
                { type: "dimensions", id: "n1" },
                { type: "select", id: "n1", selected: true },
            ]);
            flow.props.onEdgesChange?.([
                { type: "select", id: "e1", selected: true },
            ]);
        });
        expect(onDirtyChange).not.toHaveBeenCalledWith(true);

        act(() => {
            flow.props.onNodesChange?.([{ type: "remove", id: "n1" }]);
        });
        expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });

    it("shows an empty-canvas hint until the first block is added", () => {
        render(
            <SttCanvas
                workflow={workflow}
                setup={setup}
                saveAction={vi.fn(async () => ({}))}
            />,
        );
        expect(screen.getByText(/the canvas is empty/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /input/i }));
        expect(screen.queryByText(/the canvas is empty/i)).toBeNull();
    });

    it("groups the add-block buttons apart from layout and save", () => {
        render(
            <SttCanvas
                workflow={workflow}
                setup={setup}
                saveAction={vi.fn(async () => ({}))}
            />,
        );
        const group = screen.getByRole("group", { name: "Add block" });
        expect(group.querySelectorAll("button")).toHaveLength(7);
        expect(
            group.contains(
                screen.getByRole("button", { name: /save canvas/i }),
            ),
        ).toBe(false);
    });

    it("flags a node whose pinned route is gone, without saving the flag", () => {
        const { container } = render(
            <SttCanvas
                workflow={{
                    ...workflow,
                    nodes: [
                        {
                            id: "prompt-node-id",
                            workflowId: workflow.id,
                            nodeKey: "prompt-root",
                            label: "Prompt Root",
                            nodeType: "prompt",
                            nodeConfig: { type: "prompt" },
                            promptVersionId: "prompt-v1",
                            modelId: "model-1",
                            llmExecutionSelection: {
                                mode: "pinned_route",
                                routeVersionId: "missing-version",
                            },
                            evalConfig: { type: "none" },
                        },
                    ],
                }}
                setup={setup}
                saveAction={vi.fn(async () => ({}))}
            />,
        );
        const [shown] = flow.props.nodes ?? [];
        expect(shown?.data.needsRepair).toBe(true);
        expect(shown?.ariaLabel).toBe("Prompt: Prompt Root (needs repair)");
        const saved = JSON.parse(
            container.querySelector<HTMLInputElement>('input[name="nodes"]')
                ?.value ?? "[]",
        );
        expect(saved[0]).not.toHaveProperty("needsRepair");
    });
});
