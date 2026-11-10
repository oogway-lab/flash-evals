import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { IBenchmarkTask } from "@flash-evals/api-contract";
import { ItemFilterFields, filterableTasks } from "./item-filter-fields";

afterEach(cleanup);

const TASKS: IBenchmarkTask[] = [
    {
        key: "call_type",
        name: "Call type",
        method: "agreement",
        fields: [{ path: "$.call_type", matcher: "exact" }],
    },
    {
        key: "both",
        name: "Both",
        method: "agreement",
        fields: [
            { path: "$.a", matcher: "exact" },
            { path: "$.b", matcher: "exact" },
        ],
    },
    { key: "summary", name: "Summary", method: "head_to_head", paths: ["$.s"] },
];

function hidden(container: HTMLElement, name: string): string | undefined {
    return (
        container.querySelector<HTMLInputElement>(
            `input[type="hidden"][name="${name}"]`,
        )?.value ?? undefined
    );
}

describe("ItemFilterFields", () => {
    it("offers only tasks that compare one field", () => {
        expect(filterableTasks(TASKS)).toEqual([
            { key: "call_type", name: "Call type", path: "$.call_type" },
        ]);
    });

    it("renders nothing without such a task", () => {
        const { container } = render(
            <ItemFilterFields tasks={TASKS.slice(1)} />,
        );
        expect(container.innerHTML).toBe("");
    });

    it("sends the task and label once both are set", () => {
        const { container } = render(
            <ItemFilterFields
                tasks={TASKS}
                initial={{ taskKey: "call_type", equals: "sales" }}
            />,
        );
        expect(hidden(container, "itemFilterTaskKey")).toBe("call_type");
        expect(hidden(container, "itemFilterEquals")).toBe("sales");
        fireEvent.change(screen.getByLabelText("Label equals"), {
            target: { value: "  " },
        });
        expect(hidden(container, "itemFilterTaskKey")).toBeUndefined();
    });

    it("sends nothing while all items are chosen", () => {
        const { container } = render(<ItemFilterFields tasks={TASKS} />);
        expect(screen.getByLabelText("Label equals")).toBeDisabled();
        expect(hidden(container, "itemFilterEquals")).toBeUndefined();
    });

    it("keeps a path filter from the repeated run, until removed", () => {
        const { container } = render(
            <ItemFilterFields
                tasks={TASKS}
                initial={{ path: "$.language", equals: "hindi" }}
            />,
        );
        expect(
            screen.getByText(
                'Only items whose stored answer has $.language equal to "hindi", as in the run this repeats.',
            ),
        ).toBeInTheDocument();
        expect(hidden(container, "itemFilterPath")).toBe("$.language");
        expect(hidden(container, "itemFilterEquals")).toBe("hindi");
        fireEvent.click(
            screen.getByRole("button", { name: "Run on all items" }),
        );
        expect(hidden(container, "itemFilterPath")).toBeUndefined();
        expect(hidden(container, "itemFilterEquals")).toBeUndefined();
        expect(screen.getByLabelText("Label equals")).toHaveValue("");
    });

    it("keeps a path filter on a run without tasks", () => {
        const { container } = render(
            <ItemFilterFields
                tasks={[]}
                initial={{ path: "$.language", equals: "hindi" }}
            />,
        );
        expect(hidden(container, "itemFilterPath")).toBe("$.language");
    });
});
