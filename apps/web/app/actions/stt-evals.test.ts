import { MosaicApiError } from "@mosaic/api-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createWorkflow: vi.fn(),
    updateWorkflow: vi.fn(),
    createWorkflowRun: vi.fn(),
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
    }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
    redirect: mocks.redirect,
    unstable_rethrow: vi.fn(),
}));

import {
    createSttEvalAction,
    createSttEvalRunAction,
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
            new MosaicApiError("Workflow limit reached.", 409),
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

    it.each(["multi", "stt"] as const)(
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
        const { MosaicApiError } = await import("@mosaic/api-contract");
        mocks.createWorkflowRun.mockRejectedValue(
            new MosaicApiError(
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
});
