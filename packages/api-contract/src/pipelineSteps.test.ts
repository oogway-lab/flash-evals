import { describe, expect, it } from "vitest";
import {
    assembleFinalAnswer,
    describeRunCondition,
    describeStepCondition,
    runConditionErrors,
    runConditionFrom,
    runConditionList,
    finalAnswerErrors,
    formatConditionValues,
    isEmptyFinalValue,
    parseConditionValues,
    stepAnswerValue,
    stepConditionErrors,
    stepConditionHolds,
    type IFinalAnswerStepResult,
    type IWorkflowStepCondition,
    stepSettingsErrors,
} from "./pipelineSteps.js";

const salesOnly: IWorkflowStepCondition = {
    stepKey: "classify",
    path: "$.is_sales",
    operator: "equals",
    values: [true],
};

describe("step conditions", () => {
    it("runs a step only when the checked field equals the value", () => {
        expect(stepConditionHolds(salesOnly, { is_sales: true })).toBe(true);
        expect(stepConditionHolds(salesOnly, { is_sales: false })).toBe(false);
        // A missing field never matches, so the chain ends.
        expect(stepConditionHolds(salesOnly, {})).toBe(false);
        // Types must match: the text "true" is not the value true.
        expect(stepConditionHolds(salesOnly, { is_sales: "true" })).toBe(false);
    });

    it("matches any listed value with one_of, including nested fields", () => {
        const kinds: IWorkflowStepCondition = {
            stepKey: "classify",
            path: "$.call.kind",
            operator: "one_of",
            values: ["sales", "renewal"],
        };
        expect(stepConditionHolds(kinds, { call: { kind: "renewal" } })).toBe(
            true,
        );
        expect(stepConditionHolds(kinds, { call: { kind: "support" } })).toBe(
            false,
        );
    });

    it("can check a plain-text answer as a whole with $", () => {
        expect(
            stepConditionHolds(
                { ...salesOnly, path: "$", values: ["yes"] },
                "yes",
            ),
        ).toBe(true);
    });

    it("reads a step's answer from its JSON, or parses its text", () => {
        expect(stepAnswerValue({ json: { a: 1 }, text: "x" })).toEqual({
            a: 1,
        });
        expect(stepAnswerValue({ text: '{"a":2}' })).toEqual({ a: 2 });
        expect(stepAnswerValue({ text: "plain" })).toBe("plain");
    });

    it("parses typed values and formats them back", () => {
        const values = parseConditionValues(
            'true, 3, null, sales, "false", "7"',
        );
        expect(values).toEqual([true, 3, null, "sales", "false", "7"]);
        expect(formatConditionValues(values)).toBe(
            'true, 3, null, sales, "false", "7"',
        );
    });

    it("rejects a condition on a later step, a missing field or no values", () => {
        expect(
            stepConditionErrors(salesOnly, "Notes", new Set(["classify"])),
        ).toEqual([]);
        expect(
            stepConditionErrors(
                { ...salesOnly, path: "", values: [] },
                "Notes",
                new Set(),
            ),
        ).toEqual([
            'Step "Notes" can only check a step that runs before it.',
            'Step "Notes" needs a field to check, such as $.is_sales.',
            'Step "Notes" needs at least one value to match.',
        ]);
    });

    it("describes a condition in plain words", () => {
        expect(describeStepCondition(salesOnly, "Classify")).toBe(
            "Runs only when Classify $.is_sales is true",
        );
    });
});

describe("run conditions on several fields", () => {
    const archived: IWorkflowStepCondition = {
        stepKey: "extract",
        path: "$.archived",
        operator: "equals",
        values: [false],
    };
    const sales: IWorkflowStepCondition = {
        stepKey: "extract",
        path: "$.type",
        operator: "equals",
        values: ["sales"],
    };

    it("reads one condition or a group as a list, and writes one back as one", () => {
        expect(runConditionList(undefined)).toEqual([]);
        expect(runConditionList(archived)).toEqual([archived]);
        expect(runConditionList({ all: [archived, sales] })).toEqual([
            archived,
            sales,
        ]);
        expect(runConditionFrom([])).toBeUndefined();
        expect(runConditionFrom([archived])).toEqual(archived);
        expect(runConditionFrom([archived, sales])).toEqual({
            all: [archived, sales],
        });
    });

    it("checks every condition of a group", () => {
        const before = new Set(["extract"]);
        expect(runConditionErrors(archived, "Points", before)).toEqual([]);
        expect(
            runConditionErrors({ all: [archived, sales] }, "Points", before),
        ).toEqual([]);
        expect(runConditionErrors({ all: [] }, "Points", before)).toEqual([
            'Step "Points" needs at least one condition.',
        ]);
        expect(
            runConditionErrors(
                { all: [archived, { ...sales, stepKey: "write" }] },
                "Points",
                before,
            ),
        ).toEqual(['Step "Points" can only check a step that runs before it.']);
    });

    it("describes all conditions in one sentence", () => {
        expect(
            describeRunCondition({ all: [archived, sales] }, () => "Extract"),
        ).toBe(
            "Runs only when Extract $.archived is false and Extract $.type is sales",
        );
    });
});

describe("final answer", () => {
    const mapping = {
        fields: [
            { path: "$.product", stepKey: "extract", stepPath: "$.product" },
            { path: "$.is_sales", stepKey: "extract", stepPath: "$.is_sales" },
            { path: "$.mom", stepKey: "notes", stepPath: "$.mom" },
            { path: "$.meta.points", stepKey: "points", stepPath: "$" },
        ],
    };

    it("combines fields from several steps into one object", () => {
        expect(
            assembleFinalAnswer(
                mapping,
                new Map([
                    [
                        "extract",
                        {
                            status: "succeeded",
                            answer: { product: "crisps", is_sales: true },
                        },
                    ],
                    ["points", { status: "succeeded", answer: ["price"] }],
                    ["notes", { status: "succeeded", answer: { mom: "Met." } }],
                ]),
            ),
        ).toEqual({
            product: "crisps",
            is_sales: true,
            mom: "Met.",
            meta: { points: ["price"] },
        });
    });

    it("leaves out fields of skipped or failed steps", () => {
        expect(
            assembleFinalAnswer(
                mapping,
                new Map([
                    [
                        "extract",
                        {
                            status: "succeeded",
                            answer: { product: "crisps", is_sales: false },
                        },
                    ],
                    ["points", { status: "skipped" }],
                    ["notes", { status: "failed" }],
                ]),
            ),
        ).toEqual({ product: "crisps", is_sales: false });
    });

    it("reports bad paths, missing steps and repeated fields", () => {
        expect(
            finalAnswerErrors(
                {
                    fields: [
                        { path: "$.a", stepKey: "x", stepPath: "$.a" },
                        { path: "$.a", stepKey: "gone", stepPath: "" },
                    ],
                },
                new Set(["x"]),
            ),
        ).toEqual([
            'Final answer field "$.a" is set twice.',
            'Final answer field "$.a" needs a step.',
            'Final answer field "$.a" needs the step\'s field, such as $.product, or $ for its whole answer.',
        ]);
    });

    describe("fallbacks", () => {
        const steps = (
            write: IFinalAnswerStepResult,
        ): Map<string, IFinalAnswerStepResult> =>
            new Map([
                [
                    "extract",
                    {
                        status: "succeeded",
                        label: "Extract",
                        answer: {
                            title: "Old deal",
                            archive_reason: "Closed last year.",
                            contact_role: "",
                            tags: [],
                        },
                    },
                ],
                ["write", { ...write, label: "Write" }],
            ]);
        const summary = {
            path: "$.summary",
            stepKey: "write",
            stepPath: "$.summary",
            fallback: {
                template:
                    "## {{Extract.$.title}}\n\n{{extract.$.archive_reason}}",
            },
        };

        it("fills a skipped step's field from a template over steps that ran", () => {
            expect(
                assembleFinalAnswer(
                    { fields: [summary] },
                    steps({ status: "skipped" }),
                ),
            ).toEqual({ summary: "## Old deal\n\nClosed last year." });
            // A step that ran keeps its own value.
            expect(
                assembleFinalAnswer(
                    { fields: [summary] },
                    steps({ status: "succeeded", answer: { summary: "Met." } }),
                ),
            ).toEqual({ summary: "Met." });
        });

        it("uses a fixed value, keeps a lone placeholder's type and writes missing values as nothing", () => {
            const answer = assembleFinalAnswer(
                {
                    fields: [
                        {
                            path: "$.points",
                            stepKey: "write",
                            stepPath: "$.points",
                            fallback: { value: "None" },
                        },
                        {
                            path: "$.tags",
                            stepKey: "write",
                            stepPath: "$.tags",
                            fallback: { template: "{{Extract.$.tags}}" },
                        },
                        {
                            path: "$.note",
                            stepKey: "write",
                            stepPath: "$.note",
                            fallback: { template: "Reason: {{Write.$.x}}." },
                        },
                    ],
                },
                steps({ status: "skipped" }),
            );
            expect(answer).toEqual({
                points: "None",
                tags: [],
                note: "Reason: .",
            });
        });

        it("maps values and fills empty ones from the empty default, else the fallback", () => {
            const field = (extra: Record<string, unknown>) => ({
                path: "$.role",
                stepKey: "extract",
                stepPath: "$.contact_role",
                ...extra,
            });
            const run = steps({ status: "succeeded", answer: {} });
            expect(
                assembleFinalAnswer(
                    {
                        fields: [
                            field({ valueMap: [{ from: "", to: "Customer" }] }),
                        ],
                    },
                    run,
                ),
            ).toEqual({ role: "Customer" });
            expect(
                assembleFinalAnswer(
                    {
                        fields: [
                            field({
                                whenEmpty: { value: "Unknown" },
                                fallback: { value: "Skipped" },
                            }),
                        ],
                    },
                    run,
                ),
            ).toEqual({ role: "Unknown" });
            expect(
                assembleFinalAnswer(
                    { fields: [field({ fallback: { value: "Skipped" } })] },
                    run,
                ),
            ).toEqual({ role: "Skipped" });
            // With nothing set, an empty value stays as it was.
            expect(assembleFinalAnswer({ fields: [field({})] }, run)).toEqual({
                role: "",
            });
            expect(isEmptyFinalValue([])).toBe(true);
            expect(isEmptyFinalValue(0)).toBe(false);
        });

        it("still leaves out a failed step's field", () => {
            expect(
                assembleFinalAnswer(
                    { fields: [summary] },
                    steps({ status: "failed" }),
                ),
            ).toEqual({});
        });

        it("checks templates name real steps and fields, and values are simple", () => {
            const keys = new Set(["extract", "write"]);
            const labels = new Map([
                ["extract", "Extract"],
                ["write", "Write"],
            ]);
            expect(
                finalAnswerErrors({ fields: [summary] }, keys, labels),
            ).toEqual([]);
            expect(
                finalAnswerErrors(
                    {
                        fields: [
                            {
                                ...summary,
                                fallback: {
                                    template: "{{Notes.$.x}} {{title}}",
                                },
                                whenEmpty: { value: { a: 1 } as never },
                                valueMap: [{ from: "", to: [] as never }],
                            },
                        ],
                    },
                    keys,
                    labels,
                ),
            ).toEqual([
                'The fallback of "$.summary" names "Notes", which is not a step.',
                'The fallback of "$.summary" has {{title}}; write a step and a field, such as {{Extract.$.title}}.',
                'The empty default of "$.summary" can only be text, a number, true, false or null.',
                'Final answer field "$.summary" can only replace text, numbers, true, false or null.',
            ]);
        });
    });
});

describe("step settings", () => {
    it("accepts a temperature from 0 to 2 and a whole output limit", () => {
        expect(
            stepSettingsErrors({ temperature: 0, maxOutputTokens: 8000 }, "A"),
        ).toEqual([]);
        expect(stepSettingsErrors(undefined, "A")).toEqual([]);
    });

    it("says plainly what is wrong", () => {
        expect(stepSettingsErrors({ temperature: 3 }, "Extract")).toEqual([
            'Step "Extract" needs a temperature from 0 to 2.',
        ]);
        expect(stepSettingsErrors({ maxOutputTokens: 1.5 }, "Extract")).toEqual(
            ['Step "Extract" needs an output limit from 1 to 200,000 tokens.'],
        );
        expect(stepSettingsErrors("x", "Extract")).toHaveLength(1);
    });
});

describe("small rule features", () => {
    const steps = new Map([
        [
            "extract",
            {
                label: "Extract",
                status: "succeeded" as const,
                answer: { type: "Non-Sales", title: "", archived: false },
            },
        ],
        ["notes", { label: "Notes", status: "skipped" as const }],
    ]);

    it("fills a missing or empty value with | default", () => {
        expect(
            assembleFinalAnswer(
                {
                    fields: [
                        {
                            path: "$.notes",
                            stepKey: "notes",
                            stepPath: "$.text",
                            fallback: {
                                template:
                                    '{{Extract.$.title | default:"Not discussed"}}',
                            },
                        },
                    ],
                },
                steps,
            ),
        ).toEqual({ notes: "Not discussed" });
    });

    it("matches text in any case when asked", () => {
        const condition = {
            stepKey: "extract",
            path: "$.type",
            operator: "equals" as const,
            values: ["non-sales"],
        };
        const answer = { type: "Non-Sales" };
        expect(stepConditionHolds(condition, answer)).toBe(false);
        expect(
            stepConditionHolds({ ...condition, ignoreCase: true }, answer),
        ).toBe(true);
        expect(
            describeStepCondition(
                { ...condition, ignoreCase: true },
                "Extract",
            ),
        ).toBe("Runs only when Extract $.type is non-sales (any case)");
    });

    it("sets a field when a step's field matches", () => {
        const field = {
            path: "$.archived",
            stepKey: "extract",
            stepPath: "$.archived",
            setWhen: [
                {
                    when: {
                        stepKey: "extract",
                        path: "$.type",
                        operator: "equals" as const,
                        values: ["non-sales"],
                        ignoreCase: true,
                    },
                    value: true,
                },
            ],
        };
        expect(assembleFinalAnswer({ fields: [field] }, steps)).toEqual({
            archived: true,
        });
        const sales = new Map(steps);
        sales.set("extract", {
            label: "Extract",
            status: "succeeded",
            answer: { type: "sales", title: "", archived: false },
        });
        expect(assembleFinalAnswer({ fields: [field] }, sales)).toEqual({
            archived: false,
        });
        expect(
            finalAnswerErrors(
                {
                    fields: [
                        {
                            ...field,
                            setWhen: [
                                {
                                    when: {
                                        ...field.setWhen[0]!.when,
                                        stepKey: "x",
                                    },
                                    value: true,
                                },
                            ],
                        },
                    ],
                },
                new Set(["extract"]),
            ),
        ).toEqual([
            'A rule of "$.archived" must check a step of the pipeline.',
        ]);
    });
});

describe("malformed definitions", () => {
    it("reports a condition whose field is not text instead of throwing", () => {
        expect(
            runConditionErrors(
                {
                    stepKey: "extract",
                    path: 42,
                    operator: "equals",
                    values: [true],
                } as never,
                "Notes",
                new Set(["extract"]),
            ),
        ).toContain('Step "Notes" needs a field to check, such as $.is_sales.');
    });

    it("reports final answer fields whose paths are not text instead of throwing", () => {
        const errors = finalAnswerErrors(
            {
                fields: [
                    { path: 7, stepKey: "extract", stepPath: "$" },
                    { path: "$.a", stepKey: "extract", stepPath: null },
                    null,
                ] as never,
            },
            new Set(["extract"]),
        );
        expect(errors).toHaveLength(3);
        expect(errors[0]).toMatch(/needs a path/);
    });
});

describe("small contract gaps", () => {
    it("sees $.mom and mom as the same final answer field", () => {
        expect(
            finalAnswerErrors(
                {
                    fields: [
                        { path: "$.mom", stepKey: "notes", stepPath: "$.mom" },
                        { path: "mom", stepKey: "notes", stepPath: "$.mom" },
                    ],
                },
                new Set(["notes"]),
            ),
        ).toEqual(['Final answer field "mom" is set twice.']);
    });

    it("refuses $ alone as a final answer field's path", () => {
        expect(
            finalAnswerErrors(
                { fields: [{ path: "$", stepKey: "notes", stepPath: "$" }] },
                new Set(["notes"]),
            ),
        ).toEqual(['Final answer field "$" needs a path such as $.product.']);
    });

    it("keeps a quoted condition value with a comma as one value, both ways", () => {
        expect(parseConditionValues('"a, b", c')).toEqual(["a, b", "c"]);
        expect(
            parseConditionValues(formatConditionValues(["a, b", "c"])),
        ).toEqual(["a, b", "c"]);
    });
});
