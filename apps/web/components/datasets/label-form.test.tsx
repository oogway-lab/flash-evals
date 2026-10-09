import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LabelForm } from "./label-form";

afterEach(cleanup);

const schema = {
    fields: [
        { name: "dish", type: "string" as const, required: false },
        { name: "calories", type: "number" as const, required: true },
    ],
    additionalProperties: false,
};

describe("LabelForm field feedback", () => {
    it("focuses the first invalid field and links its error", async () => {
        const action = vi.fn(async () => ({}));
        render(
            <LabelForm
                id="edit"
                datasetId="dataset-1"
                schema={schema}
                readiness={{ hasSchema: true, itemCount: 1 }}
                action={action}
                submitLabel="Save item"
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "Save item" }));

        const calories = screen.getByLabelText(/calories/);
        expect(calories).toHaveFocus();
        expect(calories).toHaveAttribute("aria-invalid", "true");
        const errorId = calories.getAttribute("aria-describedby");
        expect(errorId).toBe("edit-calories-error");
        expect(document.getElementById(errorId!)).toHaveAttribute(
            "role",
            "alert",
        );
        expect(action).not.toHaveBeenCalled();
    });

    it("links server errors to controls passed in as children", async () => {
        const { useFieldErrorId } =
            await import("@/components/ui/field-error-context");
        function ImageField() {
            const errorId = useFieldErrorId("image");
            return (
                <input
                    aria-label="Image"
                    name="image"
                    aria-describedby={errorId}
                />
            );
        }
        render(
            <LabelForm
                id="add"
                datasetId="dataset-1"
                schema={undefined}
                freeformLabel
                readiness={{ hasSchema: false, itemCount: 0 }}
                action={async () => ({
                    fieldErrors: { image: ["Image is too large."] },
                })}
                submitLabel="Add item"
            >
                <ImageField />
            </LabelForm>,
        );
        fireEvent.click(screen.getByRole("button", { name: "Add item" }));
        const error = await screen.findByText("Image is too large.");
        expect(error).toHaveAttribute("id", "add-image-error");
        expect(screen.getByLabelText("Image")).toHaveAttribute(
            "aria-describedby",
            "add-image-error",
        );
    });
});
