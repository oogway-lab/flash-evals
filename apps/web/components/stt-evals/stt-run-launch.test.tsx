import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
    IPromptWorkflow,
    IRunSetupDatasetOption,
} from "@flash-evals/api-contract";
import type { IActionState } from "@/app/actions";
import { SttRunLaunch } from "./stt-run-launch";

afterEach(cleanup);

const datasets: IRunSetupDatasetOption[] = [
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

describe("SttRunLaunch", () => {
    it("uses the dataset and modality bound by a multi input block", async () => {
        const action = vi.fn(
            async (_state: IActionState, _data: FormData) => ({}),
        );
        const { container } = render(
            <SttRunLaunch
                workflow={workflow}
                datasets={datasets}
                action={action}
            />,
        );

        expect(screen.getByText("Image dataset")).toBeInTheDocument();
        expect(
            container.querySelector<HTMLInputElement>('input[name="datasetId"]')
                ?.value,
        ).toBe("image-1");
        fireEvent.submit(container.querySelector("form")!);
        await waitFor(() => expect(action).toHaveBeenCalled());
        const submitted = action.mock.calls[0]?.[1];
        expect(submitted.get("idempotencyKey")).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it("keeps one retry key for the mounted launch form", () => {
        const { container, rerender } = render(
            <SttRunLaunch
                workflow={workflow}
                datasets={datasets}
                action={vi.fn(async () => ({}))}
            />,
        );
        const first = container.querySelector<HTMLInputElement>(
            'input[name="idempotencyKey"]',
        )?.value;

        rerender(
            <SttRunLaunch
                workflow={workflow}
                datasets={datasets}
                action={vi.fn(async () => ({}))}
            />,
        );

        expect(first).toBeTruthy();
        expect(
            container.querySelector<HTMLInputElement>(
                'input[name="idempotencyKey"]',
            )?.value,
        ).toBe(first);
    });

    it("offers text datasets to a prompt pipeline", () => {
        const prompt = {
            ...workflow,
            kind: "prompt",
            nodes: [],
        } as IPromptWorkflow;
        const { container } = render(
            <SttRunLaunch
                workflow={prompt}
                datasets={[
                    ...datasets,
                    {
                        id: "text-1",
                        name: "Calls as text",
                        itemCount: 4,
                        labeledItemCount: 4,
                        purpose: "evaluation",
                        modality: "text",
                    },
                ]}
                action={vi.fn(async () => ({}))}
            />,
        );
        expect(screen.getByText("Text dataset")).toBeInTheDocument();
        expect(
            container.querySelector<HTMLInputElement>('input[name="datasetId"]')
                ?.value,
        ).toBe("text-1");
    });

    it("retains the legacy audio selector for STT workflows", () => {
        const legacy = {
            ...workflow,
            kind: "stt",
            nodes: [],
        } as IPromptWorkflow;
        const { container } = render(
            <SttRunLaunch
                workflow={legacy}
                datasets={datasets}
                initialDatasetId="audio-1"
                action={vi.fn(async () => ({}))}
            />,
        );
        expect(screen.getByText("Audio dataset")).toBeInTheDocument();
        expect(
            container.querySelector<HTMLInputElement>('input[name="datasetId"]')
                ?.value,
        ).toBe("audio-1");
    });

    it("blocks legacy unresolved model nodes and sends focus to the repair control", () => {
        const unresolved = {
            ...workflow,
            nodes: [
                ...workflow.nodes,
                {
                    id: "prompt-id",
                    workflowId: workflow.id,
                    nodeKey: "prompt-1",
                    label: "Prompt Root",
                    nodeType: "prompt",
                    nodeConfig: { type: "prompt" },
                    promptVersionId: "prompt-v1",
                    modelId: "model-1",
                    evalConfig: { type: "none" },
                },
            ],
        } as IPromptWorkflow;
        const listener = vi.fn();
        document.addEventListener("flash-evals:repair-workflow-node", listener);

        render(
            <SttRunLaunch
                workflow={unresolved}
                datasets={datasets}
                action={vi.fn(async () => ({}))}
            />,
        );
        expect(screen.getByRole("button", { name: "Run flow" })).toBeDisabled();
        const repair = screen.getByRole("button", {
            name: "Repair Prompt Root",
        });
        // Long node labels truncate instead of widening the page.
        expect(repair).toHaveClass("max-w-full");
        expect(repair.querySelector(".truncate")).toHaveTextContent(
            "Repair Prompt Root",
        );
        fireEvent.click(repair);
        expect(listener).toHaveBeenCalled();

        document.removeEventListener(
            "flash-evals:repair-workflow-node",
            listener,
        );
    });

    it("submits a spend limit and data rules set under the closed settings", async () => {
        const action = vi.fn(
            async (_state: IActionState, _data: FormData) => ({}),
        );
        const { container } = render(
            <SttRunLaunch
                workflow={workflow}
                datasets={datasets}
                action={action}
            />,
        );

        fireEvent.click(
            screen.getByRole("button", { name: "Spend limit and data rules" }),
        );
        fireEvent.change(screen.getByLabelText("Spend limit (USD)"), {
            target: { value: "3.50" },
        });
        fireEvent.change(
            screen.getByLabelText("Only these hosting companies"),
            { target: { value: "vertex, bedrock" } },
        );
        // Closed again: the fields stay in the form and still submit.
        fireEvent.click(
            screen.getByRole("button", { name: "Spend limit and data rules" }),
        );
        fireEvent.submit(container.querySelector("form")!);

        await waitFor(() => expect(action).toHaveBeenCalled());
        const submitted = action.mock.calls[0]![1];
        expect(submitted.get("maxCostUsd")).toBe("3.50");
        expect(JSON.parse(String(submitted.get("dataPolicy")))).toEqual({
            onlyHosts: ["vertex", "bedrock"],
        });
    });

    it("shows a spend limit error next to the field", async () => {
        const { container } = render(
            <SttRunLaunch
                workflow={workflow}
                datasets={datasets}
                action={vi.fn(async () => ({
                    fieldErrors: {
                        maxCostUsd: ["Enter a spend limit above $0."],
                    },
                }))}
            />,
        );
        fireEvent.submit(container.querySelector("form")!);

        expect(
            await screen.findByText("Enter a spend limit above $0."),
        ).toBeInTheDocument();
        expect(screen.getByLabelText("Spend limit (USD)")).toHaveAttribute(
            "aria-invalid",
            "true",
        );
        await waitFor(() =>
            expect(
                screen.getByRole("button", {
                    name: "Spend limit and data rules",
                }),
            ).toHaveAttribute("aria-expanded", "true"),
        );
    });
});
