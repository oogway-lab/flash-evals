import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    listDatasets: vi.fn(),
}));

vi.mock("@/server/projects/activeProject", () => ({
    requireActiveProject: vi.fn().mockResolvedValue({
        teamId: "team-1",
        projectId: "project-1",
    }),
}));
vi.mock("@/server/api/client", () => ({
    serverApiClient: () => ({
        listDatasets: mocks.listDatasets,
    }),
}));
vi.mock("@/components/layout/page-header", () => ({
    PageHeader: ({
        title,
        action,
    }: {
        title: string;
        action?: React.ReactNode;
    }) => (
        <>
            <h1>{title}</h1>
            {action}
        </>
    ),
}));
vi.mock("@/components/datasets/datasets-list", () => ({
    DatasetsList: () => <div>Datasets list</div>,
}));

import DatasetsPage from "./page";

describe("Datasets page", () => {
    afterEach(cleanup);

    beforeEach(() => {
        mocks.listDatasets.mockResolvedValue([]);
    });

    it("offers a way back to active datasets when no archived datasets exist", async () => {
        const page = await DatasetsPage({
            searchParams: Promise.resolve({ archived: "true" }),
        });

        render(page);

        expect(screen.getByText("No archived datasets")).toBeInTheDocument();
        expect(
            screen.getByRole("link", { name: "Show active datasets" }),
        ).toHaveAttribute("href", "/datasets");
        expect(screen.queryByText("No datasets yet")).toBeNull();
    });

    it("prompts to create a dataset when there are no active datasets", async () => {
        const page = await DatasetsPage({
            searchParams: Promise.resolve({}),
        });

        render(page);

        expect(screen.getByText("No datasets yet")).toBeInTheDocument();
        expect(
            screen.getAllByRole("link", { name: "New dataset" }),
        ).toHaveLength(1);
        expect(
            screen.queryByRole("link", { name: /^Create dataset/ }),
        ).toBeNull();
    });
});
