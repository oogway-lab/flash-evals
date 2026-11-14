import { describe, expect, it } from "vitest";
import type {
    IBenchmarkTask,
    IJsonSchemaObject,
} from "@flash-evals/api-contract";
import {
    benchmarkJudgeTransport,
    addPath,
    aliasesFromText,
    aliasesToText,
    benchmarkErrors,
    benchmarkPolicy,
    initialBenchmarkState,
    newTask,
    removePathAt,
    schemaPaths,
    serializeBenchmark,
    setFieldMatcherAt,
    setPathAt,
    withMethod,
    withTaskSource,
    withTextMatching,
    type IBenchmarkFormState,
} from "./benchmark-settings";

const SCHEMA: IJsonSchemaObject = {
    type: "object",
    properties: {
        competitors: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
        deal: {
            type: "object",
            properties: { stage: { type: "string" } },
        },
    },
};

const AGREEMENT: IBenchmarkTask = {
    key: "competitors",
    name: "Competitors",
    method: "agreement",
    fields: [{ path: "$.competitors", matcher: "set_overlap" }],
};

const HEAD_TO_HEAD: IBenchmarkTask = {
    key: "summary",
    name: "Summary",
    method: "head_to_head",
    paths: ["$.summary"],
};

function state(overrides: Partial<IBenchmarkFormState> = {}) {
    return {
        ...initialBenchmarkState("judge-model"),
        enabled: true,
        taskMap: { tasks: [AGREEMENT] },
        ...overrides,
    };
}

describe("benchmark settings", () => {
    it("starts off, with the default policy as percentages and no cost limit", () => {
        const initial = initialBenchmarkState("judge-model");
        expect(initial).toMatchObject({
            enabled: false,
            judgeModelId: "judge-model",
            minAgreementPct: "90",
            minWinOrTiePct: "90",
            maxCostPct: "",
        });
        expect(serializeBenchmark(initial)).toBeUndefined();
        expect(
            benchmarkErrors({ state: initial, schema: SCHEMA, modelCount: 0 }),
        ).toEqual([]);
    });

    it("serializes the task map and policy, and leaves out the judge when no task needs one", () => {
        expect(
            serializeBenchmark(
                state({ minAgreementPct: "85", maxCostPct: "40" }),
                "openai",
            ),
        ).toEqual({
            taskMap: { tasks: [AGREEMENT] },
            policy: {
                minAgreement: 0.85,
                minWinOrTieRate: 0.9,
                maxDropBelowReference: 0.02,
                maxRelativeCost: 0.4,
            },
        });
    });

    it("sends the judge with its transport when a task is judged, and trims text", () => {
        const config = serializeBenchmark(
            state({
                taskMap: {
                    tasks: [
                        { ...AGREEMENT, judgeDisagreements: true },
                        {
                            ...HEAD_TO_HEAD,
                            name: " Summary ",
                            description: "  ",
                            rubric: " Fewer errors wins. ",
                        },
                    ],
                },
                minAgreementPct: "",
                minWinOrTiePct: "",
                maxDropPts: "",
            }),
            "openrouter",
        );
        expect(config).toEqual({
            taskMap: {
                tasks: [
                    { ...AGREEMENT, judgeDisagreements: true },
                    { ...HEAD_TO_HEAD, rubric: "Fewer errors wins." },
                ],
            },
            judge: { modelId: "judge-model", transport: "openrouter" },
        });
    });

    it("rejects out-of-range targets and a zero cost limit", () => {
        expect(
            benchmarkPolicy(
                state({
                    minAgreementPct: "120",
                    minWinOrTiePct: "abc",
                    maxCostPct: "0",
                }),
            ).errors,
        ).toEqual([
            "Minimum agreement must be between 0 and 100.",
            "Minimum won or tied must be between 0 and 100.",
            "Maximum cost must be above 0, or left empty.",
        ]);
    });

    it("turns the allowed drop below the reference into a 0 to 1 rate", () => {
        expect(
            benchmarkPolicy(state({ maxDropPts: "3" })).policy,
        ).toMatchObject({ maxDropBelowReference: 0.03 });
        expect(
            benchmarkPolicy(state({ maxDropPts: "" })).policy
                ?.maxDropBelowReference,
        ).toBeUndefined();
        expect(benchmarkPolicy(state({ maxDropPts: "150" })).errors).toEqual([
            "Allowed drop below the reference must be between 0 and 100.",
        ]);
    });

    it("reports too few models, task map problems and a missing judge", () => {
        const errors = benchmarkErrors({
            state: state({
                judgeModelId: "",
                taskMap: {
                    tasks: [{ ...HEAD_TO_HEAD, paths: ["$.missing"] }],
                },
            }),
            schema: SCHEMA,
            modelCount: 1,
        });
        expect(errors).toEqual([
            "Select at least two models: the benchmark and one to compare with it.",
            'Summary: "$.missing" is not in the output schema.',
            "Choose a judge model for the judged tasks.",
        ]);
        expect(
            benchmarkErrors({ state: state(), schema: SCHEMA, modelCount: 2 }),
        ).toEqual([]);
    });

    it("switches a task's method and keeps its paths", () => {
        const headToHead = withMethod(AGREEMENT, "head_to_head");
        expect(headToHead).toEqual({
            key: "competitors",
            name: "Competitors",
            method: "head_to_head",
            paths: ["$.competitors"],
        });
        expect(withMethod(headToHead, "agreement")).toEqual({
            ...AGREEMENT,
            fields: [{ path: "$.competitors", matcher: "exact" }],
        });
    });

    it("switches to a rubric and trims it, without a source", () => {
        const rubric = withMethod(
            { ...HEAD_TO_HEAD, source: "labels" },
            "rubric",
        );
        expect(rubric).toEqual({
            key: "summary",
            name: "Summary",
            method: "rubric",
            paths: ["$.summary"],
            criteria: [{ key: "criterion_1", name: "Criterion 1" }],
        });
        expect(setPathAt(addPath(rubric), 1, "$.deal.stage")).toMatchObject({
            paths: ["$.summary", "$.deal.stage"],
        });
        const config = serializeBenchmark(
            state({
                taskMap: {
                    tasks: [
                        {
                            key: "quality",
                            name: " Quality ",
                            method: "rubric",
                            paths: [" $.summary "],
                            criteria: [
                                {
                                    key: "grounded",
                                    name: " Grounded ",
                                    description: "  ",
                                },
                            ],
                            instructions: " ",
                        },
                    ],
                },
            }),
        );
        expect(config?.taskMap.tasks[0]).toEqual({
            key: "quality",
            name: "Quality",
            method: "rubric",
            paths: ["$.summary"],
            criteria: [{ key: "grounded", name: "Grounded" }],
        });
        // A rubric needs a judge.
        expect(config?.judge?.modelId).toBe("judge-model");
    });

    it("edits output fields by position and keeps each field's matcher", () => {
        let task = addPath(AGREEMENT);
        task = setPathAt(task, 1, "$.deal.stage");
        task = setFieldMatcherAt(task, 1, { matcher: "numeric_tolerance" });
        task = setFieldMatcherAt(task, 1, { tolerance: 0.1 });
        task = setPathAt(task, 0, "$.summary");
        expect(task).toMatchObject({
            fields: [
                { path: "$.summary", matcher: "set_overlap" },
                {
                    path: "$.deal.stage",
                    matcher: "numeric_tolerance",
                    tolerance: 0.1,
                    relative: true,
                },
            ],
        });
        expect(removePathAt(task, 0)).toMatchObject({
            fields: [{ path: "$.deal.stage" }],
        });
        expect(setPathAt(addPath(HEAD_TO_HEAD), 1, "$.deal")).toMatchObject({
            paths: ["$.summary", "$.deal"],
        });
    });

    it("restores a rerun's settings and keeps per-task targets for tasks that remain", () => {
        const restored = initialBenchmarkState("default-judge", {
            taskMap: { tasks: [AGREEMENT, HEAD_TO_HEAD] },
            judge: { modelId: "rerun-judge" },
            policy: {
                minAgreement: 0.8,
                maxRelativeCost: 0.25,
                tasks: {
                    competitors: { minAgreement: 0.95 },
                    summary: { minWinOrTieRate: 0.7 },
                },
            },
        });
        expect(restored).toMatchObject({
            enabled: true,
            judgeModelId: "rerun-judge",
            minAgreementPct: "80",
            minWinOrTiePct: "90",
            maxCostPct: "25",
        });
        const edited = {
            ...restored,
            taskMap: { tasks: [AGREEMENT] },
        };
        expect(serializeBenchmark(edited)?.policy).toEqual({
            minAgreement: 0.8,
            minWinOrTieRate: 0.9,
            maxRelativeCost: 0.25,
            tasks: { competitors: { minAgreement: 0.95 } },
        });
    });

    it("names new tasks with unused keys and lists nested schema paths", () => {
        expect(newTask([{ ...AGREEMENT, key: "task_2" }]).key).toBe("task_3");
        expect(schemaPaths(SCHEMA)).toEqual([
            "$.competitors",
            "$.summary",
            "$.deal",
            "$.deal.stage",
        ]);
        expect(schemaPaths(undefined)).toEqual([]);
    });
});

describe("stored answers and text matching", () => {
    const base = (): IBenchmarkFormState => ({
        ...initialBenchmarkState("judge-model"),
        enabled: true,
        taskMap: { tasks: [AGREEMENT] },
    });

    it("sends source labels and needs only one model and stored answers", () => {
        const state = { ...base(), source: "labels" as const };
        expect(serializeBenchmark(state)).toMatchObject({ source: "labels" });
        expect(serializeBenchmark(base())).not.toHaveProperty("source");
        expect(
            benchmarkErrors({
                state,
                schema: SCHEMA,
                modelCount: 1,
                storedAnswersAvailable: true,
            }),
        ).toEqual([]);
        expect(
            benchmarkErrors({ state, schema: SCHEMA, modelCount: 1 }),
        ).toEqual([
            "This dataset has no stored answers. Compare against the benchmark model's answers instead.",
        ]);
    });

    it("keeps each task's own source through submit and rerun", () => {
        const labelTask = withTaskSource(AGREEMENT, "labels");
        const state = {
            ...base(),
            taskMap: { tasks: [labelTask, HEAD_TO_HEAD] },
        };
        const sent = serializeBenchmark(state);
        expect(sent).not.toHaveProperty("source");
        expect(sent?.taskMap.tasks.map((task) => task.source)).toEqual([
            "labels",
            undefined,
        ]);
        expect(sent?.taskMap.tasks[1]).not.toHaveProperty("source");
        expect(initialBenchmarkState("j", sent).taskMap.tasks[0]!.source).toBe(
            "labels",
        );
        // "Run default" clears it; switching method keeps it.
        expect(withTaskSource(labelTask, undefined)).toEqual(AGREEMENT);
        expect(withMethod(labelTask, "head_to_head")).toMatchObject({
            source: "labels",
        });
    });

    it("checks models and stored answers for the sources the tasks use", () => {
        const mixed = {
            ...base(),
            taskMap: {
                tasks: [withTaskSource(AGREEMENT, "labels"), HEAD_TO_HEAD],
            },
        };
        expect(
            benchmarkErrors({
                state: mixed,
                schema: SCHEMA,
                modelCount: 1,
                storedAnswersAvailable: true,
            }),
        ).toEqual([
            "Select at least two models: the benchmark and one to compare with it.",
        ]);
        expect(
            benchmarkErrors({ state: mixed, schema: SCHEMA, modelCount: 2 }),
        ).toEqual([
            "This dataset has no stored answers. Compare against the benchmark model's answers instead.",
        ]);
        // Every task on the stored answers: one model is enough.
        const labelsOnly = {
            ...base(),
            taskMap: { tasks: [withTaskSource(AGREEMENT, "labels")] },
        };
        expect(
            benchmarkErrors({
                state: labelsOnly,
                schema: SCHEMA,
                modelCount: 1,
                storedAnswersAvailable: true,
            }),
        ).toEqual([]);
    });

    it("restores the source on rerun", () => {
        expect(
            initialBenchmarkState("j", {
                source: "labels",
                taskMap: { tasks: [AGREEMENT] },
            }).source,
        ).toBe("labels");
    });

    it("parses and prints aliases one name per line", () => {
        expect(
            aliasesFromText(
                "Parle-G: parleji, parle glucose,\nno colon here\nSunfeast:\nParle-G: parle g",
            ),
        ).toEqual({ "Parle-G": ["parleji", "parle glucose", "parle g"] });
        expect(
            aliasesToText({ aliases: { "Parle-G": ["parleji", "parle g"] } }),
        ).toBe("Parle-G: parleji, parle g");
    });

    it("sets and clears text matching and keeps it when submitting", () => {
        const withAliases = withTextMatching(AGREEMENT, {
            aliases: { "Parle-G": ["parleji"] },
            fuzzy: 0.85,
        });
        expect(withAliases).toMatchObject({
            textMatching: { aliases: { "Parle-G": ["parleji"] }, fuzzy: 0.85 },
        });
        const sent = serializeBenchmark({
            ...base(),
            taskMap: { tasks: [withAliases] },
        });
        expect(sent?.taskMap.tasks[0]).toMatchObject({
            textMatching: { aliases: { "Parle-G": ["parleji"] }, fuzzy: 0.85 },
        });
        const cleared = withTextMatching(withAliases, {
            aliases: {},
            fuzzy: null,
        });
        expect(cleared).not.toHaveProperty("textMatching");
        expect(withTextMatching(HEAD_TO_HEAD, { fuzzy: 0.9 })).toBe(
            HEAD_TO_HEAD,
        );
    });
});

describe("benchmark judge provider", () => {
    const judge = {
        id: "gpt-6.1-terra",
        label: "GPT-6.1 Terra",
        family: "gpt",
        provider: "openai",
        providerLabel: "OpenAI",
        reasoning: true,
        vision: false,
        structuredOutput: true,
        judgeSuitable: true,
        costAvailable: true,
        available: true,
        transports: ["gateway", "openrouter"] as Array<
            "gateway" | "openrouter"
        >,
    };

    it("keeps the chosen provider while it has a key", () => {
        expect(
            benchmarkJudgeTransport([judge], {
                judgeModelId: judge.id,
                judgeTransport: "openrouter",
            }),
        ).toBe("openrouter");
    });

    it("falls back to the default when the chosen provider has no key", () => {
        expect(
            benchmarkJudgeTransport([{ ...judge, transports: ["gateway"] }], {
                judgeModelId: judge.id,
                judgeTransport: "openrouter",
            }),
        ).toBe("gateway");
        expect(
            benchmarkJudgeTransport([{ ...judge, transports: [] }], {
                judgeModelId: judge.id,
            }),
        ).toBeUndefined();
    });
});
