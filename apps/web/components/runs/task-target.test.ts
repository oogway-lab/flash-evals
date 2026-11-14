import { describe, expect, it } from "vitest";
import type { IBenchmarkTask } from "@flash-evals/api-contract";
import { taskTargetFromPolicy, taskTargetText } from "./task-target";

const NOTES: IBenchmarkTask = {
    key: "notes",
    name: "Meeting notes",
    method: "head_to_head",
    paths: ["$.notes"],
};
const LABEL: IBenchmarkTask = {
    key: "label",
    name: "Sales label",
    method: "agreement",
    fields: [{ path: "$.label", matcher: "exact" }],
};
const TAGS: IBenchmarkTask = {
    key: "tags",
    name: "Tags",
    method: "agreement",
    judgeDisagreements: true,
    fields: [{ path: "$.tags", matcher: "set_overlap" }],
};
const RULES: IBenchmarkTask = {
    key: "checks",
    name: "Checks",
    method: "rules",
    rules: [
        {
            key: "no_labels",
            name: "No speaker labels",
            kind: "pattern_absent",
            paths: ["$.notes"],
            patterns: ["Speaker \\d"],
        },
    ],
};

const targets = {
    maxDropPts: 2,
    minAgreementPct: 90,
    minWinOrTiePct: 85,
    referenceName: "Big Model",
};

describe("taskTargetText", () => {
    it("says judged tasks on stored answers are compared with today's model's own rate", () => {
        expect(
            taskTargetText({ ...targets, task: NOTES, source: "labels" }),
        ).toBe("≤ 2 pts below Big Model's own rate");
        expect(
            taskTargetText({ ...targets, task: TAGS, source: "labels" }),
        ).toBe("≤ 2 pts below Big Model's own rate");
        expect(
            taskTargetText({ ...targets, task: LABEL, source: "labels" }),
        ).toBe("≤ 2 pts below Big Model's own rate");
        expect(
            taskTargetText({ ...targets, task: RULES, source: undefined }),
        ).toBe("≤ 2 pts below Big Model's own rate");
    });

    it("keeps the fixed minimums where today's model is the benchmark", () => {
        expect(
            taskTargetText({ ...targets, task: NOTES, source: "model" }),
        ).toBe("won or tied 85%+");
        expect(
            taskTargetText({ ...targets, task: TAGS, source: "model" }),
        ).toBe("won or tied 85%+");
        expect(
            taskTargetText({ ...targets, task: LABEL, source: "model" }),
        ).toBe("90%+");
    });

    it("uses the minimums when no drop is allowed", () => {
        const { maxDropPts: _unused, ...noDrop } = targets;
        expect(
            taskTargetText({ ...noDrop, task: NOTES, source: "labels" }),
        ).toBe("won or tied 85%+");
    });
});

describe("taskTargetFromPolicy", () => {
    it("reads rates from the saved policy and per-task overrides", () => {
        expect(
            taskTargetFromPolicy({
                task: NOTES,
                source: "labels",
                policy: {
                    maxDropBelowReference: 0.02,
                    tasks: { notes: { maxDropBelowReference: 0.05 } },
                },
                referenceName: "Big Model",
            }),
        ).toBe("≤ 5 pts below Big Model's own rate");
        expect(
            taskTargetFromPolicy({
                task: NOTES,
                source: "model",
                policy: undefined,
                referenceName: undefined,
            }),
        ).toBe("won or tied 90%+");
    });
});
