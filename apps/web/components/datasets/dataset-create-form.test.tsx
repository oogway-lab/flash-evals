import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DatasetCreateForm } from "./dataset-create-form";

afterEach(cleanup);

function getNameInput() {
    return screen.getByLabelText("Dataset name") as HTMLInputElement;
}

describe("DatasetCreateForm", () => {
    it("shows name, purpose, and modality together on one page with explanatory copy", () => {
        render(
            <DatasetCreateForm createDatasetAction={vi.fn(async () => ({}))} />,
        );

        // Name field is present (first field)
        expect(getNameInput()).toBeTruthy();

        // Purpose explanations
        expect(
            screen.getByText(/runs can be scored automatically/i),
        ).toBeTruthy();
        expect(
            screen.getByText(/Model outputs are generated when you run/i),
        ).toBeTruthy();

        // Modality explanations - visible on the same page, no "Next" needed
        expect(screen.getByText(/Each example is an image/i)).toBeTruthy();
        expect(
            screen.getByText(/Each example is a piece of text/i),
        ).toBeTruthy();

        // Single-page form: no wizard navigation
        expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    });

    it("submits the chosen name, purpose, and modality", () => {
        const action = vi.fn(
            async (_state: unknown, _formData: FormData) => ({}),
        );
        render(<DatasetCreateForm createDatasetAction={action} />);

        fireEvent.change(getNameInput(), { target: { value: "My eval set" } });
        fireEvent.click(
            screen.getByRole("radio", { name: /Evaluation \(inputs only\)/i }),
        );
        fireEvent.click(screen.getByRole("radio", { name: /^Text/i }));
        fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));

        expect(action).toHaveBeenCalledTimes(1);
        const formData = action.mock.calls[0][1] as FormData;
        expect(formData.get("name")).toBe("My eval set");
        expect(formData.get("purpose")).toBe("evaluation");
        expect(formData.get("modality")).toBe("text");
    });

    it("defaults to a golden image dataset when nothing is changed", () => {
        const action = vi.fn(
            async (_state: unknown, _formData: FormData) => ({}),
        );
        render(<DatasetCreateForm createDatasetAction={action} />);

        fireEvent.change(getNameInput(), { target: { value: "Defaults" } });
        fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));

        const formData = action.mock.calls[0][1] as FormData;
        expect(formData.get("purpose")).toBe("golden");
        expect(formData.get("modality")).toBe("image");
    });

    it("uses a valid initial modality", () => {
        const action = vi.fn(
            async (_state: unknown, _formData: FormData) => ({}),
        );
        render(
            <DatasetCreateForm
                createDatasetAction={action}
                initialModality="audio"
            />,
        );

        fireEvent.change(getNameInput(), { target: { value: "Audio set" } });
        fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));

        const formData = action.mock.calls[0][1] as FormData;
        expect(formData.get("modality")).toBe("audio");
        expect(
            screen
                .getByRole("radio", { name: /^Audio/i })
                .getAttribute("aria-checked"),
        ).toBe("true");
    });

    it("falls back to image for an invalid initial modality", () => {
        const action = vi.fn(
            async (_state: unknown, _formData: FormData) => ({}),
        );
        render(
            <DatasetCreateForm
                createDatasetAction={action}
                initialModality="video"
            />,
        );

        fireEvent.change(getNameInput(), { target: { value: "Fallback set" } });
        fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));

        const formData = action.mock.calls[0][1] as FormData;
        expect(formData.get("modality")).toBe("image");
    });

    it("shows a validation message and does not submit without a name", () => {
        const action = vi.fn(
            async (_state: unknown, _formData: FormData) => ({}),
        );
        render(<DatasetCreateForm createDatasetAction={action} />);

        fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));

        expect(action).not.toHaveBeenCalled();
        expect(screen.getByText("Enter a name for your dataset.")).toBeTruthy();
    });

    it("shows a failed create inline and keeps the form", async () => {
        const action = vi.fn(async () => ({
            formError: "Dataset limit reached.",
        }));
        render(<DatasetCreateForm createDatasetAction={action} />);
        fireEvent.change(screen.getByLabelText("Dataset name"), {
            target: { value: "Food plates" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Dataset limit reached.",
        );
        expect(screen.getByLabelText("Dataset name")).toHaveValue(
            "Food plates",
        );
    });
});
