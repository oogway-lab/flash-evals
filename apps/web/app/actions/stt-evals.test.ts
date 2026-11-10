import { FlashEvalsApiError } from "@flash-evals/api-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createWorkflow: vi.fn(),
    updateWorkflow: vi.fn(),
    createWorkflowRun: vi.fn(),
    retryWorkflowRun: vi.fn(),
    cancelWorkflowRun: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn(),
}));

vi.mock("@/server/projects/activeProject", () => ({
    requireActiveProject: vi.fn(async () => ({
        teamId: "team-1",
        projectId: "project-1",
        userId: "user-1",
    })),
}));
vi.mock("@/server/api/client", () => ({
    serverApiClient: () => ({
        createWorkflow: mocks.createWorkflow,
        updateWorkflow: mocks.updateWorkflow,
        createWorkflowRun: mocks.createWorkflowRun,
        retryWorkflowRun: mocks.retryWorkflowRun,
        cancelWorkflowRun: mocks.cancelWorkflowRun,
    }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
    redirect: mocks.redirect,
    unstable_rethrow: vi.fn(),
}));

import {
    cancelWorkflowRunAction,
    createSttEvalAction,
    createSttEvalRunAction,
    retryWorkflowRunAction,
    saveSttEvalAction,
} from "./stt-evals";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.createWorkflow.mockResolvedValue({ id: "workflow-1" });
    mocks.updateWorkflow.mockResolvedValue({ id: "workflow-1" });
    mocks.createWorkflowRun.mockResolvedValue({ workflowRunId: "run-1" });
});

describe("STT eval actions", () => {
    it("creates a multi workflow seeded input to STT", async () => {
        const data = new FormData();
        data.set("name", "Audio flow");
        data.set("datasetId", "audio-1");
        data.set("modelId", "stt-1");
        await createSttEvalAction({}, data);

        expect(mocks.createWorkflow).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: "multi",
                nodes: [
                    expect.objectContaining({
                        nodeKey: "input-1",
                        nodeType: "input",
                        nodeConfig: {
                            type: "input",
                            modality: "audio",
                            datasetId: "audio-1",
                        },
                    }),
                    expect.objectContaining({
                        nodeKey: "stt-1",
                        nodeType: "stt",
                    }),
                ],
                edges: [
                    {
                        fromNodeKey: "input-1",
                        toNodeKey: "stt-1",
                        carryOriginalInput: false,
                    },
                ],
            }),
        );
        expect(mocks.revalidatePath).toHaveBeenCalledWith("/multiworkflow");
        expect(mocks.redirect).toHaveBeenCalledWith(
            "/multiworkflow/workflow-1?datasetId=audio-1",
        );
    });

    it.each(["image", "text"] as const)(
        "seeds a %s canvas from the input block alone",
        async (modality) => {
            const data = new FormData();
            data.set("name", `${modality} flow`);
            data.set("modality", modality);
            data.set("datasetId", `${modality}-1`);
            await createSttEvalAction({}, data);

            const request = mocks.createWorkflow.mock.calls[0]?.[0];
            // Only audio needs a transcription step before the first prompt.
            expect(request.nodes).toHaveLength(1);
            expect(request.nodes[0]).toMatchObject({
                nodeType: "input",
                nodeConfig: {
                    type: "input",
                    modality,
                    datasetId: `${modality}-1`,
                },
            });
            expect(request.edges).toEqual([]);
        },
    );

    it("requires an STT model only for audio inputs", async () => {
        const withoutModel = new FormData();
        withoutModel.set("name", "Audio flow");
        withoutModel.set("modality", "audio");
        withoutModel.set("datasetId", "audio-1");
        await expect(createSttEvalAction({}, withoutModel)).resolves.toEqual({
            formError: "An STT model is required for audio inputs.",
        });
        expect(mocks.createWorkflow).not.toHaveBeenCalled();

        const imageWithoutModel = new FormData();
        imageWithoutModel.set("name", "Image flow");
        imageWithoutModel.set("modality", "image");
        imageWithoutModel.set("datasetId", "image-1");
        await createSttEvalAction({}, imageWithoutModel);
        expect(mocks.createWorkflow).toHaveBeenCalledTimes(1);
    });

    it("returns an API failure as a form error instead of throwing", async () => {
        mocks.createWorkflow.mockRejectedValueOnce(
            new FlashEvalsApiError("Workflow limit reached.", 409),
        );
        const data = new FormData();
        data.set("name", "Text flow");
        data.set("modality", "text");
        await expect(createSttEvalAction({}, data)).resolves.toEqual({
            formError: "Workflow limit reached.",
        });
        expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("rejects a missing name next to the field", async () => {
        await expect(createSttEvalAction({}, new FormData())).resolves.toEqual({
            fieldErrors: { name: ["Name is required."] },
        });
    });

    it("sends the canvas's final answer, and null to remove it", async () => {
        const finalAnswer = {
            fields: [{ path: "$.mom", stepKey: "notes", stepPath: "$.mom" }],
        };
        const data = new FormData();
        data.set("workflowId", "workflow-1");
        data.set("name", "Flow");
        data.set("kind", "multi");
        data.set("nodes", "[]");
        data.set("edges", "[]");
        data.set("finalAnswer", JSON.stringify(finalAnswer));
        await saveSttEvalAction({}, data);
        expect(mocks.updateWorkflow).toHaveBeenLastCalledWith(
            expect.objectContaining({ finalAnswer }),
        );
        data.set("finalAnswer", "null");
        await saveSttEvalAction({}, data);
        expect(mocks.updateWorkflow).toHaveBeenLastCalledWith(
            expect.objectContaining({ finalAnswer: null }),
        );
    });

    it.each(["multi", "stt", "prompt"] as const)(
        "preserves %s kind when saving",
        async (kind) => {
            const data = new FormData();
            data.set("workflowId", "workflow-1");
            data.set("name", "Flow");
            data.set("kind", kind);
            data.set("nodes", "[]");
            data.set("edges", "[]");
            await saveSttEvalAction({}, data);
            expect(mocks.updateWorkflow).toHaveBeenCalledWith(
                expect.objectContaining({ kind }),
            );
            expect(mocks.revalidatePath).toHaveBeenCalledWith(
                "/multiworkflow/workflow-1",
            );
        },
    );

    it("returns node-addressable routing errors with remediation", async () => {
        const { FlashEvalsApiError } =
            await import("@flash-evals/api-contract");
        mocks.createWorkflowRun.mockRejectedValue(
            new FlashEvalsApiError(
                'Workflow node "Prompt Root" has no LLM route selection.',
                400,
                "invalid_llm_routing",
                "nodes.prompt-1.llmExecutionSelection",
                "Select a pinned route or explicitly use the project default.",
            ),
        );
        const data = new FormData();
        data.set("workflowId", "workflow-1");
        data.set("datasetId", "dataset-1");

        await expect(createSttEvalRunAction({}, data)).resolves.toMatchObject({
            fieldErrors: {
                "nodes.prompt-1.llmExecutionSelection": [
                    expect.stringContaining("Select a pinned route"),
                ],
            },
        });
    });

    it("forwards the stable browser retry key", async () => {
        const data = new FormData();
        data.set("workflowId", "workflow-1");
        data.set("datasetId", "dataset-1");
        data.set("idempotencyKey", "browser-run-1");

        await createSttEvalRunAction({}, data);

        expect(mocks.createWorkflowRun).toHaveBeenCalledWith(
            expect.objectContaining({ idempotencyKey: "browser-run-1" }),
        );
    });

    it("sends the spend limit and data rules with the run", async () => {
        const data = new FormData();
        data.set("workflowId", "workflow-1");
        data.set("datasetId", "dataset-1");
        data.set("maxCostUsd", "4.5");
        data.set(
            "dataPolicy",
            JSON.stringify({ onlyHosts: ["vertex"], zeroDataRetention: true }),
        );

        await createSttEvalRunAction({}, data);

        expect(mocks.createWorkflowRun).toHaveBeenCalledWith(
            expect.objectContaining({
                maxCostUsd: 4.5,
                dataPolicy: { onlyHosts: ["vertex"], zeroDataRetention: true },
            }),
        );
    });

    it("sends the eval run to compare with, and nothing when none is chosen", async () => {
        const data = new FormData();
        data.set("workflowId", "workflow-1");
        data.set("datasetId", "dataset-1");
        data.set("compareWithRunId", "run-9");

        await createSttEvalRunAction({}, data);
        expect(mocks.createWorkflowRun).toHaveBeenCalledWith(
            expect.objectContaining({ compareWithRunId: "run-9" }),
        );

        mocks.createWorkflowRun.mockClear();
        data.set("compareWithRunId", "");
        await createSttEvalRunAction({}, data);
        const [request] = mocks.createWorkflowRun.mock.calls[0]!;
        expect(request).not.toHaveProperty("compareWithRunId");
    });

    it("leaves the limit and rules out when they are empty, and rejects a bad limit", async () => {
        const data = new FormData();
        data.set("workflowId", "workflow-1");
        data.set("datasetId", "dataset-1");
        data.set("maxCostUsd", "");
        data.set("dataPolicy", "");

        await createSttEvalRunAction({}, data);
        const [request] = mocks.createWorkflowRun.mock.calls[0]!;
        expect(request).not.toHaveProperty("maxCostUsd");
        expect(request).not.toHaveProperty("dataPolicy");

        data.set("maxCostUsd", "-2");
        mocks.createWorkflowRun.mockClear();
        await expect(createSttEvalRunAction({}, data)).resolves.toMatchObject({
            fieldErrors: { maxCostUsd: [expect.stringContaining("above $0")] },
        });
        expect(mocks.createWorkflowRun).not.toHaveBeenCalled();
    });

    it("cancels a pipeline run and refreshes its page", async () => {
        mocks.cancelWorkflowRun.mockResolvedValue({
            workflowRunId: "run-1",
            status: "running",
            stopReason: "cancelled",
        });
        const data = new FormData();
        data.set("workflowId", "workflow-1");
        data.set("runId", "run-1");

        await expect(cancelWorkflowRunAction({}, data)).resolves.toEqual({
            ok: true,
        });
        expect(mocks.cancelWorkflowRun).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            workflowId: "workflow-1",
            workflowRunId: "run-1",
        });
        expect(mocks.revalidatePath).toHaveBeenCalledWith(
            "/multiworkflow/workflow-1/runs/run-1",
        );
    });

    it("says when a retry had nothing to queue", async () => {
        mocks.retryWorkflowRun.mockResolvedValue({
            workflowRunId: "run-1",
            enqueueStatus: "queued",
            retriedCellCount: 0,
            requeued: false,
        });
        const data = new FormData();
        data.set("workflowId", "workflow-1");
        data.set("runId", "run-1");

        await expect(retryWorkflowRunAction({}, data)).resolves.toEqual({
            formError: expect.stringContaining("still waiting in the queue"),
        });
    });
});
