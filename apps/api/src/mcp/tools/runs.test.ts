import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createRunFromSelectionPayload: vi.fn(),
    deleteRunPayload: vi.fn(),
    publishRunEnqueue: vi.fn(),
    retryRunPayload: vi.fn(),
}));

vi.mock("../../routes/runs.js", () => ({
    createRunFromSelectionPayload: mocks.createRunFromSelectionPayload,
    deleteRunPayload: mocks.deleteRunPayload,
    listRunsPayload: vi.fn(),
    retryRunPayload: mocks.retryRunPayload,
    runDetailPayload: vi.fn(),
    runProgressPayload: vi.fn(),
    saveCellAnnotationPayload: vi.fn(),
    saveRunNotePayload: vi.fn(),
}));
vi.mock("../../runEnqueue.js", () => ({
    publishRunEnqueue: mocks.publishRunEnqueue,
}));

import { registerRunTools } from "./runs.js";
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
});

function registerTools() {
    return createToolHarness(registerRunTools);
}
