import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { useActionToast, withSuccessToast } from "./use-action-toast";

afterEach(() => {
    cleanup();
    toast.success.mockReset();
});

function Probe({ state }: { state: { ok?: boolean; message?: string } }) {
    useActionToast(state, "Saved.");
    return null;
}

describe("useActionToast", () => {
    it("toasts once per new successful result and never for the initial state", () => {
        const initial = {};
        const { rerender } = render(<Probe state={initial} />);
        expect(toast.success).not.toHaveBeenCalled();

        const ok = { ok: true };
        rerender(<Probe state={ok} />);
        rerender(<Probe state={ok} />);
        expect(toast.success).toHaveBeenCalledTimes(1);

        rerender(<Probe state={{ formError: "nope" } as { ok?: boolean }} />);
        expect(toast.success).toHaveBeenCalledTimes(1);

        rerender(<Probe state={{ ok: true }} />);
        expect(toast.success).toHaveBeenCalledTimes(2);
    });
});

describe("withSuccessToast", () => {
    it("toasts when the wrapped action succeeds, even if the caller unmounts", async () => {
        const action = vi
            .fn()
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ formError: "nope" });
        const wrapped = withSuccessToast(action, "Deleted.");
        await wrapped({}, new FormData());
        await wrapped({}, new FormData());
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(toast.success).toHaveBeenCalledWith("Deleted.");
    });
});
