import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/settings" }));

vi.mock("next/navigation", () => ({
    usePathname: () => mocks.pathname,
}));

vi.mock("@clerk/nextjs", () => ({
    SignInButton: ({ children }: { children: React.ReactNode }) => children,
    UserButton: () => null,
    useUser: () => ({ isLoaded: true, isSignedIn: false }),
}));

import { NavLinks } from "./nav-links";

describe("NavLinks", () => {
    afterEach(() => {
        cleanup();
        mocks.pathname = "/settings";
    });

    it.each(["/", "/dashboard"])(
        "marks Dashboard current on %s and nothing else",
        (pathname) => {
            mocks.pathname = pathname;
            render(<NavLinks showAuthControls={false} />);

            const dashboard = screen.getByRole("link", { name: "Dashboard" });
            expect(dashboard).toHaveClass("bg-muted");
            expect(screen.getByRole("link", { name: "Runs" })).not.toHaveClass(
                "bg-muted",
            );
        },
    );

    it("does not mark Dashboard current on other pages", () => {
        mocks.pathname = "/runs/run-1";
        render(<NavLinks showAuthControls={false} />);

        expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveClass(
            "bg-muted",
        );
        expect(screen.getByRole("link", { name: "Runs" })).toHaveClass(
            "bg-muted",
        );
    });

    it("shows Pipelines (not Multiworkflow) and no Workflows entry", () => {
        render(<NavLinks showAuthControls={false} />);

        const pipelines = screen.getByRole("link", { name: "Pipelines" });
        // The route keeps its old name; only the label changed.
        expect(pipelines).toHaveAttribute("href", "/multiworkflow");
        expect(
            screen.queryByRole("link", { name: "Multiworkflow" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("link", { name: "Workflows" }),
        ).not.toBeInTheDocument();
    });

    it("lists Dashboard first and links it to /", () => {
        render(<NavLinks showAuthControls={false} />);

        const links = within(screen.getByRole("navigation")).getAllByRole(
            "link",
        );
        expect(links.map((link) => link.textContent)).toEqual([
            "Dashboard",
            "Datasets",
            "Prompts",
            "Pipelines",
            "Runs",
            "Settings",
        ]);
        expect(links[0]).toHaveAttribute("href", "/");
        expect(
            screen.queryByRole("link", { name: "Workspaces" }),
        ).not.toBeInTheDocument();
    });

    it("renders Settings in desktop and mobile navigation", () => {
        render(<NavLinks showAuthControls={false} />);

        expect(screen.getAllByRole("link", { name: "Settings" })).toHaveLength(
            1,
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Open navigation menu" }),
        );

        const settingsLinks = screen.getAllByRole("link", { name: "Settings" });
        expect(settingsLinks).toHaveLength(2);
        for (const link of settingsLinks) {
            expect(link).toHaveAttribute("href", "/settings");
        }
    });

    it("leaves New run to the pages, in desktop and mobile navigation", () => {
        render(<NavLinks showAuthControls={false} />);
        expect(
            screen.queryByRole("link", { name: "New run" }),
        ).not.toBeInTheDocument();

        fireEvent.click(
            screen.getByRole("button", { name: "Open navigation menu" }),
        );
        expect(
            screen.queryByRole("link", { name: "New run" }),
        ).not.toBeInTheDocument();
    });
});
