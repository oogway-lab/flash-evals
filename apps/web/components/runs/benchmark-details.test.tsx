import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { IBenchmarkModelSummary } from "@flash-evals/api-contract";
import { ClassResults, ModelDetails } from "./benchmark-details";

afterEach(cleanup);

const CANDIDATE: IBenchmarkModelSummary = {
    runModelId: "rm-cheap",
    modelId: "cheap",
    isBenchmark: false,
    comparableItems: 20,
    failedItems: 0,
    tasks: [
        {
            key: "notes",
            name: "Notes",
            method: "head_to_head",
            source: "labels",
            n: 20,
            wins: 10,
            ties: 2,
            losses: 8,
            errors: 0,
            winOrTieRate: 0.6,
            assessment: {
                metric: "winOrTieRate",
                value: 0.6,
                threshold: 0.63,
                reference: {
                    value: 0.65,
                    difference: -0.05,
                    interval: { low: -0.2, high: 0.1 },
                    items: 20,
                    maxDrop: 0.02,
                },
                sampleSize: "sufficient",
                verdict: "uncertain",
            },
        },
    ],
    assessment: {
        verdict: "conditional",
        reasons: [
            "Notes: won or tied -5.0 points against the reference's 65% (allowed drop 2 points, 95% CI -20.0 points to +10.0 points); could be either side of the allowed drop.",
        ],
    },
};

describe("ModelDetails", () => {
    it("states a judged task's target as a drop below today's model's own rate", () => {
        render(
            <ModelDetails
                model={CANDIDATE}
                id="details"
                isReference={false}
                referenceName="Big Model"
            />,
        );
        expect(screen.getByText("Won or tied")).toBeInTheDocument();
        expect(
            screen.getByText("≤ 2 pts below Big Model's own 65%"),
        ).toBeInTheDocument();
        expect(screen.getByText("63%+")).toBeInTheDocument();
        expect(
            screen.getByText(/Notes: won or tied -5.0 points against/),
        ).toBeInTheDocument();
    });

    it("shows today's model's results without a verdict of its own", () => {
        render(
            <ModelDetails
                model={{
                    ...CANDIDATE,
                    runModelId: "rm-big",
                    isReference: true,
                    assessment: undefined,
                    tasks: CANDIDATE.tasks.map((task) => ({
                        ...task,
                        assessment: {
                            ...task.assessment,
                            verdict: "reference" as const,
                        },
                    })),
                }}
                id="details"
                isReference
                referenceName="Big Model"
            />,
        );
        expect(
            screen.getByText(/shown for comparison, not judged/),
        ).toBeInTheDocument();
        expect(screen.queryByText("Why this verdict")).toBeNull();
        expect(screen.queryByText(/Meets every target/)).toBeNull();
        expect(
            screen.getAllByLabelText("Task verdict status: Reference").length,
        ).toBeGreaterThan(0);
    });
});

describe("ClassResults", () => {
    it("names the reference model without a stray article", () => {
        render(
            <ClassResults
                task={{
                    ...CANDIDATE.tasks[0]!,
                    key: "call_type",
                    name: "Call type",
                    method: "agreement",
                    source: "model",
                    classes: [
                        {
                            label: "Sales",
                            total: 2,
                            correct: 2,
                            missed: 0,
                            recall: 1,
                            wronglyGiven: 0,
                            confusions: [],
                        },
                    ],
                }}
                referenceName="Big Model"
            />,
        );
        expect(
            screen.getByText(/^Grouped by Big Model's answer\./),
        ).toBeInTheDocument();
    });

    it("shows each label's items kept and missed, and what the model said instead", () => {
        render(
            <ModelDetails
                model={{
                    ...CANDIDATE,
                    tasks: [
                        {
                            ...CANDIDATE.tasks[0]!,
                            key: "call_type",
                            name: "Call type",
                            method: "agreement",
                            classes: [
                                {
                                    label: "Sales",
                                    total: 218,
                                    correct: 204,
                                    missed: 14,
                                    recall: 204 / 218,
                                    wronglyGiven: 3,
                                    confusions: [
                                        { predicted: "Service", count: 10 },
                                        { predicted: "Other", count: 4 },
                                    ],
                                },
                            ],
                        },
                    ],
                }}
                id="details"
                isReference={false}
                referenceName="Big Model"
            />,
        );
        expect(
            screen.getByRole("heading", {
                name: "Call type: results per label",
            }),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Grouped by the stored answer/),
        ).toBeInTheDocument();
        const row = screen.getByRole("row", { name: /^Sales/ });
        expect(row.textContent).toContain("204 of 218");
        expect(row.textContent).toContain("14");
        expect(row.textContent).toContain("93.6%");
        expect(row.textContent).toContain("Service (10), Other (4)");
    });

    it("says how many items were left out for a list or object answer", () => {
        render(
            <ModelDetails
                model={{
                    ...CANDIDATE,
                    tasks: [
                        {
                            ...CANDIDATE.tasks[0]!,
                            key: "call_type",
                            name: "Call type",
                            method: "agreement",
                            classesSkipped: 2,
                            classes: [
                                {
                                    label: "Sales",
                                    total: 3,
                                    correct: 3,
                                    missed: 0,
                                    recall: 1,
                                    wronglyGiven: 0,
                                    confusions: [],
                                },
                            ],
                        },
                    ],
                }}
                id="details"
                isReference={false}
                referenceName="Big Model"
            />,
        );
        expect(
            screen.getByText(
                /2 items left out: an answer was a list or object, not one label\./,
            ),
        ).toBeInTheDocument();
    });

    it("shows nothing per label for tasks without classes", () => {
        render(
            <ModelDetails
                model={CANDIDATE}
                id="details"
                isReference={false}
                referenceName="Big Model"
            />,
        );
        expect(screen.queryByText(/results per label/)).toBeNull();
    });
});
