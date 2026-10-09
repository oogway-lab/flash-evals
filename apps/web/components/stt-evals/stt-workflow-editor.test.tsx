import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
    IPromptWorkflow,
    IRunSetupDatasetOption,
    IRunSetupResponse,
} from "@mosaic/api-contract";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { SttWorkflowEditor } from "./stt-workflow-editor";

vi.mock("@xyflow/react", () => ({
    addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    MarkerType: { ArrowClosed: "arrowclosed" },
    Position: { Left: "left", Right: "right" },
    ReactFlow: ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
    ),
    useEdgesState: <T,>(initial: T[]) => {
        const [value, setValue] = React.useState(initial);
        return [value, setValue, vi.fn()] as const;
    },
    useNodesState: <T,>(initial: T[]) => {
        const [value, setValue] = React.useState(initial);
        return [value, setValue, vi.fn()] as const;
    },
}));

afterEach(cleanup);

const datasets: IRunSetupDatasetOption[] = [
    {
        id: "image-1",
        name: "Screenshots",
        itemCount: 3,
        labeledItemCount: 0,
        purpose: "evaluation",
        modality: "image",
    },
];

const workflow = {
    id: "workflow-1",
    teamId: "team-1",
    projectId: "project-1",
    name: "Multi",
    description: "",
    kind: "multi",
    createdAt: "2026-07-20T00:00:00.000Z",
    nodes: [
        {
            id: "node-1",
            workflowId: "workflow-1",
            nodeKey: "input-1",
            label: "Input",
            nodeType: "input",
            nodeConfig: {
                type: "input",
                modality: "image",
                datasetId: "image-1",
            },
            evalConfig: { type: "none" },
        },
    ],
    edges: [],
} as IPromptWorkflow;

const setup = {
    datasets,
    bundles: [],
    versionOptions: [],
    availableModels: [],
    modelsDegraded: false,
    hasPrompt: false,
    judgePrompts: [],
    sttModels: [],
} as unknown as IRunSetupResponse;

describe("SttWorkflowEditor", () => {
    it("blocks running an edited canvas until a save succeeds", async () => {
        const saveAction = vi
            .fn()
            .mockResolvedValueOnce({ formError: "Save failed." })
            .mockResolvedValueOnce({ ok: true });
        render(
            <SttWorkflowEditor
                launch={{
                    workflow,
                    datasets,
                    action: vi.fn(async () => ({})),
                }}
                canvas={{ workflow, setup, saveAction }}
            />,
        );
        expect(screen.getByRole("button", { name: "Run flow" })).toBeEnabled();

        fireEvent.click(screen.getByRole("button", { name: /input/i }));
        expect(
            screen.getByRole("button", { name: "Save before running" }),
        ).toBeDisabled();

        fireEvent.click(screen.getByRole("button", { name: "Save canvas" }));
        expect(await screen.findByText("Save failed.")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Save before running" }),
        ).toBeDisabled();

        fireEvent.click(screen.getByRole("button", { name: "Save canvas" }));
        expect(
            await screen.findByRole("button", { name: "Run flow" }),
        ).toBeEnabled();
    });
});
