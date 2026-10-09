import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IDashboardStats } from "@mosaic/api-contract";

const mocks = vi.hoisted(() => ({ getDashboard: vi.fn() }));

vi.mock("@/server/api/client", () => ({
    serverApiClient: () => ({ getDashboard: mocks.getDashboard }),
}));

import { DashboardContent, isSetupComplete } from "./dashboard-content";

const emptyStats: IDashboardStats = {
    datasetCount: 0,
    promptCount: 0,
    runCount: 0,
    runningCount: 0,
    hasDatasetWithSchema: false,
    hasDatasetWithItems: false,
    hasPrompt: false,
};

const run = {
    id: "run-12345678-aaaa",
    status: "completed",
    createdAt: "2026-09-01T00:00:00.000Z",
    datasetId: "dataset-1",
    datasetName: "Food",
    models: ["m1"],
    progress: { done: 40, total: 40, failed: 0, pending: 0 },
};

async function renderDashboard(
    stats: Partial<IDashboardStats>,
    recentRuns: unknown[] = [],
) {
    mocks.getDashboard.mockResolvedValue({
        stats: { ...emptyStats, ...stats },
        recentRuns,
    });
    render(await DashboardContent({ teamId: "team-1", projectId: "p-1" }));
}

describe("DashboardContent", () => {
    afterEach(cleanup);
    beforeEach(() => vi.clearAllMocks());

    it("asks the API for the active project's dashboard", async () => {
        await renderDashboard({});
        expect(mocks.getDashboard).toHaveBeenCalledWith("team-1", "p-1");
    });

    it("shows one quiet stat strip whose items link to their lists", async () => {
        await renderDashboard({
            datasetCount: 2,
            promptCount: 9,
            runCount: 6,
            runningCount: 2,
            hasDatasetWithItems: true,
            hasDatasetWithSchema: true,
            hasPrompt: true,
        });

        const strip = screen.getByRole("list", { name: "Project totals" });
        const links = within(strip).getAllByRole("link");
        expect(links.map((l) => l.getAttribute("href"))).toEqual([
            "/datasets",
            "/prompts",
            "/runs",
        ]);
        expect(links[0]).toHaveTextContent("Datasets2");
        expect(links[1]).toHaveTextContent("Prompts9");
        expect(links[2]).toHaveTextContent("Runs62 running");
    });

    it("explains why a dataset does not count as ready", async () => {
        await renderDashboard({
            datasetCount: 1,
            hasDatasetWithItems: true,
            hasDatasetWithSchema: false,
        });
        expect(
            screen.getByText("None have a labeling schema"),
        ).toBeInTheDocument();
    });

    describe("getting started", () => {
        it("lists every step as to do for an empty project", async () => {
            await renderDashboard({});

            const steps = within(
                screen.getByRole("heading", { name: "Getting started" })
                    .parentElement!,
            ).getAllByRole("listitem");
            expect(steps).toHaveLength(4);
            for (const step of steps) {
                expect(step).toHaveTextContent("To do:");
            }
            expect(
                screen.queryByRole("heading", { name: "Recent runs" }),
            ).not.toBeInTheDocument();
        });

        it("marks a step done exactly when its own check passes", async () => {
            // A dataset with items but no schema: the "items" step is done and
            // the "schema" step is not, instead of one merged step staying open.
            await renderDashboard({
                datasetCount: 1,
                hasDatasetWithItems: true,
                hasPrompt: true,
            });

            const step = (label: string) =>
                screen.getByRole("link", { name: new RegExp(label) });
            expect(step("Create a dataset and add items")).toHaveTextContent(
                "Done:",
            );
            expect(
                step("Define a labeling schema on a dataset"),
            ).toHaveTextContent("To do:");
            expect(step("Create a prompt")).toHaveTextContent("Done:");
            expect(step("Start your first run")).toHaveTextContent("To do:");
        });

        it("is hidden once the project has a run", async () => {
            await renderDashboard({ runCount: 1 }, [run]);

            expect(
                screen.queryByRole("heading", { name: "Getting started" }),
            ).not.toBeInTheDocument();
        });
    });

    describe("recent runs", () => {
        it("renders a full-width table with numeric progress and a View all link", async () => {
            await renderDashboard({ runCount: 1 }, [run]);

            expect(
                screen.getByRole("heading", { name: "Recent runs" }),
            ).toBeInTheDocument();
            expect(
                screen.getByRole("link", { name: "View all" }),
            ).toHaveAttribute("href", "/runs");

            const table = screen.getByRole("table");
            // No enclosing card: the table sits directly in its section.
            expect(table.closest("[data-slot=card]")).toBeNull();
            const progressHeader = within(table).getByRole("columnheader", {
                name: "Progress",
            });
            expect(progressHeader).toHaveClass("text-right");
            expect(within(table).getByText("40 / 40")).toHaveClass(
                "text-right",
            );
            expect(
                within(table).getByRole("link", { name: "run-1234" }),
            ).toHaveAttribute("href", "/runs/run-12345678-aaaa");
            expect(table.querySelector("time")).toHaveAttribute(
                "datetime",
                "2026-09-01T00:00:00.000Z",
            );
        });

        it("names a run by its note title with the short ID beneath", async () => {
            await renderDashboard({ runCount: 2 }, [
                {
                    ...run,
                    id: "run-aaaaaaaa-1111",
                    noteTitle: "## Baseline before prompt change",
                },
                run,
            ]);

            const table = screen.getByRole("table");
            expect(
                within(table).getByRole("link", {
                    name: "Baseline before prompt change",
                }),
            ).toHaveAttribute("href", "/runs/run-aaaaaaaa-1111");
            expect(within(table).getByText("run-aaaa")).toBeInTheDocument();
            // Without a note the short ID is the link, as in the runs list.
            expect(
                within(table).getByRole("link", { name: "run-1234" }),
            ).toBeInTheDocument();
        });

        it("shows settled cells with failures called out, like the runs list", async () => {
            await renderDashboard({ runCount: 1 }, [
                {
                    ...run,
                    status: "partial",
                    progress: { done: 38, total: 40, failed: 2, pending: 0 },
                },
            ]);

            const cell = within(screen.getByRole("table")).getByText(
                /38 \/ 40/,
            );
            expect(cell).toHaveTextContent("38 / 40 · 2 failed");
            expect(within(cell).getByText(/2 failed/)).toHaveClass(
                "text-error",
            );
        });
    });
});

describe("isSetupComplete", () => {
    it("is true once any run exists", () => {
        expect(isSetupComplete({ ...emptyStats, runCount: 1 })).toBe(true);
        expect(isSetupComplete(emptyStats)).toBe(false);
    });
});
