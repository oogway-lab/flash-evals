import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    push: vi.fn(),
    refresh: vi.fn(),
    switchProjectAction: vi.fn(async () => ({ ok: true })),
    switchWorkspaceAction: vi.fn(async () => ({ ok: true })),
    createProjectAction: vi.fn(async () => ({})),
}));

// Stable like Next's real router, so effects that list it as a dependency
// don't re-run on every render.
const router = { push: mocks.push, refresh: mocks.refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/app/actions/projects", () => ({
    createProjectAction: mocks.createProjectAction,
    switchProjectAction: mocks.switchProjectAction,
    switchWorkspaceAction: mocks.switchWorkspaceAction,
}));

import { ProjectSwitcher } from "./project-switcher";

const workspaces = [
    { id: "ws-1", teamId: "t", name: "Acme", createdAt: "2026-01-01" },
    { id: "ws-2", teamId: "t", name: "Beta", createdAt: "2026-01-01" },
];
const projects = [
    { id: "p-1", name: "Evals" },
    { id: "p-2", name: "Vision" },
] as never;

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe("ProjectSwitcher", () => {
    afterEach(cleanup);
    beforeEach(() => vi.clearAllMocks());

    function renderSwitcher() {
        render(
            <ProjectSwitcher
                workspaces={workspaces}
                workspaceId="ws-1"
                projects={projects}
                projectId="p-1"
            />,
        );
    }

    it("shows the active workspace and project in the header", () => {
        renderSwitcher();

        const trigger = screen.getByRole("button", {
            name: "Switch project. Current: Acme, Evals",
        });
        expect(trigger).toHaveTextContent("Acme");
        expect(trigger).toHaveTextContent("Evals");
    });

    it("switches project from the menu and returns to the dashboard", async () => {
        renderSwitcher();

        fireEvent.click(screen.getByRole("button", { name: /Switch project/ }));
        fireEvent.click(
            await screen.findByRole("menuitemradio", { name: "Vision" }),
        );

        await vi.waitFor(() =>
            expect(mocks.switchProjectAction).toHaveBeenCalledWith("p-2"),
        );
        await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
    });

    it("prevents another workspace or project switch while a switch is pending", async () => {
        const switchResult = deferred<{ ok: boolean }>();
        mocks.switchProjectAction.mockImplementationOnce(
            () => switchResult.promise,
        );
        renderSwitcher();

        const trigger = screen.getByRole("button", { name: /Switch project/ });
        fireEvent.click(trigger);
        const projectOption = await screen.findByRole("menuitemradio", {
            name: "Vision",
        });
        fireEvent.click(projectOption);

        await vi.waitFor(() =>
            expect(mocks.switchProjectAction).toHaveBeenCalledTimes(1),
        );
        expect(trigger).toBeDisabled();
        expect(projectOption).toHaveAttribute("aria-disabled", "true");

        // A repeated input on the still-open menu cannot dispatch a second
        // mutation while the first server action is in flight.
        fireEvent.click(projectOption);
        expect(mocks.switchProjectAction).toHaveBeenCalledTimes(1);

        switchResult.resolve({ ok: true });
        await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
    });

    it("offers all workspaces and project creation", async () => {
        renderSwitcher();

        fireEvent.click(screen.getByRole("button", { name: /Switch project/ }));

        expect(
            await screen.findByRole("menuitem", { name: "All workspaces" }),
        ).toHaveAttribute("href", "/workspaces");
        expect(
            screen.getByRole("menuitem", { name: "New project" }),
        ).toBeInTheDocument();
    });

    it("closes the dialog and redirects on every project creation, not just the first", async () => {
        // A fresh result object per call, as a server action returns.
        mocks.createProjectAction.mockImplementation(async () => ({
            created: true,
        }));
        renderSwitcher();

        for (const expected of [1, 2]) {
            fireEvent.click(
                screen.getByRole("button", { name: /Switch project/ }),
            );
            fireEvent.click(
                await screen.findByRole("menuitem", { name: "New project" }),
            );
            const dialog = await screen.findByRole("dialog");
            fireEvent.change(within(dialog).getByLabelText("Project name"), {
                target: { value: `Project ${expected}` },
            });
            fireEvent.click(
                within(dialog).getByRole("button", { name: "Create project" }),
            );

            await waitFor(() =>
                expect(mocks.push).toHaveBeenCalledTimes(expected),
            );
            await waitFor(() =>
                expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
            );
            expect(mocks.createProjectAction).toHaveBeenCalledTimes(expected);
        }
    });
});
