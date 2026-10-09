import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listRuns: vi.fn() }));

vi.mock("@/server/projects/activeProject", () => ({
    requireActiveProject: async () => ({ teamId: "t", projectId: "p" }),
}));
vi.mock("@/server/api/client", () => ({
    serverApiClient: () => ({ listRuns: mocks.listRuns }),
}));
vi.mock("@/components/runs/runs-list", () => ({
    RunsList: () => <p>runs list</p>,
}));

import RunsPage from "./page";

describe("RunsPage", () => {
    afterEach(cleanup);
    beforeEach(() => vi.clearAllMocks());

    it("has one New run action, with or without runs", async () => {
        for (const runs of [[], [{ id: "r1" }]]) {
            mocks.listRuns.mockResolvedValue(runs);
            const { unmount } = render(await RunsPage());
            expect(
                screen.getAllByRole("link", { name: "New run" }),
            ).toHaveLength(1);
            expect(
                screen.getByRole("link", { name: "New run" }),
            ).toHaveAttribute("href", "/runs/new");
            unmount();
        }
    });
});
