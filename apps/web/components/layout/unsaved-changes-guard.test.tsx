import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { UnsavedChangesGuard } from "./unsaved-changes-guard";

afterEach(() => {
    cleanup();
    router.push.mockReset();
});

function Page({ dirty }: { dirty: boolean }) {
    return (
        <>
            <UnsavedChangesGuard when={dirty} />
            <a href="/datasets">Datasets</a>
        </>
    );
}

function clickLink(init: MouseEventInit = {}) {
    const link = screen.getByRole("link", { name: "Datasets" });
    const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...init,
    });
    link.dispatchEvent(event);
    return event;
}

describe("UnsavedChangesGuard", () => {
    it("asks before following an in-app link, and follows it on confirm", async () => {
        render(<Page dirty />);
        const event = clickLink();
        expect(event.defaultPrevented).toBe(true);

        fireEvent.click(
            await screen.findByRole("button", { name: "Leave page" }),
        );
        await waitFor(() =>
            expect(router.push).toHaveBeenCalledWith("/datasets"),
        );
    });

    it("stays on the page when the user cancels", async () => {
        render(<Page dirty />);
        clickLink();
        fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
        await waitFor(() =>
            expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
        );
        expect(router.push).not.toHaveBeenCalled();
    });

    it("lets links through when nothing is unsaved, or for new-tab clicks", () => {
        const { rerender } = render(<Page dirty={false} />);
        expect(clickLink().defaultPrevented).toBe(false);

        rerender(<Page dirty />);
        expect(clickLink({ metaKey: true }).defaultPrevented).toBe(false);
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("asks the browser before unloading while there are unsaved changes", () => {
        render(<Page dirty />);
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });
});
