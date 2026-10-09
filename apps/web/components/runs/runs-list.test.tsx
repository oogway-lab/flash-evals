import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({ deleteRunAction: vi.fn() }));

import type { IRunListRow } from "@mosaic/api-contract";
import { RunsList } from "./runs-list";

afterEach(cleanup);

const run: IRunListRow = {
    id: "e12581e7-d31b-4555-8303-59f3ab2ecf11",
    status: "completed",
    createdAt: "2026-06-23T16:09:50.000Z",
    datasetId: "ds-1",
    datasetName: "Food",
    models: ["gpt-4o"],
    progress: { done: 1, total: 1, failed: 0, pending: 0 },
};

const namedRun: IRunListRow = {
    id: "2900dc8c-0663-4e45-847f-d8531a7bbed7",
    status: "completed",
    createdAt: "2026-06-23T16:08:10.000Z",
    datasetId: "ds-1",
    datasetName: "Food",
    models: ["gpt-4.1-nano", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
    progress: { done: 38, total: 40, failed: 2, pending: 0 },
    noteTitle: "Macronutrient prompt optimized",
    best: {
        modelId: "gpt-4.1-nano",
        score: 0.9625,
        metric: "judge",
        scored: 4,
        total: 4,
        tiedCount: 1,
    },
};

function rowFor(text: string) {
    return screen
        .getAllByRole("row")
        .find((r) => r.textContent?.includes(text))!;
}

describe("RunsList", () => {
    it("offers Clear filter, not New run, when a filter matches nothing", () => {
        render(<RunsList runs={[run]} />);
        fireEvent.click(screen.getByRole("tab", { name: "Failed" }));
        expect(
            screen.getByText("No runs match this filter"),
        ).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "New run" })).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
        expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
            "aria-selected",
            "true",
        );
        expect(
            screen.getByRole("link", { name: "e12581e7" }),
        ).toBeInTheDocument();
    });

    it("names a run by its note title and keeps the short ID beneath", () => {
        render(<RunsList runs={[namedRun, run]} />);
        const named = rowFor("Macronutrient");
        expect(
            within(named).getByRole("link", {
                name: "Macronutrient prompt optimized",
            }),
        ).toHaveAttribute("href", `/runs/${namedRun.id}`);
        expect(within(named).getByText("2900dc8c")).toBeInTheDocument();

        // Without a note the mono short ID is the link.
        const plain = rowFor("e12581e7");
        expect(
            within(plain).getByRole("link", { name: "e12581e7" }),
        ).toHaveAttribute("href", `/runs/${run.id}`);
    });

    it("counts models and lists them in a tooltip instead of truncating", async () => {
        render(<RunsList runs={[namedRun]} />);
        const cell = within(rowFor("Macronutrient")).getByText("4 models");
        expect(cell).toBeInTheDocument();
        fireEvent.mouseEnter(cell);
        fireEvent.mouseMove(cell);
        const list = await screen.findByRole("tooltip");
        expect(within(list).getAllByRole("listitem")).toHaveLength(4);
        expect(within(list).getByText("gpt-5.4-mini")).toBeInTheDocument();
    });

    it("shows the best model and its score, or en dashes when unscored", () => {
        render(<RunsList runs={[namedRun, run]} />);
        const scored = within(rowFor("Macronutrient"));
        expect(scored.getByText("gpt-4.1-nano")).toBeInTheDocument();
        expect(scored.getByText("0.96")).toBeInTheDocument();

        const unscored = within(rowFor("e12581e7"));
        expect(unscored.queryByText(/\d\.\d\d/)).toBeNull();
        expect(unscored.getAllByText("not available").length).toBeGreaterThan(
            0,
        );
    });

    it("qualifies a winner that only some of the models were scored for", () => {
        render(
            <RunsList
                runs={[
                    {
                        ...namedRun,
                        best: { ...namedRun.best!, scored: 2, total: 4 },
                    },
                    {
                        ...namedRun,
                        id: "complete-run-0000",
                        noteTitle: "Fully scored",
                    },
                ]}
            />,
        );
        const partial = within(rowFor("Macronutrient"));
        expect(partial.getByText("gpt-4.1-nano")).toBeInTheDocument();
        expect(partial.getByText("best of 2 scored")).toBeInTheDocument();

        const complete = within(rowFor("Fully scored"));
        expect(complete.getByText("gpt-4.1-nano")).toBeInTheDocument();
        expect(complete.queryByText(/best of/)).toBeNull();
    });

    it("qualifies a tie among a partial set of scored models too", () => {
        render(
            <RunsList
                runs={[
                    {
                        ...namedRun,
                        best: {
                            ...namedRun.best!,
                            scored: 2,
                            total: 3,
                            tiedCount: 2,
                        },
                    },
                ]}
            />,
        );
        expect(screen.getByText("2 models tied")).toBeInTheDocument();
        expect(screen.getByText("best of 2 scored")).toBeInTheDocument();
    });

    it("calls the best model the leader while the run is still in progress", () => {
        render(
            <RunsList
                runs={[
                    {
                        ...namedRun,
                        status: "running",
                        noteTitle: "Still running",
                        progress: {
                            done: 20,
                            total: 40,
                            failed: 0,
                            pending: 20,
                        },
                    },
                    {
                        ...namedRun,
                        id: "pending-cells-0000",
                        noteTitle: "Pending cells",
                        progress: {
                            done: 38,
                            total: 40,
                            failed: 0,
                            pending: 2,
                        },
                    },
                    {
                        ...namedRun,
                        id: "partial-running-0",
                        status: "running",
                        noteTitle: "Running partial",
                        best: { ...namedRun.best!, scored: 2, total: 4 },
                    },
                    {
                        ...namedRun,
                        id: "settled-run-00000",
                        noteTitle: "Settled",
                    },
                ]}
            />,
        );
        expect(
            within(rowFor("Still running")).getByText("leading"),
        ).toBeInTheDocument();
        expect(
            within(rowFor("Pending cells")).getByText("leading"),
        ).toBeInTheDocument();
        expect(
            within(rowFor("Running partial")).getByText("leading of 2 scored"),
        ).toBeInTheDocument();
        expect(
            within(rowFor("Settled")).queryByText(/leading|best of/),
        ).toBeNull();
    });

    it("reports a tie instead of naming a winner", () => {
        render(
            <RunsList
                runs={[
                    {
                        ...namedRun,
                        best: { ...namedRun.best!, tiedCount: 2 },
                    },
                ]}
            />,
        );
        expect(screen.getByText("2 models tied")).toBeInTheDocument();
    });

    it("shows settled cells as done of total with failures called out", () => {
        render(<RunsList runs={[namedRun]} />);
        const cells = within(rowFor("Macronutrient"));
        expect(cells.getByText(/38 \/ 40/)).toBeInTheDocument();
        expect(cells.getByText(/2 failed/)).toBeInTheDocument();
    });

    it("renders created as a relative <time>", () => {
        const { container } = render(<RunsList runs={[namedRun]} />);
        expect(container.querySelector("time")).toHaveAttribute(
            "datetime",
            "2026-06-23T16:08:10.000Z",
        );
    });

    it("moves delete into a row overflow menu with a confirm dialog", async () => {
        render(<RunsList runs={[namedRun]} />);
        expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();

        fireEvent.click(
            screen.getByRole("button", {
                name: "More actions for Macronutrient prompt optimized",
            }),
        );
        fireEvent.click(
            await screen.findByRole("menuitem", { name: "Delete run" }),
        );
        expect(
            await screen.findByRole("heading", { name: "Delete run?" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Cancel" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Delete" }),
        ).toBeInTheDocument();
    });

    it("does not wrap the filter tabs and table in a card", () => {
        const { container } = render(<RunsList runs={[run]} />);
        expect(container.querySelector('[data-slot="card"]')).toBeNull();
    });
});
