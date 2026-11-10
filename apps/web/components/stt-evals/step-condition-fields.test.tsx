import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IWorkflowStepCondition } from "@flash-evals/api-contract";
import { pickOption } from "@/components/ui/test-utils";
import { StepConditionFields } from "./step-condition-fields";
import { earlierStepsOf, type SttCanvasNode } from "./stt-canvas";

afterEach(cleanup);
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

const earlier = [{ nodeKey: "classify", label: "Classify" }];

describe("StepConditionFields", () => {
    it("sets a condition on an earlier step and parses typed values", () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <StepConditionFields
                nodeKey="points"
                condition={undefined}
                earlierSteps={earlier}
                onChange={onChange}
            />,
        );
        expect(screen.getByText("Run this step")).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText("When"));
        pickOption(
            screen.getByRole("option", { name: "Only when Classify matches" }),
        );
        expect(onChange).toHaveBeenLastCalledWith({
            stepKey: "classify",
            path: "",
            operator: "equals",
            values: [],
        });

        const condition: IWorkflowStepCondition = {
            stepKey: "classify",
            path: "",
            operator: "equals",
            values: [],
        };
        rerender(
            <StepConditionFields
                nodeKey="points"
                condition={condition}
                earlierSteps={earlier}
                onChange={onChange}
            />,
        );
        fireEvent.change(screen.getByLabelText("Field"), {
            target: { value: "$.is_sales" },
        });
        expect(onChange).toHaveBeenLastCalledWith({
            ...condition,
            path: "$.is_sales",
        });
        fireEvent.change(screen.getByLabelText("Value"), {
            target: { value: "true" },
        });
        expect(onChange).toHaveBeenLastCalledWith({
            ...condition,
            values: [true],
        });
    });

    it("clears the condition when set back to always", () => {
        const onChange = vi.fn();
        render(
            <StepConditionFields
                nodeKey="points"
                condition={{
                    stepKey: "classify",
                    path: "$.kind",
                    operator: "one_of",
                    values: ["sales", "renewal"],
                }}
                earlierSteps={earlier}
                onChange={onChange}
            />,
        );
        expect(
            screen.getByLabelText("Values, separated by commas"),
        ).toHaveValue("sales, renewal");
        fireEvent.click(screen.getByLabelText("When"));
        pickOption(screen.getByRole("option", { name: "Always" }));
        expect(onChange).toHaveBeenLastCalledWith(undefined);
    });

    it("adds a second condition that must also hold, and removes it", () => {
        const onChange = vi.fn();
        const archived: IWorkflowStepCondition = {
            stepKey: "classify",
            path: "$.archived",
            operator: "equals",
            values: [false],
        };
        const { rerender } = render(
            <StepConditionFields
                nodeKey="points"
                condition={archived}
                earlierSteps={earlier}
                onChange={onChange}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
        const blank = {
            stepKey: "classify",
            path: "",
            operator: "equals",
            values: [],
        };
        expect(onChange).toHaveBeenLastCalledWith({ all: [archived, blank] });
        rerender(
            <StepConditionFields
                nodeKey="points"
                condition={{ all: [archived, blank as IWorkflowStepCondition] }}
                earlierSteps={earlier}
                onChange={onChange}
            />,
        );
        const second = within(
            screen.getByRole("group", { name: "Condition 2" }),
        );
        fireEvent.change(second.getByLabelText("Field"), {
            target: { value: "$.type" },
        });
        expect(onChange).toHaveBeenLastCalledWith({
            all: [archived, { ...blank, path: "$.type" }],
        });
        fireEvent.change(second.getByLabelText("Value"), {
            target: { value: "sales" },
        });
        expect(onChange).toHaveBeenLastCalledWith({
            all: [archived, { ...blank, values: ["sales"] }],
        });
        fireEvent.click(
            screen.getByRole("button", { name: "Remove condition 2" }),
        );
        expect(onChange).toHaveBeenLastCalledWith(archived);
    });

    it("shows nothing for a step with no earlier steps", () => {
        const { container } = render(
            <StepConditionFields
                nodeKey="classify"
                condition={undefined}
                earlierSteps={[]}
                onChange={vi.fn()}
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});

describe("earlierStepsOf", () => {
    it("lists the steps before a node, leaving out input blocks", () => {
        const node = (id: string, nodeType: string) =>
            ({
                id,
                position: { x: 0, y: 0 },
                data: { nodeKey: id, label: id.toUpperCase(), nodeType },
            }) as unknown as SttCanvasNode;
        const nodes = [
            node("input", "input"),
            node("a", "prompt"),
            node("b", "prompt"),
            node("c", "prompt"),
            node("side", "prompt"),
        ];
        const edges = [
            { source: "input", target: "a" },
            { source: "a", target: "b" },
            { source: "b", target: "c" },
            { source: "input", target: "side" },
        ];
        expect(earlierStepsOf(nodes, edges, "c")).toEqual([
            { nodeKey: "a", label: "A" },
            { nodeKey: "b", label: "B" },
        ]);
        expect(earlierStepsOf(nodes, edges, "a")).toEqual([]);
    });
});
