import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import type { IPromptListRow } from "@mosaic/api-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({
    deletePromptAction: vi.fn(),
}));
vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

import { PromptsList } from "./prompts-list";

afterEach(cleanup);

function prompt(
    id: string,
    name: string,
    overrides: Partial<IPromptListRow> = {},
): IPromptListRow {
    return {
        id,
        name,
        description: null,
        kind: "eval",
        latest: {
            version: 3,
            status: "runnable",
            createdAt: "2026-06-20T00:00:00.000Z",
            optimizedWithAi: false,
        },
        ...overrides,
    };
}

describe("PromptsList", () => {
    it("links the name to the prompt and summarizes the latest version", () => {
        render(
            <PromptsList
                prompts={[
                    prompt("p-1", "Dish namer", {
                        description: "Names the dish in a photo",
                    }),
                ]}
            />,
        );

        const row = screen.getByRole("row", { name: /Dish namer/ });
        expect(
            within(row).getByRole("link", { name: "Dish namer" }),
        ).toHaveAttribute("href", "/prompts/p-1");
        expect(row).toHaveTextContent("Names the dish in a photo");
        expect(row).toHaveTextContent("Eval");
        expect(row).toHaveTextContent("v3");
        expect(
            within(row).getByLabelText("Prompt status: Runnable"),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("columnheader", { name: "Version" }),
        ).toHaveClass("text-right");
    });

    it("marks AI-optimized prompts with plain text, not a badge", () => {
        render(
            <PromptsList
                prompts={[
                    prompt("p-3", "Optimized prompt", {
                        latest: {
                            version: 2,
                            status: "runnable",
                            createdAt: "2026-06-20T00:00:00.000Z",
                            optimizedWithAi: true,
                        },
                    }),
                    prompt("p-4", "Plain prompt"),
                ]}
            />,
        );

        expect(screen.getAllByText("Optimized with AI")).toHaveLength(1);
        const marker = screen.getByText("Optimized with AI");
        expect(marker.closest('[data-slot="badge"]')).toBeNull();
    });

    it("shows legacy prompts as a warning status and handles missing versions", () => {
        render(
            <PromptsList
                prompts={[
                    prompt("p-2", "Summarizer", {
                        latest: {
                            version: 1,
                            status: "legacy",
                            createdAt: "2026-06-19T00:00:00.000Z",
                            optimizedWithAi: false,
                        },
                    }),
                    prompt("p-5", "Empty prompt", { latest: undefined }),
                ]}
            />,
        );

        expect(
            screen.getByLabelText("Prompt status: Legacy"),
        ).toBeInTheDocument();
        const empty = screen.getByRole("row", { name: /Empty prompt/ });
        expect(within(empty).getAllByText("not available")).toHaveLength(3);
    });

    it("keeps delete in an overflow menu and confirms first", () => {
        render(<PromptsList prompts={[prompt("p-1", "Dish namer")]} />);

        expect(
            screen.queryByRole("button", { name: "Delete Dish namer" }),
        ).not.toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", { name: "More actions for Dish namer" }),
        );
        fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
        expect(
            screen.getByRole("alertdialog", { name: "Delete prompt?" }),
        ).toBeInTheDocument();
    });

    it("filters by name and offers to clear the search", () => {
        render(
            <PromptsList
                prompts={[
                    prompt("p-1", "Dish namer"),
                    prompt("p-2", "Summary"),
                ]}
            />,
        );

        fireEvent.change(screen.getByLabelText("Search prompts by name"), {
            target: { value: "dish" },
        });
        expect(screen.getByText("Dish namer")).toBeInTheDocument();
        expect(screen.queryByText("Summary")).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText("Search prompts by name"), {
            target: { value: "zzz" },
        });
        expect(screen.getByText("No prompts match “zzz”")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
        expect(screen.getByText("Summary")).toBeInTheDocument();
    });
});
