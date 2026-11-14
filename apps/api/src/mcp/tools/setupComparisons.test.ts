import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    cancelSetupComparisonPayload: vi.fn(),
    createSetupComparisonPayload: vi.fn(),
    listSetupComparisonPipelinesPayload: vi.fn(),
    publishSetupComparisonEnqueues: vi.fn(),
    setupComparisonPayload: vi.fn(),
    listPipelineComparisonRunsPayload: vi.fn(),
}));

vi.mock("../../routes/setupComparisons.js", () => ({
    cancelSetupComparisonPayload: mocks.cancelSetupComparisonPayload,
    createSetupComparisonPayload: mocks.createSetupComparisonPayload,
    listSetupComparisonPipelinesPayload:
        mocks.listSetupComparisonPipelinesPayload,
    publishSetupComparisonEnqueues: mocks.publishSetupComparisonEnqueues,
    setupComparisonPayload: mocks.setupComparisonPayload,
}));
vi.mock("../../routes/workflowRunComparison.js", () => ({
    listPipelineComparisonRunsPayload: mocks.listPipelineComparisonRunsPayload,
}));
vi.mock("../../routes/runs.js", () => ({}));
vi.mock("../../runEnqueue.js", () => ({}));

import { registerSetupComparisonTools } from "./setupComparisons.js";
import { createToolHarness, TEST_PROJECT_ID } from "./testSupport.js";

const ID = "22222222-2222-4222-8222-222222222222";
const PIPELINE_ID = "33333333-3333-4333-8333-333333333333";

const evalRunFields = {
    projectId: TEST_PROJECT_ID,
    datasetId: ID,
    promptVersionId: ID,
    maxTokens: 8000,
    judgeModelId: "openai/judge",
    referenceModel: "openai/big-model",
    modelIds: ["openai/big-model"],
    fieldConfigs: [],
    benchmark: {
        taskMap: {
            tasks: [
                {
                    key: "products",
                    name: "Products",
                    method: "agreement",
                    fields: [{ path: "$.products", matcher: "set_overlap" }],
                },
            ],
        },
    },
};

describe("setup comparison MCP tools", () => {
    beforeEach(() => {
        for (const mock of Object.values(mocks)) mock.mockReset();
    });

    it("creates a comparison with its pipelines, spend limit and data rules, then queues it", async () => {
        const { tools, runtime } = createToolHarness(
            registerSetupComparisonTools,
        );
        const created = {
            setupComparisonId: ID,
            evalRunId: ID,
            workflowRunIds: [ID],
        };
        mocks.createSetupComparisonPayload.mockResolvedValue(created);
        mocks.publishSetupComparisonEnqueues.mockResolvedValue({
            ...created,
            enqueueStatus: "queued",
        });
        const tool = tools.get("create_setup_comparison")!;
        const input = tool.config.inputSchema!.parse({
            ...evalRunFields,
            pipelineIds: [PIPELINE_ID],
            maxCostUsd: 5,
            dataPolicy: { onlyHosts: ["vertex"] },
        }) as Record<string, unknown>;

        const result = await tool.handler(input);

        expect(mocks.createSetupComparisonPayload).toHaveBeenCalledWith(
            runtime.db,
            expect.objectContaining({
                pipelineIds: [PIPELINE_ID],
                maxCostUsd: 5,
                dataPolicy: { onlyHosts: ["vertex"] },
                teamId: "team-1",
                createdBy: "user-1",
                promptAssignments: [],
                reasoningConfigs: [],
            }),
            runtime.config,
        );
        expect(mocks.publishSetupComparisonEnqueues).toHaveBeenCalledWith(
            runtime.db,
            runtime.config,
            created,
        );
        expect(result).toMatchObject({
            structuredContent: { data: { setupComparisonId: ID } },
        });
    });

    it("passes per-model temperatures to the comparison's eval run", async () => {
        const { tools, runtime } = createToolHarness(
            registerSetupComparisonTools,
        );
        const created = {
            setupComparisonId: ID,
            evalRunId: ID,
            workflowRunIds: [],
        };
        mocks.createSetupComparisonPayload.mockResolvedValue(created);
        mocks.publishSetupComparisonEnqueues.mockResolvedValue({
            ...created,
            enqueueStatus: "queued",
        });
        const tool = tools.get("create_setup_comparison")!;
        const temperatureAssignments = [
            { modelId: "openai/big-model", temperature: 0 },
        ];
        await tool.handler(
            tool.config.inputSchema!.parse({
                ...evalRunFields,
                pipelineIds: [],
                temperatureAssignments,
            }) as Record<string, unknown>,
        );
        expect(mocks.createSetupComparisonPayload).toHaveBeenCalledWith(
            runtime.db,
            expect.objectContaining({ temperatureAssignments }),
            runtime.config,
        );
    });

    it("requires the pipelines list and caps it", () => {
        const { tools } = createToolHarness(registerSetupComparisonTools);
        const schema = tools.get("create_setup_comparison")!.config
            .inputSchema!;
        expect(schema.safeParse(evalRunFields).success).toBe(false);
        expect(
            schema.safeParse({
                ...evalRunFields,
                pipelineIds: Array.from({ length: 11 }, () => PIPELINE_ID),
            }).success,
        ).toBe(false);
    });

    it("reads and cancels a comparison in the caller's project", async () => {
        const { tools, runtime } = createToolHarness(
            registerSetupComparisonTools,
        );
        mocks.setupComparisonPayload.mockResolvedValue({ id: ID });
        mocks.cancelSetupComparisonPayload.mockResolvedValue({
            setupComparisonId: ID,
            status: "running",
        });
        const input = { projectId: TEST_PROJECT_ID, setupComparisonId: ID };

        await tools.get("get_setup_comparison")!.handler(input);
        const cancelled = await tools
            .get("cancel_setup_comparison")!
            .handler(input);

        expect(mocks.setupComparisonPayload).toHaveBeenCalledWith(
            runtime.db,
            "team-1",
            TEST_PROJECT_ID,
            ID,
        );
        expect(mocks.cancelSetupComparisonPayload).toHaveBeenCalledWith(
            runtime.db,
            {
                teamId: "team-1",
                projectId: TEST_PROJECT_ID,
                setupComparisonId: ID,
            },
        );
        expect(JSON.stringify(cancelled)).toContain("Cancel requested");
    });

    it("lists the eval runs a pipeline can be compared with, on one dataset", async () => {
        const { tools, runtime } = createToolHarness(
            registerSetupComparisonTools,
        );
        mocks.listPipelineComparisonRunsPayload.mockResolvedValue([]);

        await tools.get("list_pipeline_comparison_runs")!.handler({
            projectId: TEST_PROJECT_ID,
            datasetId: ID,
        });

        expect(mocks.listPipelineComparisonRunsPayload).toHaveBeenCalledWith(
            runtime.db,
            "team-1",
            TEST_PROJECT_ID,
            ID,
        );
    });
});
