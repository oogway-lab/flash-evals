import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StepSettingsFields } from "./step-settings-fields";

afterEach(cleanup);

describe("StepSettingsFields", () => {
    it("saves a temperature and an output limit, and clears them when blank", () => {
        const onChange = vi.fn();
        render(
            <StepSettingsFields
                nodeKey="extract"
                label="Extract"
                settings={{ temperature: 0.5 }}
                onChange={onChange}
            />,
        );
        fireEvent.change(screen.getByLabelText("Step output limit (tokens)"), {
            target: { value: "8000" },
        });
        expect(onChange).toHaveBeenLastCalledWith({
            temperature: 0.5,
            maxOutputTokens: 8000,
        });
        fireEvent.change(screen.getByLabelText("Step temperature"), {
            target: { value: "" },
        });
        expect(onChange).toHaveBeenLastCalledWith(undefined);
    });

    it("explains an out-of-range value and doesn't save it", () => {
        const onChange = vi.fn();
        render(
            <StepSettingsFields
                nodeKey="extract"
                label="Extract"
                settings={undefined}
                onChange={onChange}
            />,
        );
        fireEvent.change(screen.getByLabelText("Step temperature"), {
            target: { value: "3" },
        });
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole("alert")).toHaveTextContent(
            'Step "Extract" needs a temperature from 0 to 2.',
        );
    });

    it("offers the output mode only for steps with an output schema", () => {
        const { rerender } = render(
            <StepSettingsFields
                nodeKey="notes"
                label="Notes"
                settings={undefined}
                onChange={vi.fn()}
            />,
        );
        expect(screen.queryByLabelText("Output mode")).toBeNull();
        rerender(
            <StepSettingsFields
                nodeKey="notes"
                label="Notes"
                settings={{ outputMode: "text" }}
                onChange={vi.fn()}
                hasOutputSchema
            />,
        );
        expect(screen.getByLabelText("Output mode")).toHaveTextContent(
            "Text, then read the JSON",
        );
    });

    it("saves an input template and says when it reads a step that isn't upstream", () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <StepSettingsFields
                nodeKey="write"
                label="Write"
                settings={undefined}
                onChange={onChange}
                earlierSteps={[{ nodeKey: "extract", label: "Extract" }]}
            />,
        );
        fireEvent.change(screen.getByLabelText("Input template"), {
            target: { value: "{{Extract.$ | pick:title}}" },
        });
        expect(onChange).toHaveBeenLastCalledWith({
            inputTemplate: "{{Extract.$ | pick:title}}",
        });
        rerender(
            <StepSettingsFields
                nodeKey="write"
                label="Write"
                settings={{ inputTemplate: "{{Notes.$.text}}" }}
                onChange={onChange}
                earlierSteps={[{ nodeKey: "extract", label: "Extract" }]}
            />,
        );
        expect(screen.getByRole("alert")).toHaveTextContent(
            'The input template of "Write" names "Notes", which is not a step.',
        );
    });
});
