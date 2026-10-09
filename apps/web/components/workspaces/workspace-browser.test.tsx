import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/actions/projects", () => ({
    activateProjectAction: vi.fn(),
    createProjectAction: vi.fn(async () => ({})),
    createWorkspaceAction: vi.fn(async () => ({})),
    updateWorkspaceAction: vi.fn(async () => ({
        error: "Workspace name is required.",
    })),
}));

import { WorkspaceBrowser, WorkspaceDetail } from "./workspace-browser";

afterEach(cleanup);

describe("WorkspaceDetail rename", () => {
    it("shows the rename error visibly and links it to the name input", async () => {
        render(
            <WorkspaceDetail
                workspace={{
                    id: "ws-1",
                    teamId: "team-1",
                    name: "Acme",
                    createdAt: "2026-01-01T00:00:00.000Z",
                }}
                projects={[]}
            />,
        );

        fireEvent.click(
            screen.getByRole("button", { name: "Rename workspace Acme" }),
        );
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        const error = await screen.findByRole("alert");
        expect(error).toHaveTextContent("Workspace name is required.");
        expect(error).not.toHaveClass("sr-only");
        expect(error).toHaveClass("text-error");

        const input = screen.getByLabelText("Workspace name");
        expect(input).toHaveAttribute("aria-invalid", "true");
        // The form wraps so the error gets its own row; the input must flex
        // (not take w-full) or Save/Cancel wrap below it.
        expect(input).toHaveClass("flex-1", "min-w-0");
        expect(input).toHaveAccessibleDescription(
            "Workspace name is required.",
        );
    });
});

describe("WorkspaceBrowser list", () => {
    const workspaces = [
        {
            id: "ws-1",
            teamId: "team-1",
            name: "Acme",
            createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
            id: "ws-2",
            teamId: "team-1",
            name: "Beta",
            createdAt: "2026-01-01T00:00:00.000Z",
        },
    ];

    it("renders the rows first and streams each project count in", async () => {
        let resolve!: (counts: Record<string, number | undefined>) => void;
        const projectCounts = new Promise<Record<string, number | undefined>>(
            (r) => (resolve = r),
        );

        await act(async () => {
            render(
                <WorkspaceBrowser
                    workspaces={workspaces}
                    projectCounts={projectCounts}
                    selectedWorkspaceId="ws-1"
                />,
            );
        });
        const acme = screen.getByRole("row", { name: /Acme/ });
        expect(
            within(acme).getByRole("link", { name: "Acme" }),
        ).toHaveAttribute("href", "/workspaces/ws-1");
        expect(within(acme).getByText("Current")).toBeInTheDocument();
        expect(
            within(screen.getByRole("row", { name: /Beta/ })).queryByText(
                "Current",
            ),
        ).not.toBeInTheDocument();
        expect(within(acme).queryByText("2")).not.toBeInTheDocument();

        await act(async () => resolve({ "ws-1": 2, "ws-2": undefined }));

        const countCell = within(
            screen.getByRole("row", { name: /Acme/ }),
        ).getByText("2");
        expect(countCell.closest("td")).toHaveClass("text-right");
        // A count that failed to load reads as unavailable, not as 0.
        expect(
            within(screen.getByRole("row", { name: /Beta/ })).getByText(
                "not available",
            ),
        ).toBeInTheDocument();
    });

    it("has no card tiles and links Open to the workspace", async () => {
        await act(async () => {
            render(
                <WorkspaceBrowser
                    workspaces={workspaces}
                    projectCounts={Promise.resolve({})}
                />,
            );
        });
        expect(document.querySelector("[data-slot=card]")).toBeNull();
        expect(
            screen.getByRole("link", { name: "Open workspace Beta" }),
        ).toHaveAttribute("href", "/workspaces/ws-2");
    });

    it("renames a workspace from the row's overflow menu", async () => {
        await act(async () => {
            render(
                <WorkspaceBrowser
                    workspaces={workspaces}
                    projectCounts={Promise.resolve({})}
                />,
            );
        });
        fireEvent.click(
            screen.getByRole("button", { name: "More actions for Acme" }),
        );
        fireEvent.click(
            await screen.findByRole("menuitem", { name: "Rename" }),
        );

        const input = await screen.findByLabelText("Workspace name");
        expect(input).toHaveValue("Acme");
        fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Workspace name is required.",
        );
    });
});
