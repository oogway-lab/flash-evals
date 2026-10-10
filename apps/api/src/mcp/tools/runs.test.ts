import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createRunFromSelectionPayload: vi.fn(),
    deleteRunPayload: vi.fn(),
    listRunCellsPagePayload: vi.fn(),
    publishRunEnqueue: vi.fn(),
    retryRunPayload: vi.fn(),
    runSummaryPayload: vi.fn(),
}));

vi.mock("../../routes/runs.js", () => ({
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
        mocks.retryRunPayload.mockResolvedValue(undefined);
        mocks.publishRunEnqueue.mockResolvedValue({
            runId: RUN_ID,
            enqueueStatus: "queued",
        });

        await tools.get("retry_run")!.handler({
            projectId: PROJECT_ID,
            runId: RUN_ID,
        });

        expect(mocks.retryRunPayload).toHaveBeenCalledWith(runtime.db, {
            teamId: "team-1",
            projectId: PROJECT_ID,
            runId: RUN_ID,
        });
        expect(mocks.publishRunEnqueue).toHaveBeenCalledWith(
            runtime.db,
            runtime.config,
            RUN_ID,
        );
        expect(mocks.retryRunPayload.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.publishRunEnqueue.mock.invocationCallOrder[0]!,
        );
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
            createdAt: "2026-10-10T00:00:00.000Z",
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
                JSON.stringify([RUN_ID, null, "model-a", "succeeded"]),
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
            JSON.stringify([RUN_ID, null, "model-b", "succeeded"]),
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
