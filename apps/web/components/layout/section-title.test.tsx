import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SectionTitle } from "./section-title";

afterEach(cleanup);

describe("SectionTitle", () => {
    it("is an h2 at heading-20 by default", () => {
        render(<SectionTitle>Recent runs</SectionTitle>);
        const heading = screen.getByRole("heading", {
            level: 2,
            name: "Recent runs",
        });
        expect(heading).toHaveClass("text-heading-20");
    });

    it("renders an h3 at heading-16", () => {
        render(<SectionTitle as="h3">Details</SectionTitle>);
        expect(
            screen.getByRole("heading", { level: 3, name: "Details" }),
        ).toHaveClass("text-heading-16");
    });

    it("shows a description and an actions slot", () => {
        render(
            <SectionTitle
                description="Latest first"
                actions={<button type="button">View all</button>}
            >
                Runs
            </SectionTitle>,
        );
        expect(screen.getByText("Latest first")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "View all" }),
        ).toBeInTheDocument();
    });
});
