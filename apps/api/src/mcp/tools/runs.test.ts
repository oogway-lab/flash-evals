import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    cancelRunPayload: vi.fn(),
    createRunFromSelectionPayload: vi.fn(),
    deleteRunPayload: vi.fn(),
    listRunCellsPagePayload: vi.fn(),
    publishRunEnqueue: vi.fn(),
    retryRunPayload: vi.fn(),
    runSummaryPayload: vi.fn(),
}));

vi.mock("../../routes/runs.js", () => ({
    cancelRunPayload: mocks.cancelRunPayload,
    createRunFromSelectionPayload: mocks.createRunFromSelectionPayload,
    deleteRunPayload: mocks.deleteRunPayload,
    listRunsPayload: vi.fn(),
    listRunCellsPagePayload: mocks.listRunCellsPagePayload,
    retryRunPayload: mocks.retryRunPayload,
    runDetailPayload: vi.fn(),
    runProgressPayload: vi.fn(),
    runSummaryPayload: mocks.runSummaryPayload,
    saveCellAnnotationPayload: vi.fn(),
    saveRunNotePayload: vi.fn(),
}));
vi.mock("../../runEnqueue.js", () => ({
    publishRunEnqueue: mocks.publishRunEnqueue,
}));

import { registerRunTools } from "./runs.js";
import { decodeMcpPageCursor, encodeMcpPageCursor } from "../pagination.js";
import {
    createToolHarness,
    expectConfirmationGate,
    TEST_PROJECT_ID,
} from "./testSupport.js";

const PROJECT_ID = TEST_PROJECT_ID;
const RUN_ID = "22222222-2222-4222-8222-222222222222";

describe("MCP run lifecycle tools", () => {
    beforeEach(() => vi.clearAllMocks());

    it("retries through the shared payload before enqueueing", async () => {
        const { tools, runtime } = registerTools();
        mocks.retryRunPayload.mockResolvedValue({ requeued: true });
        mocks.publishRunEnqueue.mockResolvedValue({
            runId: RUN_ID,
            enqueueStatus: "queued",
        });

        await tools.get("retry_run")!.handler({
            projectId: PROJECT_ID,
            runId: RUN_ID,
        });

        expect(mocks.retryRunPayload).toHaveBeenCalledWith(
            runtime.db,
            { teamId: "team-1", projectId: PROJECT_ID, runId: RUN_ID },
            // A retry is held to the team daily cap like a new run.
            { teamDailySpendCapUsd: runtime.config.teamDailySpendCapUsd },
        );
        expect(mocks.publishRunEnqueue).toHaveBeenCalledWith(
            runtime.db,
            runtime.config,
            RUN_ID,
        );
        expect(mocks.retryRunPayload.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.publishRunEnqueue.mock.invocationCallOrder[0]!,
        );
    });

    it("says when there was nothing to retry", async () => {
        const { tools } = registerTools();
        mocks.retryRunPayload.mockResolvedValue({ requeued: false });
        mocks.publishRunEnqueue.mockResolvedValue({
            runId: RUN_ID,
            enqueueStatus: "queued",
        });

        const result = await tools.get("retry_run")!.handler({
            projectId: PROJECT_ID,
            runId: RUN_ID,
        });

        expect(JSON.stringify(result)).toContain("Nothing to retry");
    });

    it("cancels through the shared payload without enqueueing anything", async () => {
        const { tools, runtime } = registerTools();
        mocks.cancelRunPayload.mockResolvedValue({
            runId: RUN_ID,
            status: "running",
            stopReason: "cancelled",
        });

        const result = await tools.get("cancel_run")!.handler({
            projectId: PROJECT_ID,
            runId: RUN_ID,
        });

        expect(mocks.cancelRunPayload).toHaveBeenCalledWith(runtime.db, {
            teamId: "team-1",
            projectId: PROJECT_ID,
            runId: RUN_ID,
        });
        expect(mocks.publishRunEnqueue).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).toContain("Cancel requested");
    });

    it("preserves retry keys and exposes a durable ID when publication is deferred", async () => {
        const { tools, runtime } = registerTools();
        mocks.createRunFromSelectionPayload.mockResolvedValue({
            runId: RUN_ID,
            enqueueStatus: "pending_enqueue",
        });
        mocks.publishRunEnqueue.mockResolvedValue({
            runId: RUN_ID,
            enqueueStatus: "pending_enqueue",
        });
        const tool = tools.get("create_eval_run")!;
        const input = tool.config.inputSchema!.parse({
            projectId: PROJECT_ID,
            datasetId: RUN_ID,
            promptVersionId: RUN_ID,
            maxTokens: 100,
            judgeModelId: "gpt-4o",
            modelIds: ["gpt-4o"],
            fieldConfigs: [],
            idempotencyKey: " retry-1 ",
        }) as Record<string, unknown>;
        const result = await tool.handler(input);
        expect(mocks.createRunFromSelectionPayload).toHaveBeenCalledWith(
            runtime.db,
            expect.objectContaining({
                idempotencyKey: "retry-1",
                teamId: "team-1",
                createdBy: "user-1",
            }),
            runtime.config,
        );
        expect(result).toMatchObject({
            structuredContent: {
                data: {
                    runId: RUN_ID,
                    enqueueStatus: "pending_enqueue",
                },
            },
        });
        expect(JSON.stringify(result)).not.toContain("Internal server error");
    });

    it("passes a labelled-subset filter from create_eval_run to the run", async () => {
        const { tools, runtime } = registerTools();
        mocks.createRunFromSelectionPayload.mockResolvedValue({
            runId: RUN_ID,
            enqueueStatus: "pending_enqueue",
        });
        mocks.publishRunEnqueue.mockResolvedValue({
            runId: RUN_ID,
            enqueueStatus: "queued",
        });
        const tool = tools.get("create_eval_run")!;
        const itemFilter = { taskKey: "call_type", equals: "sales" };
        await tool.handler(
            tool.config.inputSchema!.parse({
                projectId: PROJECT_ID,
                datasetId: RUN_ID,
                promptVersionId: RUN_ID,
                maxTokens: 100,
                judgeModelId: "gpt-4o",
                modelIds: ["gpt-4o"],
                fieldConfigs: [],
                itemFilter,
            }) as Record<string, unknown>,
        );
        expect(mocks.createRunFromSelectionPayload).toHaveBeenCalledWith(
            runtime.db,
            expect.objectContaining({ itemFilter }),
            runtime.config,
        );
        expect(() =>
            tool.config.inputSchema!.parse({
                projectId: PROJECT_ID,
                datasetId: RUN_ID,
                promptVersionId: RUN_ID,
                maxTokens: 100,
                judgeModelId: "gpt-4o",
                modelIds: ["gpt-4o"],
                fieldConfigs: [],
                itemFilter: { taskKey: "call_type", equals: { a: 1 } },
            }),
        ).toThrow();
    });

    it("passes data rules from create_eval_run to the run", async () => {
        const { tools, runtime } = registerTools();
        mocks.createRunFromSelectionPayload.mockResolvedValue({
            runId: RUN_ID,
            enqueueStatus: "pending_enqueue",
        });
        mocks.publishRunEnqueue.mockResolvedValue({
            runId: RUN_ID,
            enqueueStatus: "queued",
        });
        const tool = tools.get("create_eval_run")!;
        const dataPolicy = {
            onlyHosts: ["vertex"],
            zeroDataRetention: true,
        };
        await tool.handler(
            tool.config.inputSchema!.parse({
                projectId: PROJECT_ID,
                datasetId: RUN_ID,
                promptVersionId: RUN_ID,
                maxTokens: 100,
                judgeModelId: "gpt-4o",
                modelIds: ["gpt-4o"],
                fieldConfigs: [],
                dataPolicy,
            }) as Record<string, unknown>,
        );
        expect(mocks.createRunFromSelectionPayload).toHaveBeenCalledWith(
            runtime.db,
            expect.objectContaining({ dataPolicy }),
            runtime.config,
        );
    });

    it("passes per-model temperatures from create_eval_run and refuses one outside 0 to 2", async () => {
        const { tools, runtime } = registerTools();
        mocks.createRunFromSelectionPayload.mockResolvedValue({
            runId: RUN_ID,
            enqueueStatus: "pending_enqueue",
        });
        mocks.publishRunEnqueue.mockResolvedValue({
            runId: RUN_ID,
            enqueueStatus: "queued",
        });
        const tool = tools.get("create_eval_run")!;
        const base = {
            projectId: PROJECT_ID,
            datasetId: RUN_ID,
            promptVersionId: RUN_ID,
            maxTokens: 100,
            judgeModelId: "gpt-4o",
            modelIds: ["gpt-4o"],
            fieldConfigs: [],
        };
        const temperatureAssignments = [
            { modelId: "gpt-4o", temperature: 0.2 },
        ];
        await tool.handler(
            tool.config.inputSchema!.parse({
                ...base,
                temperatureAssignments,
            }) as Record<string, unknown>,
        );
        expect(mocks.createRunFromSelectionPayload).toHaveBeenCalledWith(
            runtime.db,
            expect.objectContaining({ temperatureAssignments }),
            runtime.config,
        );
        expect(
            tool.config.inputSchema!.safeParse({
                ...base,
                temperatureAssignments: [
                    { modelId: "gpt-4o", temperature: 2.5 },
                ],
            }).success,
        ).toBe(false);
    });

    it("accepts a benchmark task map on create_eval_run and rejects a malformed one", () => {
        const schema = registerTools().tools.get("create_eval_run")!.config
            .inputSchema as {
            safeParse: (value: unknown) => { success: boolean };
        };
        const base = {
            projectId: PROJECT_ID,
            datasetId: RUN_ID,
            promptVersionId: RUN_ID,
            maxTokens: 1000,
            judgeModelId: "anthropic/claude-opus-4.8",
            referenceModel: "anthropic/claude-opus-4.8",
            modelIds: ["anthropic/claude-opus-4.8", "openai/gpt-5.5-mini"],
            fieldConfigs: [],
        };
        const tasks = [
            {
                key: "competitors",
                name: "Competitor mentions",
                method: "agreement",
                fields: [{ path: "$.competitors", matcher: "set_overlap" }],
                judgeDisagreements: true,
            },
            {
                key: "summary",
                name: "Summary",
                method: "head_to_head",
                paths: ["$.summary"],
            },
        ];

        expect(
            schema.safeParse({
                ...base,
                benchmark: {
                    taskMap: { tasks },
                    judge: { modelId: "anthropic/claude-opus-4.8" },
                },
            }).success,
        ).toBe(true);
        expect(
            schema.safeParse({
                ...base,
                benchmark: {
                    taskMap: {
                        tasks: [
                            {
                                key: "summary",
                                name: "Summary",
                                method: "vibes",
                            },
                        ],
                    },
                },
            }).success,
        ).toBe(false);
    });

    it("requires confirmation and annotations for run deletion", () => {
        const tool = registerTools().tools.get("delete_run")!;

        expectConfirmationGate(tool, {
            projectId: PROJECT_ID,
            runId: RUN_ID,
        });
    });

    it("returns run summaries and bounded, filter-bound cell pages", async () => {
        const { tools, runtime } = registerTools();
        const summary = {
            run: {
                id: RUN_ID,
                datasetId: "33333333-3333-4333-8333-333333333333",
                status: "completed",
                createdAt: "2026-10-10T00:00:00.000Z",
            },
            progress: { total: 25, done: 25, failed: 0, pending: 0 },
            modelIds: ["model-a"],
        };
        mocks.runSummaryPayload.mockResolvedValue(summary);
        const summaryResult = (await tools.get("get_run_summary")!.handler({
            projectId: PROJECT_ID,
            runId: RUN_ID,
        })) as { structuredContent: { data: unknown } };
        expect(summaryResult.structuredContent.data).toEqual(summary);

        const nextCursor = {
            createdAt: "2026-10-10T00:00:00.123456Z",
            id: "44444444-4444-4444-8444-444444444444",
        };
        mocks.listRunCellsPagePayload.mockResolvedValue({
            cells: [
                {
                    id: nextCursor.id,
                    itemId: "55555555-5555-4555-8555-555555555555",
                    modelId: "model-a",
                    status: "succeeded",
                    latencyMs: null,
                    costUsd: null,
                    promptTokens: null,
                    completionTokens: null,
                    error: null,
                    inputText: "sample",
                    output: { answer: "ok" },
                },
            ],
            complete: false,
            nextCursor,
        });
        const pageResult = (await tools.get("list_run_cells")!.handler({
            projectId: PROJECT_ID,
            runId: RUN_ID,
            limit: 1,
            modelId: "model-a",
            status: "succeeded",
            includeInputText: true,
            includeOutput: true,
        })) as { structuredContent: { data: Record<string, unknown> } };
        expect(
            decodeMcpPageCursor(
                pageResult.structuredContent.data.nextCursor as string,
                JSON.stringify([
                    RUN_ID,
                    null,
                    "model-a",
                    "succeeded",
                    null,
                    "oldest_first",
                ]),
            ),
        ).toEqual(nextCursor);
        expect(mocks.listRunCellsPagePayload).toHaveBeenCalledWith(
            runtime.db,
            expect.objectContaining({
                teamId: "team-1",
                projectId: PROJECT_ID,
                runId: RUN_ID,
                limit: 1,
                modelId: "model-a",
                status: "succeeded",
                includeOutput: true,
            }),
        );
        const wrongFilterCursor = encodeMcpPageCursor(
            JSON.stringify([
                RUN_ID,
                null,
                "model-b",
                "succeeded",
                null,
                "oldest_first",
            ]),
            nextCursor,
        );
        await expect(
            tools.get("list_run_cells")!.handler({
                projectId: PROJECT_ID,
                runId: RUN_ID,
                modelId: "model-a",
                status: "succeeded",
                cursor: wrongFilterCursor,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });
});

function registerTools() {
    return createToolHarness(registerRunTools);
}
