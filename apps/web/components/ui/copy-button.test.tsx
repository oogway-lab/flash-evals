import { afterEach, describe, expect, it, vi } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { CopyButton } from "./copy-button";

const copyText = vi.hoisted(() => vi.fn());
vi.mock("@/lib/clipboard", () => ({ copyText }));

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("CopyButton", () => {
    it("builds its label from `what`, keeping acronyms", () => {
        render(
            <>
                <CopyButton value="a" what="Generation ID" />
                <CopyButton value="b" what="Full output" />
                <CopyButton value="c" />
            </>,
        );
        expect(
            screen.getByRole("button", { name: "Copy generation ID" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Copy full output" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Copy" }),
        ).toBeInTheDocument();
    });

    it("copies, announces Copied, then resets after two seconds", async () => {
        vi.useFakeTimers();
        copyText.mockResolvedValueOnce(true);
        render(<CopyButton value="secret-id" label="Copy run ID" />);
        const button = screen.getByRole("button", { name: "Copy run ID" });
        expect(button.querySelector("svg")).toHaveAttribute(
            "aria-hidden",
            "true",
        );

        await act(async () => {
            fireEvent.click(button);
        });
        expect(copyText).toHaveBeenCalledWith("secret-id");
        expect(screen.getByRole("status")).toHaveTextContent("Copied");

        await act(async () => {
            vi.advanceTimersByTime(2000);
        });
        expect(screen.getByRole("status")).toHaveTextContent("");
    });

    it("stays quiet when the copy fails", async () => {
        copyText.mockResolvedValueOnce(false);
        render(<CopyButton value="x" />);
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Copy" }));
        });
        expect(screen.getByRole("status")).toHaveTextContent("");
    });
});
