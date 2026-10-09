import { afterEach, describe, expect, it, vi } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { IdLabel } from "./id-label";

const copyText = vi.hoisted(() => vi.fn());
vi.mock("@/lib/clipboard", () => ({ copyText }));

afterEach(cleanup);

const ID = "e12581e7-d31b-4555-8303-59f3ab2ecf11";

describe("IdLabel", () => {
    it("shows the short ID in mono and copies the full one", async () => {
        copyText.mockResolvedValueOnce(true);
        const { container } = render(<IdLabel id={ID} noun="run ID" />);
        expect(screen.getByText("e12581e7")).toBeInTheDocument();
        expect(container.querySelector('[data-slot="id-label"]')).toHaveClass(
            "text-mono-13",
        );
        await act(async () => {
            fireEvent.click(
                screen.getByRole("button", { name: "Copy run ID" }),
            );
        });
        expect(copyText).toHaveBeenCalledWith(ID);
    });

    it("names the full ID in the copy button's tooltip for keyboard users", async () => {
        render(<IdLabel id={ID} noun="dataset ID" />);
        fireEvent.focus(
            screen.getByRole("button", { name: "Copy dataset ID" }),
        );
        expect(await screen.findByRole("tooltip")).toHaveTextContent(
            `Copy ${ID}`,
        );
    });
});
