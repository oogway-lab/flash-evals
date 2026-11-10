import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IPipelineFinalAnswerField } from "@flash-evals/api-contract";
import { pickOption } from "@/components/ui/test-utils";
import { FinalAnswerFallbacks } from "./final-answer-fallbacks";

afterEach(cleanup);
beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

const field: IPipelineFinalAnswerField = {
    path: "$.summary",
    stepKey: "write",
    stepPath: "$.summary",
};

describe("FinalAnswerFallbacks", () => {
    it("sets a template fallback for a skipped step", () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <FinalAnswerFallbacks id="f0" field={field} onChange={onChange} />,
        );
        fireEvent.click(screen.getByText("If skipped or empty"));
        fireEvent.click(screen.getByLabelText("When the step is skipped"));
        pickOption(
            screen.getByRole("option", { name: "Fill in from other steps" }),
        );
        expect(onChange).toHaveBeenLastCalledWith({
            fallback: { template: "" },
        });
        rerender(
            <FinalAnswerFallbacks
                id="f0"
                field={{ ...field, fallback: { template: "" } }}
                onChange={onChange}
            />,
        );
        fireEvent.change(
            screen.getByLabelText("When the step is skipped: template"),
            { target: { value: "## {{Extract.$.title}}" } },
        );
        expect(onChange).toHaveBeenLastCalledWith({
            fallback: { template: "## {{Extract.$.title}}" },
        });
    });

    it("sets a fixed empty default and a value change from blank", () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <FinalAnswerFallbacks
                id="f0"
                field={{ ...field, whenEmpty: { value: "" } }}
                onChange={onChange}
            />,
        );
        // Open because something is set, with a summary.
        expect(
            screen.getByText("If skipped or empty (empty default)"),
        ).toBeVisible();
        fireEvent.change(
            screen.getByLabelText("When the value is empty: value"),
            { target: { value: "Not discussed" } },
        );
        expect(onChange).toHaveBeenLastCalledWith({
            whenEmpty: { value: "Not discussed" },
        });
        fireEvent.click(
            screen.getByRole("button", { name: "Add value change" }),
        );
        expect(onChange).toHaveBeenLastCalledWith({
            valueMap: [{ from: "", to: "" }],
        });
        rerender(
            <FinalAnswerFallbacks
                id="f0"
                field={{ ...field, valueMap: [{ from: "", to: "" }] }}
                onChange={onChange}
            />,
        );
        fireEvent.change(screen.getByLabelText("Becomes"), {
            target: { value: "Customer" },
        });
        expect(onChange).toHaveBeenLastCalledWith({
            valueMap: [{ from: "", to: "Customer" }],
        });
        fireEvent.click(
            screen.getByRole("button", { name: "Remove value change 1" }),
        );
        expect(onChange).toHaveBeenLastCalledWith({ valueMap: undefined });
    });
});
