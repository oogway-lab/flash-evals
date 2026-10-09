import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EmptyState } from "./empty-state";

afterEach(cleanup);

describe("EmptyState", () => {
    it("renders a link action from actionLabel and actionHref", () => {
        render(
            <EmptyState
                title="No runs"
                description="Start one."
                actionLabel="New run"
                actionHref="/runs/new"
            />,
        );
        expect(screen.getByRole("link", { name: "New run" })).toHaveAttribute(
            "href",
            "/runs/new",
        );
    });

    it("renders a custom action node in place of the link", () => {
        render(
            <EmptyState
                variant="filter-empty"
                title="No matches"
                description="Try another filter."
                actionLabel="New run"
                actionHref="/runs/new"
                action={<button type="button">Clear filter</button>}
            />,
        );
        expect(
            screen.getByRole("button", { name: "Clear filter" }),
        ).toBeInTheDocument();
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("drops the dashed frame for filter-empty", () => {
        const { container } = render(
            <EmptyState
                variant="filter-empty"
                title="No matches"
                description="Try another filter."
            />,
        );
        expect(container.firstElementChild).not.toHaveClass("border-dashed");
    });

    it("uses a dashed rounded-sm frame by default", () => {
        const { container } = render(
            <EmptyState title="Empty" description="Nothing here." />,
        );
        expect(container.firstElementChild).toHaveClass(
            "border-dashed",
            "rounded-sm",
        );
    });

    it("renders the inline variant compact and left-aligned", () => {
        render(
            <EmptyState
                variant="inline"
                title="No values"
                description="Use Add."
            />,
        );
        const root = screen.getByText("No values").parentElement!;
        expect(root).toHaveAttribute("data-variant", "inline");
        expect(root).toHaveClass("items-start", "text-left", "py-3");
    });

    it("renders the plain variant without a box, for use inside a card", () => {
        render(
            <EmptyState variant="plain" title="No runs yet" description="x" />,
        );
        const root = screen.getByText("No runs yet").parentElement!;
        expect(root).toHaveAttribute("data-variant", "plain");
        expect(root.className).not.toMatch(/border/);
    });
});
