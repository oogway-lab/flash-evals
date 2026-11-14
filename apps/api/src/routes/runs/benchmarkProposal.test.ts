import { describe, expect, it, vi } from "vitest";
import type { IJsonSchemaObject } from "@flash-evals/api-contract";
import type { IApiConfig } from "../../config.js";
import type { IDb } from "../../db.js";
import { evalProvider } from "./promptContext.js";
import {
    fromDraft,
    proposeBenchmarkTaskMapPayload,
    TASK_MAP_RESPONSE_SCHEMA,
} from "./benchmarkProposal.js";

vi.mock("./promptContext.js", () => ({
    loadRunnablePromptContext: vi.fn(async () => ({
        content: "Extract competitors, a sales label and a summary.",
        outputSchema: {
            type: "object",
            properties: {
                competitors: { type: "array", items: { type: "string" } },
                is_sales: { type: "boolean" },
                summary: { type: "string" },
            },
        },
    })),
    evalProvider: vi.fn(),
}));

const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({
    rows: [] as unknown[],
}));
const db = { query } as unknown as IDb;
const config = {} as IApiConfig;

const schema: IJsonSchemaObject = {
    type: "object",
    properties: {
        competitors: { type: "array", items: { type: "string" } },
        is_sales: { type: "boolean" },
        summary: { type: "string" },
    },
};

const draft = [
    {
        key: "competitors",
        name: "Competitor mentions",
        description: "Competitor brands named in the call.",
        method: "agreement" as const,
        fields: [{ path: "$.competitors", matcher: "set_overlap" as const }],
        judgeDisagreements: true,
        rubric: null,
        why: "A list of names, and the benchmark can miss some.",
    },
    {
        key: "sales",
        name: "Sales call",
        description: "",
        method: "agreement" as const,
        fields: [{ path: "$.is_sales", matcher: "exact" as const }],
        judgeDisagreements: false,
        rubric: null,
        why: "A yes/no label.",
    },
    {
        key: "summary",
        name: "Summary",
        description: "Short summary of the visit.",
        method: "head_to_head" as const,
        fields: [{ path: "$.summary", matcher: "exact" as const }],
        judgeDisagreements: false,
        rubric: " Covers orders and objections. ",
        why: "Free text, so a judge compares the two.",
    },
];

describe("fromDraft", () => {
    it("turns a valid model draft into a Task Map with notes", () => {
        expect(fromDraft(draft, schema)).toEqual({
            source: "model",
            rejected: [],
            notes: [
                "Competitor mentions: A list of names, and the benchmark can miss some.",
                "Sales call: A yes/no label.",
                "Summary: Free text, so a judge compares the two.",
            ],
            taskMap: {
                tasks: [
                    {
                        key: "competitors",
                        name: "Competitor mentions",
                        description: "Competitor brands named in the call.",
                        method: "agreement",
                        fields: [
                            { path: "$.competitors", matcher: "set_overlap" },
                        ],
                        judgeDisagreements: true,
                    },
                    {
                        key: "sales",
                        name: "Sales call",
                        method: "agreement",
                        fields: [{ path: "$.is_sales", matcher: "exact" }],
                    },
                    {
                        key: "summary",
                        name: "Summary",
                        description: "Short summary of the visit.",
                        method: "head_to_head",
                        paths: ["$.summary"],
                        rubric: "Covers orders and objections.",
                    },
                ],
            },
        });
    });

    it("gives numeric fields a 5% relative tolerance", () => {
        const result = fromDraft(
            [
                {
                    ...draft[1]!,
                    key: "amount",
                    name: "Amount",
                    fields: [
                        { path: "$.amount", matcher: "numeric_tolerance" },
                    ],
                },
            ],
            {
                type: "object",
                properties: { amount: { type: "number" } },
            },
        );
        expect(result.taskMap.tasks[0]).toMatchObject({
            fields: [
                {
                    path: "$.amount",
                    matcher: "numeric_tolerance",
                    tolerance: 0.05,
                    relative: true,
                },
            ],
        });
    });

    it("falls back to the schema proposal when the draft is invalid", () => {
        const result = fromDraft(
            [
                {
                    ...draft[0]!,
                    fields: [{ path: "$.brands", matcher: "set_overlap" }],
                },
            ],
            schema,
        );
        expect(result.source).toBe("schema");
        expect(result.rejected).toEqual([
            'Competitor mentions: "$.brands" is not in the output schema.',
        ]);
        expect(result.taskMap.tasks.map((task) => task.key)).toEqual([
            "competitors",
            "is_sales",
            "summary",
        ]);
    });
});

describe("proposeBenchmarkTaskMapPayload", () => {
    it("sends the prompt and schema with a strict response schema", async () => {
        const complete = vi.fn(async () => ({
            text: "",
            parsed: { tasks: draft },
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            latencyMs: 1,
        }));
        vi.mocked(evalProvider).mockResolvedValue({ complete });

        const result = await proposeBenchmarkTaskMapPayload(db, config, {
            teamId: "team-1",
            projectId: "project-1",
            promptVersionId: "pv-1",
            generatorModelId: "gpt-4o-mini",
        });

        expect(result.source).toBe("model");
        const request = (complete.mock.calls[0] as unknown[])[0] as {
            model: string;
            prompt: string;
            responseSchema: unknown;
        };
        expect(request.model).toBe("gpt-4o-mini");
        expect(request.responseSchema).toBe(TASK_MAP_RESPONSE_SCHEMA);
        expect(request.prompt).toContain(
            "Extract competitors, a sales label and a summary.",
        );
        expect(request.prompt).toContain('"is_sales"');
    });

    it("records what the call cost in the spend ledger", async () => {
        query.mockClear();
        vi.mocked(evalProvider).mockResolvedValue({
            complete: vi.fn(async () => ({
                text: "",
                parsed: undefined,
                schemaViolation: true,
                cost: { usd: 0.0123, source: "provider_reported" as const },
                usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
                latencyMs: 1,
            })),
        });

        // An unusable reply was still paid for.
        await expect(
            proposeBenchmarkTaskMapPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                promptVersionId: "pv-1",
            }),
        ).rejects.toThrow("The model did not return a task map");

        const insert = query.mock.calls.find(([sql]) =>
            sql.includes("insert into spend_ledger"),
        );
        expect(insert?.[1]).toEqual(["team-1", "pv-1", 0.0123]);
    });

    it("refuses before calling the model once the daily cap is reached", async () => {
        query.mockClear();
        query.mockResolvedValueOnce({ rows: [{ spentUsd: "2.5" }] });
        const complete = vi.fn();
        vi.mocked(evalProvider).mockResolvedValue({ complete });

        await expect(
            proposeBenchmarkTaskMapPayload(
                db,
                { teamDailySpendCapUsd: 2 } as IApiConfig,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    promptVersionId: "pv-1",
                },
            ),
        ).rejects.toThrow(/daily cap/);
        expect(complete).not.toHaveBeenCalled();
    });

    it("reports a missing or truncated reply", async () => {
        vi.mocked(evalProvider).mockResolvedValue({
            complete: vi.fn(async () => ({
                text: "",
                parsed: undefined,
                schemaViolation: true,
                usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
                latencyMs: 1,
            })),
        });
        await expect(
            proposeBenchmarkTaskMapPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                promptVersionId: "pv-1",
            }),
        ).rejects.toThrow("The model did not return a task map");
    });
});
