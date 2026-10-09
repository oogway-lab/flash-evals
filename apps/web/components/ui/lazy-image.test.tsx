import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyImage } from "./lazy-image";

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const skeleton = (container: HTMLElement) =>
    container.querySelector('[data-slot="skeleton"]');

describe("LazyImage", () => {
    it("lazy-loads behind a skeleton, then fades the image in", () => {
        const { container } = render(<LazyImage src="/a.png" alt="A dish" />);
        const image = screen.getByRole("img", { name: "A dish" });
        expect(image).toHaveAttribute("loading", "lazy");
        expect(image).toHaveClass("opacity-0", "transition-opacity");
        expect(skeleton(container)).toBeInTheDocument();

        fireEvent.load(image);

        expect(image).toHaveClass("opacity-100");
        expect(skeleton(container)).not.toBeInTheDocument();
    });

    it("shows the fallback when the image fails", () => {
        render(
            <LazyImage src="/missing.png" alt="A dish" fallback="No image" />,
        );
        fireEvent.error(screen.getByRole("img", { name: "A dish" }));

        expect(screen.queryByRole("img")).not.toBeInTheDocument();
        expect(screen.getByText("No image")).toBeInTheDocument();
    });

    it("picks up an image that finished loading before hydration", () => {
        vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(
            true,
        );
        vi.spyOn(
            HTMLImageElement.prototype,
            "naturalWidth",
            "get",
        ).mockReturnValue(640);
        const { container } = render(<LazyImage src="/a.png" alt="A dish" />);

        expect(screen.getByRole("img", { name: "A dish" })).toHaveClass(
            "opacity-100",
        );
        expect(skeleton(container)).not.toBeInTheDocument();
    });
});
