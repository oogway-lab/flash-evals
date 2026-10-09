import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { useActionState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { KeepFieldsOnReset } from "./keep-fields-on-reset";

afterEach(cleanup);

function Form({ keep }: { keep: boolean }) {
    const [, action] = useActionState<{ formError?: string }>(
        async () => ({ formError: "Save failed." }),
        {},
    );
    return (
        <form action={action}>
            {keep && <KeepFieldsOnReset />}
            <textarea aria-label="Note" defaultValue="" />
            <input aria-label="Flag" type="checkbox" />
            <button type="submit">Save</button>
        </form>
    );
}

async function typeAndSubmit() {
    fireEvent.change(screen.getByLabelText("Note"), {
        target: { value: "Keep me" },
    });
    fireEvent.click(screen.getByLabelText("Flag"));
    await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
}

describe("KeepFieldsOnReset", () => {
    it("shows the problem: React clears uncontrolled fields after an action", async () => {
        render(<Form keep={false} />);
        await typeAndSubmit();
        expect(screen.getByLabelText("Note")).toHaveValue("");
    });

    it("puts uncontrolled values back after the reset", async () => {
        render(<Form keep />);
        await typeAndSubmit();
        expect(screen.getByLabelText("Note")).toHaveValue("Keep me");
        expect(screen.getByLabelText("Flag")).toBeChecked();
    });
});
