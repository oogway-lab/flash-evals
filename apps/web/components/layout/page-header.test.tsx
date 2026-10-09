import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PageHeader } from "./page-header";

afterEach(cleanup);

describe("PageHeader", () => {
    it("renders the one h1 at heading-24 with no outer margin", () => {
        const { container } = render(<PageHeader title="Runs" />);
        expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
        expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
            "text-heading-24",
        );
        expect(container.firstElementChild?.className).not.toMatch(/\bm[tb]-/);
    });

    it("uses heading-32 for the hero variant", () => {
        render(<PageHeader title="Home" variant="hero" />);
        expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
            "text-heading-32",
        );
    });
});
