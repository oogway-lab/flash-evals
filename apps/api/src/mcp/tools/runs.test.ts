import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    deleteRunPayload: vi.fn(),
    enqueueRun: vi.fn(),
    retryRunPayload: vi.fn(),
}));

vi.mock("../../routes/runs.js", () => ({
    createRunFromSelectionPayload: vi.fn(),
    deleteRunPayload: mocks.deleteRunPayload,
    listRunsPayload: vi.fn(),
    retryRunPayload: mocks.retryRunPayload,
    runDetailPayload: vi.fn(),
    runProgressPayload: vi.fn(),
    saveCellAnnotationPayload: vi.fn(),
    saveRunNotePayload: vi.fn(),
}));
vi.mock("../../runQueue.js", () => ({ enqueueRun: mocks.enqueueRun }));

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
        mocks.enqueueRun.mockResolvedValue(undefined);

        await tools.get("retry_run")!.handler({
            projectId: PROJECT_ID,
            runId: RUN_ID,
        });

        expect(mocks.retryRunPayload).toHaveBeenCalledWith(runtime.db, {
            teamId: "team-1",
            projectId: PROJECT_ID,
            runId: RUN_ID,
        });
        expect(mocks.enqueueRun).toHaveBeenCalledWith(runtime.config, RUN_ID);
        expect(mocks.retryRunPayload.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.enqueueRun.mock.invocationCallOrder[0]!,
        );
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
