import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EdgeModeFields } from "./edge-mode-fields";
import { canvasEdge, serializeEdges } from "./stt-canvas";

afterEach(cleanup);

describe("EdgeModeFields", () => {
    it("switches a connection between passing the answer and waiting only", () => {
        const onChange = vi.fn();
        render(
            <EdgeModeFields
                sourceLabel="Extract"
                targetLabel="Points"
                orderOnly={false}
                canBeOrderOnly
                onChange={onChange}
                onClose={vi.fn()}
            />,
        );
        expect(
            screen.getByRole("radio", { name: /Pass Extract's answer/ }),
        ).toBeChecked();
        fireEvent.click(
            screen.getByRole("radio", { name: /Wait for Extract only/ }),
        );
        expect(onChange).toHaveBeenLastCalledWith(true);
    });

    it("explains why a block that needs its source's output can't wait only", () => {
        render(
            <EdgeModeFields
                sourceLabel="Input"
                targetLabel="STT"
                orderOnly={false}
                canBeOrderOnly={false}
                onChange={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(screen.queryByRole("radio")).toBeNull();
        expect(
            screen.getByText(/Only a Prompt or LLM text step/),
        ).toBeVisible();
    });
});

describe("canvas connections", () => {
    it("draws an order-only connection dashed and saves it with its mode", () => {
        const orderOnly = canvasEdge(
            { id: "e1", source: "extract", target: "points" },
            { orderOnly: true },
        );
        expect(orderOnly).toMatchObject({
            label: "order only",
            style: { strokeDasharray: "6 4" },
        });
        const passing = canvasEdge(
            { id: "e2", source: "points", target: "write" },
            { carryOriginalInput: true },
        );
        expect(passing.label).toBeUndefined();
        expect(
            serializeEdges([
                orderOnly,
                passing,
                { id: "e3", source: "a", target: "b" },
            ]),
        ).toEqual([
            {
                fromNodeKey: "extract",
                toNodeKey: "points",
                carryOriginalInput: false,
                orderOnly: true,
            },
            {
                fromNodeKey: "points",
                toNodeKey: "write",
                carryOriginalInput: true,
            },
            { fromNodeKey: "a", toNodeKey: "b", carryOriginalInput: false },
        ]);
    });
});
