import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PendingFieldset } from "./pending-fieldset";
import { SubmitButton } from "./submit-button";

afterEach(cleanup);

describe("PendingFieldset", () => {
    it("disables its controls while the form submits, then re-enables them", async () => {
        let finish!: () => void;
        render(
            <form
                action={() =>
                    new Promise<void>((resolve) => (finish = resolve))
                }
            >
                <PendingFieldset className="flex flex-col gap-4">
                    <input aria-label="Name" name="name" />
                    <SubmitButton>Save</SubmitButton>
                </PendingFieldset>
            </form>,
        );
        const name = screen.getByLabelText("Name");
        expect(name).toBeEnabled();

        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await screen.findByRole("group");
        expect(await screen.findByLabelText("Name")).toBeDisabled();

        await act(async () => finish());
        expect(name).toBeEnabled();
    });
});
