import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SttFlowNode } from "./flow-node";

vi.mock("@xyflow/react", () => ({
    Handle: ({ type }: { type: string }) => (
        <span data-testid={`${type}-handle`} />
    ),
    Position: { Left: "left", Right: "right" },
}));

afterEach(cleanup);

function renderNode(
    nodeType: "input" | "stt" | "judge" | "llm_text",
    extra: { label?: string; needsRepair?: boolean; selected?: boolean } = {},
) {
    const props = {
        data: {
            nodeKey: nodeType,
            label: extra.label ?? nodeType,
            nodeType,
            needsRepair: extra.needsRepair,
        },
        selected: extra.selected ?? false,
    } as unknown as Parameters<typeof SttFlowNode>[0];
    return render(<SttFlowNode {...props} />);
}

describe("SttFlowNode", () => {
    it("renders input as a source-only root", () => {
        renderNode("input");
        expect(screen.queryByTestId("target-handle")).not.toBeInTheDocument();
        expect(screen.getByTestId("source-handle")).toBeInTheDocument();
    });

    it("lets STT receive input while judge remains a sink", () => {
        renderNode("stt");
        expect(screen.getByTestId("target-handle")).toBeInTheDocument();
        expect(screen.getByTestId("source-handle")).toBeInTheDocument();
    });

    it("shows a readable node-type label", () => {
        renderNode("llm_text");
        expect(screen.getByText("LLM text")).toBeInTheDocument();
    });

    it("marks needs-repair with an icon and text, not colour alone", () => {
        const { container } = renderNode("llm_text", { needsRepair: true });
        const card = container.querySelector('[data-slot="flow-node"]');
        expect(card).toHaveClass("border-eval-warning");
        expect(card).toHaveAttribute("data-needs-repair");
        expect(screen.getByText("Needs repair")).toBeInTheDocument();
        expect(card?.querySelector("svg")).toBeInTheDocument();
    });

    it("outlines the selected node in the accent colour", () => {
        const { container } = renderNode("stt", { selected: true });
        expect(container.querySelector('[data-slot="flow-node"]')).toHaveClass(
            "outline-ring",
        );
    });

    it("truncates long labels", () => {
        renderNode("stt", { label: "A very long block label ".repeat(4) });
        expect(screen.getByText(/A very long block label/)).toHaveClass(
            "truncate",
        );
    });

    it("shows the whole label once the node is selected", () => {
        renderNode("stt", {
            label: "A very long block label ".repeat(4),
            selected: true,
        });
        const label = screen.getByText(/A very long block label/);
        expect(label).not.toHaveClass("truncate");
        expect(label).toHaveClass("wrap-break-word");
    });
});
