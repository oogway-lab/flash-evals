import { afterEach, describe, expect, it } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import type {
    BenchmarkTaskVerdict,
    IBenchmarkTaskSummary,
    IRunBenchmarkConfig,
} from "@flash-evals/api-contract";
import { TaskGrid, pointsAgainst, taskMethodLabel } from "./task-grid";
import type { IModelResult } from "./run-results";

afterEach(cleanup);

const BENCHMARK: IRunBenchmarkConfig = {
    source: "model",
    taskMap: {
        tasks: [
            {
                key: "label",
                name: "Sales label",
                method: "agreement",
                source: "labels",
                fields: [{ path: "$.label", matcher: "exact" }],
            },
            {
                key: "tags",
                name: "Tags",
                method: "agreement",
                judgeDisagreements: true,
                fields: [{ path: "$.tags", matcher: "set_overlap" }],
            },
            {
                key: "summary",
                name: "Summary",
                method: "head_to_head",
                paths: ["$.summary"],
            },
        ],
    },
};

function task(
    key: string,
    value: number,
    verdict: BenchmarkTaskVerdict,
): IBenchmarkTaskSummary {
    return {
        key,
        name: key,
        method: "agreement",
        n: 30,
        wins: 0,
        ties: 0,
        losses: 0,
        errors: 0,
        assessment: {
            metric: "agreement",
            value,
            interval: { low: value - 0.1, high: Math.min(1, value + 0.05) },
            threshold: 0.9,
            sampleSize: "sufficient",
            verdict,
        },
    };
}

function model(
    id: string,
    name: string,
    tasks: IBenchmarkTaskSummary[],
    extra: Partial<IModelResult> = {},
): IModelResult {
    return {
        runModelId: id,
        modelId: id,
        name,
        isReference: false,
        failedCells: 0,
        cells: 30,
        comparison: {
            runModelId: id,
            modelId: id,
            isBenchmark: false,
            comparableItems: 30,
            failedItems: 0,
            tasks,
        },
        ...extra,
    };
}

const REFERENCE = model(
    "rm-big",
    "Big Model",
    [task("label", 0.9, "reference")],
    {
        isReference: true,
    },
);
const CHEAP = model(
    "rm-cheap",
    "Cheap Model",
    [
        task("label", 0.95, "pass"),
        task("tags", 0.6, "fail"),
        task("summary", 0.3, "insufficient"),
    ],
    { relativeCost: 0.05 },
);

const table = () => within(document.querySelector("table") as HTMLElement);

describe("TaskGrid", () => {
    it("puts tasks down and models across, today's model last", () => {
        render(<TaskGrid results={[REFERENCE, CHEAP]} benchmark={BENCHMARK} />);
        const headers = table()
            .getAllByRole("columnheader")
            .map((th) => th.textContent);
        expect(headers).toEqual([
            "Task",
            "Cheap Model5% of the cost",
            "Big Modeltoday's model",
        ]);
        expect(
            table().getByText("vs stored answers · exact"),
        ).toBeInTheDocument();
        expect(
            table().getByText(
                "vs Big Model · list overlap, judge settles differences",
            ),
        ).toBeInTheDocument();
        expect(
            table().getByText("vs Big Model · judge: won or tied"),
        ).toBeInTheDocument();
    });

    it("labels each cell with value, status and range, never colour alone", () => {
        render(<TaskGrid results={[REFERENCE, CHEAP]} benchmark={BENCHMARK} />);
        expect(
            table().getByRole("img", {
                name: "Tags, Cheap Model: 60%, Fail. 95% range 50% to 65%. Target 90%.",
            }),
        ).toBeInTheDocument();
        expect(table().getByText("Pass")).toBeInTheDocument();
        expect(table().getByText("Too few")).toBeInTheDocument();
        // Today's model has no value on tasks compared with itself.
        expect(table().getAllByText("not available")).toHaveLength(2);
    });

    it("opens the transcripts behind a result when a cell is clicked", () => {
        const opened: string[] = [];
        render(
            <TaskGrid
                results={[REFERENCE, CHEAP]}
                benchmark={BENCHMARK}
                onOpenCell={(model, task) =>
                    opened.push(`${model.name} × ${task.name}`)
                }
            />,
        );
        fireEvent.click(
            table().getByRole("button", {
                name: "Tags, Cheap Model: 60%, Fail. 95% range 50% to 65%. Target 90%. Show the transcripts.",
            }),
        );
        expect(opened).toEqual(["Cheap Model × Tags"]);
    });

    it("switches to points against today's model where it has a value", () => {
        render(<TaskGrid results={[REFERENCE, CHEAP]} benchmark={BENCHMARK} />);
        fireEvent.click(
            screen.getByRole("button", { name: "Against Big Model" }),
        );
        expect(
            screen.getByRole("button", { name: "Against Big Model" }),
        ).toHaveAttribute("aria-pressed", "true");
        expect(table().getByText("+5 pts")).toBeInTheDocument();
        // Today's model still shows its own score.
        expect(table().getByText("90%")).toBeInTheDocument();
    });

    it("states each task's target in its header", () => {
        render(
            <TaskGrid
                results={[REFERENCE, CHEAP]}
                benchmark={{
                    ...BENCHMARK,
                    policy: { maxDropBelowReference: 0.02 },
                }}
            />,
        );
        // On the stored answers today's model is scored too.
        expect(
            table().getByText("Target: ≤ 2 pts below Big Model's own rate"),
        ).toBeInTheDocument();
        // Against today's model, the fixed minimums.
        expect(table().getAllByText("Target: won or tied 90%+")).toHaveLength(
            2,
        );
    });

    it("names today's model's own rate in a judged cell compared with it", () => {
        const notes: IBenchmarkTaskSummary = {
            ...task("notes", 0.6, "pass"),
            method: "head_to_head",
            assessment: {
                metric: "winOrTieRate",
                value: 0.6,
                threshold: 0.63,
                reference: {
                    value: 0.65,
                    difference: -0.05,
                    items: 20,
                    maxDrop: 0.02,
                },
                sampleSize: "sufficient",
                verdict: "uncertain",
            },
        };
        render(
            <TaskGrid
                results={[REFERENCE, model("rm-cheap", "Cheap Model", [notes])]}
                benchmark={{
                    source: "labels",
                    taskMap: {
                        tasks: [
                            {
                                key: "notes",
                                name: "Notes",
                                method: "head_to_head",
                                paths: ["$.notes"],
                            },
                        ],
                    },
                    policy: { maxDropBelowReference: 0.02 },
                }}
            />,
        );
        expect(
            table().getByRole("img", {
                name: "Notes, Cheap Model: 60%, Unsure. Target 63%: no more than 2 pts below Big Model's own 65%.",
            }),
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                /the target is its own rate on the same transcripts minus the allowed drop/,
            ),
        ).toBeInTheDocument();
    });

    it("shows one card per model on small screens", () => {
        render(<TaskGrid results={[REFERENCE, CHEAP]} benchmark={BENCHMARK} />);
        const cards = screen
            .getAllByRole("listitem")
            .filter(
                (li) =>
                    li.textContent?.includes("of the cost") ||
                    li.textContent?.includes("today's model"),
            );
        expect(cards[0]?.textContent).toContain("Cheap Model");
        expect(cards.at(-1)?.textContent).toContain("Big Model");
    });
});

describe("TaskGrid reference column", () => {
    it("shows today's model's value with a neutral Reference status, no target", () => {
        render(<TaskGrid results={[REFERENCE, CHEAP]} benchmark={BENCHMARK} />);
        const cell = table().getByRole("img", {
            name: "Sales label, Big Model: 90%, Reference. 95% range 80% to 95%. Shown for comparison, not judged.",
        });
        expect(cell.textContent).toContain("90%");
        expect(cell.textContent).toContain("Reference");
        expect(cell.textContent).not.toMatch(/Pass|Unsure|Fail/);
        const cards = screen
            .getAllByRole("listitem")
            .filter((li) => li.textContent?.includes("today's model"));
        expect(cards.at(-1)?.textContent).toContain("Reference");
        expect(cards.at(-1)?.textContent).not.toMatch(/Unsure|Fail/);
    });
});

describe("taskMethodLabel and pointsAgainst", () => {
    it("describes how a task is compared", () => {
        expect(taskMethodLabel(BENCHMARK.taskMap.tasks[0]!)).toBe("exact");
    });

    it("gives the difference in points, rounded to one decimal", () => {
        expect(pointsAgainst(0.756, 0.903)).toBe(-14.7);
        expect(pointsAgainst(0.5, undefined)).toBeUndefined();
    });
});
