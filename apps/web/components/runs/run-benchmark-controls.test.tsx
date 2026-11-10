import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { IBenchmarkTask } from "@flash-evals/api-contract";
import { pickOption } from "@/components/ui/test-utils";
import {
    DraftTasksButton,
    TaskSourcePicker,
    TextMatchingEditor,
    type ProposeTaskMapAction,
} from "./run-benchmark-controls";

afterEach(cleanup);

const TASK_MAP = {
    tasks: [
        {
            key: "sales",
            name: "Sales call",
            method: "agreement" as const,
            fields: [{ path: "$.is_sales", matcher: "exact" as const }],
        },
    ],
};

describe("DraftTasksButton", () => {
    it("fills the tasks from the model and shows its notes", async () => {
        const action = vi.fn<ProposeTaskMapAction>(async () => ({
            ok: true,
            taskMap: TASK_MAP,
            source: "model",
            notes: ["Sales call: A yes/no label."],
            rejected: [],
        }));
        const onDraft = vi.fn();
        const { getByRole, findByText } = render(
            <DraftTasksButton
                promptVersionId="pv-1"
                action={action}
                onDraft={onDraft}
            />,
        );
        fireEvent.click(getByRole("button", { name: "Draft with a model" }));
        expect(await findByText("Sales call: A yes/no label.")).toBeTruthy();
        expect(action).toHaveBeenCalledWith("pv-1");
        expect(onDraft).toHaveBeenCalledWith(TASK_MAP);
    });

    it("explains a schema fallback and shows errors without changing tasks", async () => {
        const fallback = vi.fn<ProposeTaskMapAction>(async () => ({
            ok: true,
            taskMap: TASK_MAP,
            source: "schema",
            notes: [],
            rejected: ['Sales: "$.x" is not in the output schema.'],
        }));
        const view = render(
            <DraftTasksButton
                promptVersionId="pv-1"
                action={fallback}
                onDraft={vi.fn()}
            />,
        );
        fireEvent.click(
            view.getByRole("button", { name: "Draft with a model" }),
        );
        expect(
            await view.findByText('Sales: "$.x" is not in the output schema.'),
        ).toBeTruthy();
        cleanup();

        const onDraft = vi.fn();
        const failing = render(
            <DraftTasksButton
                promptVersionId="pv-1"
                action={async () => ({ ok: false, error: "No provider key." })}
                onDraft={onDraft}
            />,
        );
        fireEvent.click(
            failing.getByRole("button", { name: "Draft with a model" }),
        );
        await waitFor(() =>
            expect(failing.getByText("No provider key.")).toBeTruthy(),
        );
        expect(onDraft).not.toHaveBeenCalled();
    });

    it("is disabled without a prompt version", () => {
        const { getByRole } = render(
            <DraftTasksButton
                promptVersionId=""
                action={vi.fn()}
                onDraft={vi.fn()}
            />,
        );
        expect(
            getByRole("button", { name: "Draft with a model" }),
        ).toBeDisabled();
    });
});

describe("TextMatchingEditor", () => {
    const task: IBenchmarkTask = {
        key: "brands",
        name: "Brands",
        method: "agreement",
        fields: [{ path: "$.brands", matcher: "set_overlap" }],
    };

    it("saves aliases on blur and fuzzy matching as a fraction", () => {
        const onChange = vi.fn();
        const { getByLabelText } = render(
            <TextMatchingEditor task={task} id="t" onChange={onChange} />,
        );
        const aliases = getByLabelText("Other spellings");
        fireEvent.change(aliases, {
            target: { value: "Parle-G: parleji, parle g" },
        });
        fireEvent.blur(aliases);
        expect(onChange).toHaveBeenLastCalledWith({
            ...task,
            textMatching: { aliases: { "Parle-G": ["parleji", "parle g"] } },
        });
        fireEvent.change(getByLabelText("Fuzzy match (%)"), {
            target: { value: "85" },
        });
        expect(onChange).toHaveBeenLastCalledWith({
            ...task,
            textMatching: { fuzzy: 0.85 },
        });
    });

    it("is not shown for head-to-head tasks", () => {
        const { container } = render(
            <TextMatchingEditor
                task={{
                    key: "s",
                    name: "S",
                    method: "head_to_head",
                    paths: ["$.s"],
                }}
                id="t"
                onChange={vi.fn()}
            />,
        );
        expect(container.textContent).toBe("");
    });
});

describe("TaskSourcePicker", () => {
    const task: IBenchmarkTask = TASK_MAP.tasks[0]!;

    it("sets a task's yardstick and maps the run default to no source", async () => {
        const onChange = vi.fn();
        const { getByRole, findByRole, rerender } = render(
            <TaskSourcePicker task={task} id="t" onChange={onChange} />,
        );
        const picker = getByRole("combobox", { name: "Compare against" });
        expect(picker.textContent).toContain("Run default");
        fireEvent.click(picker);
        pickOption(await findByRole("option", { name: "Stored answers" }));
        expect(onChange).toHaveBeenLastCalledWith({
            ...task,
            source: "labels",
        });

        rerender(
            <TaskSourcePicker
                task={{ ...task, source: "labels" }}
                id="t"
                onChange={onChange}
            />,
        );
        fireEvent.click(getByRole("combobox", { name: "Compare against" }));
        pickOption(await findByRole("option", { name: "Run default" }));
        expect(onChange).toHaveBeenLastCalledWith(task);
    });
});
