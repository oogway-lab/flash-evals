import { afterEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";

const mocks = vi.hoisted(() => {
    let counter = 0;
    const succeed = async () => ({ ok: true, resetKey: ++counter });
    return {
        updateDatasetNameAction: vi.fn(succeed),
        updateDatasetDescriptionAction: vi.fn(succeed),
    };
});

vi.mock("@/app/actions", () => mocks);

import { DatasetDescription } from "./dataset-description";
import { DatasetName } from "./dataset-name";

afterEach(cleanup);

describe("DatasetName", () => {
    it("closes the editor after every successful save", async () => {
        render(<DatasetName datasetId="ds-1" name="Original" />);

        for (let i = 0; i < 2; i++) {
            fireEvent.click(
                screen.getByRole("button", { name: "Edit dataset name" }),
            );
            fireEvent.click(screen.getByRole("button", { name: "Save" }));
            await waitFor(() =>
                expect(screen.queryByLabelText("Dataset name")).toBeNull(),
            );
        }
        expect(mocks.updateDatasetNameAction).toHaveBeenCalledTimes(2);
    });
});

describe("DatasetName keyboard and semantics", () => {
    it("cancels on Escape, keeps the h1 while editing, and refocuses the pencil", () => {
        render(<DatasetName datasetId="ds-1" name="Original" />);
        fireEvent.click(
            screen.getByRole("button", { name: "Edit dataset name" }),
        );
        expect(
            screen.getByRole("heading", { level: 1, name: "Original" }),
        ).toBeInTheDocument();

        const input = screen.getByLabelText("Dataset name");
        fireEvent.change(input, { target: { value: "Changed" } });
        fireEvent.keyDown(input, { key: "Escape" });

        expect(screen.queryByLabelText("Dataset name")).toBeNull();
        expect(
            screen.getByRole("heading", { level: 1, name: "Original" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Edit dataset name" }),
        ).toHaveFocus();
    });
});

describe("DatasetDescription", () => {
    it("closes the editor after every successful save", async () => {
        render(<DatasetDescription datasetId="ds-1" description="About" />);

        for (let i = 0; i < 2; i++) {
            fireEvent.click(
                screen.getByRole("button", { name: "Edit description" }),
            );
            fireEvent.click(screen.getByRole("button", { name: "Save" }));
            await waitFor(() =>
                expect(
                    screen.queryByLabelText("Dataset description"),
                ).toBeNull(),
            );
        }
        expect(mocks.updateDatasetDescriptionAction).toHaveBeenCalledTimes(2);
    });
});

describe("DatasetDescription keyboard", () => {
    it("saves on Ctrl+Enter and cancels on Escape", async () => {
        mocks.updateDatasetDescriptionAction.mockClear();
        render(<DatasetDescription datasetId="ds-1" description="About" />);

        fireEvent.click(
            screen.getByRole("button", { name: "Edit description" }),
        );
        fireEvent.keyDown(screen.getByLabelText("Dataset description"), {
            key: "Escape",
        });
        expect(screen.queryByLabelText("Dataset description")).toBeNull();
        expect(mocks.updateDatasetDescriptionAction).not.toHaveBeenCalled();

        fireEvent.click(
            screen.getByRole("button", { name: "Edit description" }),
        );
        fireEvent.keyDown(screen.getByLabelText("Dataset description"), {
            key: "Enter",
            ctrlKey: true,
        });
        await waitFor(() =>
            expect(mocks.updateDatasetDescriptionAction).toHaveBeenCalledTimes(
                1,
            ),
        );
    });
});
