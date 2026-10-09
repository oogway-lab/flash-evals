import { describe, expect, it, vi } from "vitest";
import type {
    ICreateWorkflowRequest,
    IWorkflowNodeInput,
} from "@mosaic/api-contract";
import { createMultiWorkflowSeed } from "@mosaic/api-contract";
import { WorkflowNodeInput } from "../mcp/schemas.js";
import type { IDb } from "../db.js";
import { ApiNotFoundError } from "../errors.js";
import {
    createWorkflowPayload,
    deleteWorkflowPayload,
    listWorkflowsPayload,
    replaceWorkflowGraph,
    updateWorkflowPayload,
    validateWorkflowDag,
    workflowNodeModelId,
    workflowDetailPayload,
} from "./workflows.js";
import {
    createWorkflowRunPayload,
    listWorkflowRunsPayload,
    workflowRunDetailPayload,
    workflowRunProgressPayload,
    workflowRunSttConfig,
    validateMultiWorkflowRunInput,
    validateWorkflowVisionCapabilities,
} from "./workflowRuns.js";
import { validateSttConfigDefinition } from "./runs/creation.js";

describe("workflow DAG validation", () => {
    const nodes = ["a", "b", "c", "d"].map((nodeKey) => ({ nodeKey }));
    it("accepts branch and merge graphs while preserving linear graphs", () => {
        expect(() =>
            validateWorkflowDag(nodes, [
                { fromNodeKey: "a", toNodeKey: "b" },
                { fromNodeKey: "a", toNodeKey: "c" },
                { fromNodeKey: "b", toNodeKey: "d" },
                { fromNodeKey: "c", toNodeKey: "d" },
            ]),
        ).not.toThrow();
        expect(() =>
            validateWorkflowDag(nodes, [
                { fromNodeKey: "a", toNodeKey: "b" },
                { fromNodeKey: "b", toNodeKey: "c" },
                { fromNodeKey: "c", toNodeKey: "d" },
            ]),
        ).not.toThrow();
    });

    it("rejects cycles and disconnected nodes", () => {
        expect(() =>
            validateWorkflowDag(nodes, [
                { fromNodeKey: "a", toNodeKey: "b" },
                { fromNodeKey: "b", toNodeKey: "a" },
            ]),
        ).toThrow("connected, acyclic");
        expect(() =>
            validateWorkflowDag(nodes, [
                { fromNodeKey: "a", toNodeKey: "b" },
                { fromNodeKey: "b", toNodeKey: "c" },
            ]),
        ).toThrow("connected, acyclic");
    });

    it("rejects duplicate directed edges", () => {
        expect(() =>
            validateWorkflowDag(nodes, [
                { fromNodeKey: "a", toNodeKey: "b" },
                { fromNodeKey: "a", toNodeKey: "b" },
            ]),
        ).toThrow("Duplicate directed workflow edges");
    });

    it("accepts unset positions and rejects non-finite coordinates", () => {
        expect(() =>
            validateWorkflowDag([{ nodeKey: "a", position: null }], []),
        ).not.toThrow();
        expect(() =>
            validateWorkflowDag(
                [{ nodeKey: "a", position: { x: Number.NaN, y: 0 } }],
                [],
            ),
        ).toThrow("finite numeric x and y");
        expect(() =>
            validateWorkflowDag(
                [{ nodeKey: "a", position: { x: 0, y: Infinity } }],
                [],
            ),
        ).toThrow("finite numeric x and y");
    });

    it("accepts independent STT branches and rejects cross-root fan-in", () => {
        const sttNodes = [
            { nodeKey: "root-a", label: "A", nodeType: "stt" as const },
            {
                nodeKey: "text-a",
                label: "Text A",
                nodeType: "llm_text" as const,
            },
            { nodeKey: "root-b", label: "B", nodeType: "stt" as const },
            {
                nodeKey: "text-b",
                label: "Text B",
                nodeType: "llm_text" as const,
            },
        ];
        expect(() =>
            validateWorkflowDag(
                sttNodes,
                [
                    { fromNodeKey: "root-a", toNodeKey: "text-a" },
                    { fromNodeKey: "root-b", toNodeKey: "text-b" },
                ],
                "stt",
            ),
        ).not.toThrow();
        expect(() =>
            validateWorkflowDag(
                sttNodes,
                [
                    { fromNodeKey: "root-a", toNodeKey: "text-a" },
                    { fromNodeKey: "root-b", toNodeKey: "text-a" },
                    { fromNodeKey: "root-b", toNodeKey: "text-b" },
                ],
                "stt",
            ),
        ).toThrow('Node "Text A" must have exactly one STT root ancestor');
    });

    it("rejects inbound edges to STT roots", () => {
        expect(() =>
            validateWorkflowDag(
                [
                    { nodeKey: "root", label: "Root", nodeType: "stt" },
                    { nodeKey: "other", label: "Other", nodeType: "stt" },
                ],
                [{ fromNodeKey: "root", toNodeKey: "other" }],
                "stt",
            ),
        ).toThrow('STT node "Other" must be a branch root');
    });

    it("accepts input-rooted multi branches", () => {
        expect(() =>
            validateWorkflowDag(
                [
                    { nodeKey: "input", label: "Input", nodeType: "input" },
                    { nodeKey: "stt", label: "STT", nodeType: "stt" },
                ],
                [{ fromNodeKey: "input", toNodeKey: "stt" }],
                "multi",
            ),
        ).not.toThrow();
    });

    it.each(["audio", "image", "text"] as const)(
        "accepts the shared %s multiworkflow seed",
        (modality) => {
            const seed = createMultiWorkflowSeed({
                modality,
                datasetId: "dataset-1",
                ...(modality === "audio"
                    ? { sttModelId: "stt:openai:whisper-1" }
                    : {}),
            });
            const parsedNodes = seed.nodes.map((node) =>
                WorkflowNodeInput.parse(node),
            );

            expect(() =>
                validateWorkflowDag(parsedNodes, seed.edges, "multi"),
            ).not.toThrow();
        },
    );

    it("rejects multi branches that do not begin with input nodes", () => {
        expect(() =>
            validateWorkflowDag(
                [{ nodeKey: "stt", label: "STT", nodeType: "stt" }],
                [],
                "multi",
            ),
        ).toThrow("Every multi workflow branch must begin with an input node.");
    });

    it("rejects inbound edges to input nodes", () => {
        expect(() =>
            validateWorkflowDag(
                [
                    {
                        nodeKey: "root-input",
                        label: "Root input",
                        nodeType: "input",
                    },
                    {
                        nodeKey: "nested-input",
                        label: "Nested input",
                        nodeType: "input",
                    },
                ],
                [
                    {
                        fromNodeKey: "root-input",
                        toNodeKey: "nested-input",
                    },
                ],
                "multi",
            ),
        ).toThrow('Input node "Nested input" must be a branch root.');
    });

    it("rejects multi nodes owned by more than one input root", () => {
        expect(() =>
            validateWorkflowDag(
                [
                    { nodeKey: "input-a", label: "A", nodeType: "input" },
                    { nodeKey: "input-b", label: "B", nodeType: "input" },
                    { nodeKey: "stt", label: "STT", nodeType: "stt" },
                ],
                [
                    { fromNodeKey: "input-a", toNodeKey: "stt" },
                    { fromNodeKey: "input-b", toNodeKey: "stt" },
                ],
                "multi",
            ),
        ).toThrow('Node "STT" must have exactly one input root ancestor.');
    });
});

describe("workflow run STT result aggregation", () => {
    it("separates STT scorer coverage and excludes legacy STT scores from node averages", async () => {
        const db = dbWithRows([
            [
                {
                    id: "run-1",
                    teamId: "team-1",
                    projectId: "project-1",
                    workflowId: "workflow-a",
                    datasetId: "dataset-1",
                    status: "completed",
                    workflowSnapshot: {
                        nodes: [{ nodeKey: "summarize" }],
                        edges: [],
                    },
                    runTarget: "dataset",
                    createdAt: new Date("2026-07-12T00:00:00.000Z"),
                },
            ],
            [
                {
                    id: "cell-1",
                    workflowRunId: "run-1",
                    datasetItemId: "item-1",
                    nodeKey: "summarize",
                    status: "succeeded",
                    latencyMs: 100,
                    costUsd: 0.01,
                },
            ],
            [
                { id: "item-1", type: "audio" },
                { id: "item-2", type: "audio" },
            ],
            [
                {
                    cellId: "cell-1",
                    scorerType: "judge",
                    score: 0.8,
                    detailsJson: {},
                    rationale: "good",
                },
                {
                    cellId: "cell-1",
                    scorerType: "transcript_metric",
                    score: 0,
                    detailsJson: {},
                    rationale: "legacy",
                },
            ],
            [
                {
                    id: "preparation-1",
                    workflowRunId: "run-1",
                    datasetItemId: "item-1",
                    selectedTranscript: "hello",
                    transcriptVariant: "raw",
                    segments: [],
                    speakers: [],
                    warnings: [],
                    preparationStatus: "completed",
                    evaluationStatus: "completed",
                },
                {
                    id: "preparation-2",
                    workflowRunId: "run-1",
                    datasetItemId: "item-2",
                    selectedTranscript: "world",
                    transcriptVariant: "raw",
                    segments: [],
                    speakers: [],
                    warnings: [],
                    preparationStatus: "completed",
                    evaluationStatus: "partial",
                },
            ],
            [
                {
                    datasetItemId: "item-1",
                    scorerType: "transcript_metric",
                    status: "completed",
                    score: 0,
                    detailsJson: { metricKind: "mechanical_stt" },
                    rationale: null,
                    error: null,
                },
                {
                    datasetItemId: "item-2",
                    scorerType: "transcript_metric",
                    status: "skipped",
                    score: null,
                    detailsJson: { metricKind: "mechanical_stt" },
                    rationale: null,
                    error: null,
                },
                {
                    datasetItemId: "item-1",
                    scorerType: "transcript_judge",
                    status: "error",
                    score: null,
                    detailsJson: { metricKind: "llm_judge" },
                    rationale: null,
                    error: "provider unavailable",
                },
            ],
            [],
            [],
            [{ status: "completed", total: 1, done: 1, failed: 0, pending: 0 }],
        ]);

        const payload = await workflowRunDetailPayload(
            db,
            "team-1",
            "project-1",
            "workflow-a",
            "run-1",
        );

        expect(payload.nodeAggregates[0]?.averageScore).toBe(0.8);
        expect(payload.scoresByCell["cell-1"]).toHaveLength(2);
        expect(payload.sttScoresByItem["item-1"]).toEqual([
            expect.objectContaining({
                scorerType: "transcript_metric",
                score: 0,
            }),
            expect.objectContaining({
                scorerType: "transcript_judge",
                status: "error",
            }),
        ]);
        expect(payload.sttAggregates).toEqual([
            {
                scorerType: "transcript_metric",
                scored: 1,
                skipped: 1,
                failed: 0,
                averageScore: 0,
            },
            {
                scorerType: "transcript_judge",
                scored: 0,
                skipped: 0,
                failed: 1,
                averageScore: undefined,
            },
        ]);
        const sttQueries = vi
            .mocked(db.query)
            .mock.calls.filter(([sql]) =>
                String(sql).includes("workflow_run_item"),
            );
        expect(sttQueries).toHaveLength(2);
        for (const [sql, parameters] of sttQueries) {
            expect(sql).toContain("r.workflow_id=$2");
            expect(sql).toContain("r.team_id=$3");
            expect(sql).toContain("r.project_id=$4");
            expect(parameters).toEqual([
                "run-1",
                "workflow-a",
                "team-1",
                "project-1",
            ]);
        }
    });
});

function dbWithRows(rows: unknown[][]): IDb {
    const queue = [...rows];
    return {
        query: vi.fn(async () => ({ rows: queue.shift() ?? [] }) as never),
    };
}

const workflowInput: ICreateWorkflowRequest = {
    teamId: "team-1",
    projectId: "project-1",
    name: "Chain",
    createdBy: "user-1",
    nodes: [
        {
            nodeKey: "first",
            label: "First",
            promptVersionId: "11111111-1111-4111-8111-111111111111",
            modelId: "gpt-5",
            evalConfig: { type: "none" },
        },
    ],
    edges: [],
};

const datasetId = "22222222-2222-4222-8222-222222222222";

function multiWorkflowInput(
    nodes: IWorkflowNodeInput[],
    edges: ICreateWorkflowRequest["edges"] = [],
): ICreateWorkflowRequest {
    return {
        teamId: "team-1",
        projectId: "project-1",
        name: "Multiworkflow",
        kind: "multi",
        createdBy: "user-1",
        nodes,
        edges,
    };
}

function inputNode(
    overrides: Partial<IWorkflowNodeInput> = {},
): IWorkflowNodeInput {
    return {
        nodeKey: "input",
        label: "Input",
        nodeType: "input",
        nodeConfig: { type: "input", modality: "audio", datasetId },
        evalConfig: { type: "none" },
        ...overrides,
    } as IWorkflowNodeInput;
}

const sttNode: IWorkflowNodeInput = {
    nodeKey: "stt",
    label: "STT",
    nodeType: "stt",
    nodeConfig: {
        type: "stt",
        sttConfig: { modelId: "openai:gpt-4o-transcribe" },
    },
    evalConfig: { type: "none" },
};

describe("workflow project scoping", () => {
    it("forbids model and prompt-version ids on input-node writes", () => {
        // @ts-expect-error Input nodes cannot carry model or prompt-version IDs.
        const invalidInputNode: IWorkflowNodeInput = {
            nodeKey: "input",
            label: "Input",
            nodeType: "input",
            nodeConfig: { type: "input", modality: "text" },
            modelId: "gpt-5",
            promptVersionId: "11111111-1111-4111-8111-111111111111",
            evalConfig: { type: "none" },
        };

        expect(invalidInputNode.nodeType).toBe("input");
    });

    it("saves an input node whose model and prompt version arrive as JSON null", async () => {
        // The API serializes an absent model as null, so a workflow read
        // back from the server and re-saved arrives with modelId: null.
        // Treating that as "references a model" makes every saved input node
        // permanently unsaveable from the canvas.
        const input = multiWorkflowInput(
            [
                {
                    ...inputNode(),
                    modelId: null,
                    promptVersionId: null,
                } as unknown as IWorkflowNodeInput,
                sttNode,
            ],
            [
                {
                    fromNodeKey: "input",
                    toNodeKey: "stt",
                    carryOriginalInput: false,
                },
            ],
        );
        const db = dbWithRows([
            [{ id: datasetId }],
            [],
            [],
            [],
            [],
            [
                {
                    id: "workflow-1",
                    teamId: input.teamId,
                    projectId: input.projectId,
                    name: input.name,
                    description: "",
                    kind: "multi",
                    createdAt: "2026-07-20T00:00:00.000Z",
                },
            ],
            [
                {
                    id: "node-input",
                    workflowId: "workflow-1",
                    ...input.nodes[0],
                    modelId: null,
                    position: null,
                },
                {
                    id: "node-stt",
                    workflowId: "workflow-1",
                    ...input.nodes[1],
                    modelId: "openai:gpt-4o-transcribe",
                    position: null,
                },
            ],
            [
                {
                    id: "edge-1",
                    workflowId: "workflow-1",
                    fromNodeId: "node-input",
                    toNodeId: "node-stt",
                    carryOriginalInput: false,
                },
            ],
        ]);

        const workflow = await createWorkflowPayload(db, input);

        expect(workflow.kind).toBe("multi");
        expect(workflow.nodes.map((node) => node.nodeType)).toEqual([
            "input",
            "stt",
        ]);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("insert into workflow_edges"),
            expect.arrayContaining([false]),
        );
    });

    it("saves an input-to-STT multi workflow", async () => {
        const input = multiWorkflowInput(
            [inputNode(), sttNode],
            [
                {
                    fromNodeKey: "input",
                    toNodeKey: "stt",
                    carryOriginalInput: false,
                },
            ],
        );
        const db = dbWithRows([
            [{ id: datasetId }],
            [],
            [],
            [],
            [],
            [
                {
                    id: "workflow-1",
                    teamId: input.teamId,
                    projectId: input.projectId,
                    name: input.name,
                    description: "",
                    kind: "multi",
                    createdAt: "2026-07-20T00:00:00.000Z",
                },
            ],
            [
                {
                    id: "node-input",
                    workflowId: "workflow-1",
                    ...input.nodes[0],
                    modelId: null,
                    position: null,
                },
                {
                    id: "node-stt",
                    workflowId: "workflow-1",
                    ...input.nodes[1],
                    modelId: "openai:gpt-4o-transcribe",
                    position: null,
                },
            ],
            [
                {
                    id: "edge-1",
                    workflowId: "workflow-1",
                    fromNodeId: "node-input",
                    toNodeId: "node-stt",
                    carryOriginalInput: false,
                },
            ],
        ]);

        const workflow = await createWorkflowPayload(db, input);

        expect(workflow.kind).toBe("multi");
        expect(workflow.nodes.map((node) => node.nodeType)).toEqual([
            "input",
            "stt",
        ]);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("insert into workflow_edges"),
            expect.arrayContaining([false]),
        );
    });

    it("rejects unknown workflow kinds", async () => {
        const db = dbWithRows([]);
        await expect(
            createWorkflowPayload(db, {
                ...multiWorkflowInput([inputNode()]),
                kind: "typo" as never,
            }),
        ).rejects.toThrow("Workflow kind must be prompt, stt, or multi.");
        expect(db.query).not.toHaveBeenCalled();
    });

    it("keeps input nodes out of legacy STT workflows", async () => {
        const db = dbWithRows([]);
        await expect(
            createWorkflowPayload(db, {
                ...multiWorkflowInput(
                    [sttNode, inputNode()],
                    [
                        {
                            fromNodeKey: "stt",
                            toNodeKey: "input",
                            carryOriginalInput: false,
                        },
                    ],
                ),
                kind: "stt",
            }),
        ).rejects.toThrow('Node "Input" is not valid in a stt workflow.');
        expect(db.query).not.toHaveBeenCalled();
    });

    it("allows prompt nodes in input-rooted multi workflows", async () => {
        const promptNode = workflowInput.nodes[0]!;
        const input = multiWorkflowInput(
            [inputNode(), promptNode],
            [
                {
                    fromNodeKey: "input",
                    toNodeKey: promptNode.nodeKey,
                    carryOriginalInput: false,
                },
            ],
        );
        const db = dbWithRows([
            [{ id: promptNode.promptVersionId }],
            [{ id: datasetId }],
            [],
            [],
            [],
            [],
            [
                {
                    id: "workflow-1",
                    teamId: input.teamId,
                    projectId: input.projectId,
                    name: input.name,
                    description: "",
                    kind: "multi",
                    createdAt: "2026-07-20T00:00:00.000Z",
                },
            ],
            [
                {
                    id: "node-input",
                    workflowId: "workflow-1",
                    ...input.nodes[0],
                    modelId: null,
                    position: null,
                },
                {
                    id: "node-prompt",
                    workflowId: "workflow-1",
                    ...promptNode,
                    nodeType: "prompt",
                    nodeConfig: { type: "prompt" },
                    position: null,
                },
            ],
            [],
        ]);

        await expect(createWorkflowPayload(db, input)).resolves.toMatchObject({
            kind: "multi",
            nodes: [
                expect.objectContaining({ nodeType: "input" }),
                expect.objectContaining({ nodeType: "prompt" }),
            ],
        });
    });

    it("rejects input nodes with invalid modality and dataset IDs", async () => {
        const invalidModality = inputNode({
            nodeConfig: {
                type: "input",
                modality: "video",
                datasetId,
            } as never,
        });
        const invalidDataset = inputNode({
            nodeConfig: {
                type: "input",
                modality: "audio",
                datasetId: "not-a-uuid",
            },
        });

        await expect(
            createWorkflowPayload(
                dbWithRows([]),
                multiWorkflowInput([invalidModality]),
            ),
        ).rejects.toThrow('Node "Input" has an invalid input modality.');
        await expect(
            createWorkflowPayload(
                dbWithRows([]),
                multiWorkflowInput([invalidDataset]),
            ),
        ).rejects.toThrow('Node "Input" must reference a valid dataset ID.');
    });

    it("rejects forbidden references on input-node JSON", async () => {
        const db = dbWithRows([]);
        const invalidInput = {
            ...inputNode(),
            modelId: "gpt-5",
            promptVersionId: "11111111-1111-4111-8111-111111111111",
        } as IWorkflowNodeInput;

        await expect(
            createWorkflowPayload(db, multiWorkflowInput([invalidInput])),
        ).rejects.toThrow(
            'Input node "Input" cannot reference a model or prompt version.',
        );
        expect(db.query).not.toHaveBeenCalled();
    });

    it("rejects input nodes that do not share one dataset", async () => {
        const db = dbWithRows([]);
        await expect(
            createWorkflowPayload(
                db,
                multiWorkflowInput([
                    inputNode({ nodeKey: "input-a", label: "A" }),
                    inputNode({
                        nodeKey: "input-b",
                        label: "B",
                        nodeConfig: {
                            type: "input",
                            modality: "audio",
                            datasetId: "33333333-3333-4333-8333-333333333333",
                        },
                    }),
                ]),
            ),
        ).rejects.toThrow(
            "All input nodes in a workflow must reference the same dataset.",
        );
        expect(db.query).not.toHaveBeenCalled();
    });

    it("allows bound and unbound input nodes to be saved together", async () => {
        const input = multiWorkflowInput([
            inputNode({ nodeKey: "input-a", label: "Bound" }),
            inputNode({
                nodeKey: "input-b",
                label: "Unbound",
                nodeConfig: { type: "input", modality: "audio" },
            }),
        ]);
        const db = dbWithRows([
            [{ id: datasetId }],
            [],
            [],
            [],
            [
                {
                    id: "workflow-1",
                    teamId: input.teamId,
                    projectId: input.projectId,
                    name: input.name,
                    description: "",
                    kind: "multi",
                    createdAt: "2026-07-21T00:00:00.000Z",
                },
            ],
            input.nodes.map((node, index) => ({
                id: `node-${index}`,
                workflowId: "workflow-1",
                ...node,
                modelId: null,
                position: null,
            })),
            [],
        ]);

        await expect(createWorkflowPayload(db, input)).resolves.toMatchObject({
            kind: "multi",
        });
    });

    it("allows all input nodes to remain unbound while saving", async () => {
        const input = multiWorkflowInput([
            inputNode({
                nodeKey: "input-a",
                label: "First unbound",
                nodeConfig: { type: "input", modality: "audio" },
            }),
            inputNode({
                nodeKey: "input-b",
                label: "Second unbound",
                nodeConfig: { type: "input", modality: "audio" },
            }),
        ]);
        const db = dbWithRows([
            [],
            [],
            [],
            [
                {
                    id: "workflow-1",
                    teamId: input.teamId,
                    projectId: input.projectId,
                    name: input.name,
                    description: "",
                    kind: "multi",
                    createdAt: "2026-07-21T00:00:00.000Z",
                },
            ],
            input.nodes.map((node, index) => ({
                id: `node-${index}`,
                workflowId: "workflow-1",
                ...node,
                modelId: null,
                position: null,
            })),
            [],
        ]);

        await expect(createWorkflowPayload(db, input)).resolves.toMatchObject({
            kind: "multi",
        });
    });

    it("rejects a foreign input dataset before inserting workflow nodes", async () => {
        const db = dbWithRows([[]]);
        let thrown: unknown;
        try {
            await createWorkflowPayload(db, multiWorkflowInput([inputNode()]));
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(ApiNotFoundError);
        expect(thrown).toHaveProperty(
            "message",
            "Every input node must reference a dataset in this project.",
        );
        expect(db.query).toHaveBeenCalledWith(
            "select id from datasets where id = any($1::uuid[]) and team_id = $2 and project_id = $3",
            [[datasetId], "team-1", "project-1"],
        );
        expect(
            vi
                .mocked(db.query)
                .mock.calls.some(([sql]) =>
                    String(sql).includes("insert into workflow_nodes"),
                ),
        ).toBe(false);
    });

    it("preserves saved STT defaults when an older update client omits the field", async () => {
        const db = dbWithRows([
            [{ kind: "prompt" }],
            [{ id: workflowInput.nodes[0]!.promptVersionId }],
            [{ id: "workflow-1" }],
            [],
            [],
            [],
            [
                {
                    id: "workflow-1",
                    teamId: "team-1",
                    projectId: "project-1",
                    name: "Chain",
                    description: "",
                    sttConfig: { modelId: "openai:gpt-4o-transcribe" },
                    createdAt: "2026-07-11T00:00:00.000Z",
                },
            ],
            [],
            [],
        ]);

        await updateWorkflowPayload(db, {
            ...workflowInput,
            workflowId: "workflow-1",
        });

        const updateCall = vi
            .mocked(db.query)
            .mock.calls.find(([sql]) =>
                sql.includes("update prompt_workflows"),
            );
        expect(updateCall?.[1]?.slice(2, 4)).toEqual([false, null]);
    });

    it("preserves a stored multi kind when an update omits kind", async () => {
        const node = inputNode();
        const db = dbWithRows([
            [{ kind: "multi" }],
            [{ id: datasetId }],
            [{ id: "workflow-1" }],
            [],
            [],
            [],
            [
                {
                    id: "workflow-1",
                    teamId: "team-1",
                    projectId: "project-1",
                    name: "Multiworkflow",
                    description: "",
                    kind: "multi",
                    sttConfig: null,
                    createdAt: "2026-07-21T00:00:00.000Z",
                },
            ],
            [
                {
                    id: "node-input",
                    workflowId: "workflow-1",
                    ...node,
                    modelId: null,
                    promptVersionId: null,
                    reasoningConfig: null,
                    position: null,
                },
            ],
            [],
        ]);

        const workflow = await updateWorkflowPayload(db, {
            teamId: "team-1",
            projectId: "project-1",
            workflowId: "workflow-1",
            name: "Multiworkflow",
            nodes: [node],
            edges: [],
        });

        const updateCall = vi
            .mocked(db.query)
            .mock.calls.find(([sql]) =>
                sql.includes("update prompt_workflows"),
            );
        expect(updateCall?.[1]?.[4]).toBe("multi");
        expect(workflow.kind).toBe("multi");
    });

    it("clears saved STT defaults when an update explicitly sends null", async () => {
        const db = dbWithRows([
            [{ kind: "prompt" }],
            [{ id: workflowInput.nodes[0]!.promptVersionId }],
            [{ id: "workflow-1" }],
            [],
            [],
            [],
            [
                {
                    id: "workflow-1",
                    teamId: "team-1",
                    projectId: "project-1",
                    name: "Chain",
                    description: "",
                    sttConfig: null,
                    createdAt: "2026-07-11T00:00:00.000Z",
                },
            ],
            [],
            [],
        ]);

        await updateWorkflowPayload(db, {
            ...workflowInput,
            workflowId: "workflow-1",
            sttConfig: null,
        });

        const updateCall = vi
            .mocked(db.query)
            .mock.calls.find(([sql]) =>
                sql.includes("update prompt_workflows"),
            );
        expect(updateCall?.[1]?.slice(2, 4)).toEqual([true, null]);
    });

    it("round-trips stored positions and normalizes database null to omission", async () => {
        const db = dbWithRows([
            [
                {
                    id: "workflow-1",
                    teamId: "team-1",
                    projectId: "project-1",
                    name: "Graph",
                    description: "",
                    createdAt: "2026-07-11T00:00:00.000Z",
                },
            ],
            [
                {
                    id: "node-a",
                    workflowId: "workflow-1",
                    nodeKey: "a",
                    label: "A",
                    promptVersionId: "version-a",
                    modelId: "gpt-5",
                    evalConfig: { type: "none" },
                    position: { x: 12, y: 34 },
                },
                {
                    id: "node-b",
                    workflowId: "workflow-1",
                    nodeKey: "b",
                    label: "B",
                    promptVersionId: "version-b",
                    modelId: "gpt-5",
                    evalConfig: { type: "none" },
                    position: null,
                },
            ],
            [],
        ]);

        const workflow = await workflowDetailPayload(
            db,
            "team-1",
            "project-1",
            "workflow-1",
        );

        expect(workflow.nodes[0]?.position).toEqual({ x: 12, y: 34 });
        expect(workflow.nodes[1]).not.toHaveProperty("position");
        expect(workflow.nodes[1]?.position).toBeUndefined();
    });

    it("round-trips a multi-workflow input node with its config intact", async () => {
        const inputNode = {
            nodeKey: "audio-input",
            label: "Audio input",
            nodeType: "input",
            nodeConfig: {
                type: "input",
                modality: "audio",
                datasetId: "22222222-2222-4222-8222-222222222222",
            },
            evalConfig: { type: "none" },
        } satisfies IWorkflowNodeInput;
        const storedNodes: unknown[] = [];
        const db: IDb = {
            query: vi.fn(async (sql, values = []) => {
                if (sql.startsWith("insert into workflow_nodes")) {
                    const [
                        id,
                        workflowId,
                        nodeKey,
                        label,
                        nodeType,
                        nodeConfig,
                        promptVersionId,
                        modelId,
                        reasoningConfig,
                        evalConfig,
                        position,
                    ] = values;
                    storedNodes.push({
                        id,
                        workflowId,
                        nodeKey,
                        label,
                        nodeType,
                        nodeConfig,
                        promptVersionId,
                        modelId,
                        reasoningConfig,
                        evalConfig,
                        position,
                    });
                    return { rows: [] } as never;
                }
                if (sql.includes("from prompt_workflows where id=$1"))
                    return {
                        rows: [
                            {
                                id: "workflow-1",
                                teamId: "team-1",
                                projectId: "project-1",
                                name: "Multiworkflow",
                                description: "",
                                kind: "multi",
                                createdAt: "2026-07-20T00:00:00.000Z",
                            },
                        ],
                    } as never;
                if (sql.includes("from workflow_nodes where workflow_id=$1"))
                    return { rows: storedNodes } as never;
                return { rows: [] } as never;
            }),
        };

        await replaceWorkflowGraph(db, "workflow-1", {
            teamId: "team-1",
            projectId: "project-1",
            name: "Multiworkflow",
            kind: "multi",
            createdBy: "user-1",
            nodes: [inputNode],
            edges: [],
        });

        const workflow = await workflowDetailPayload(
            db,
            "team-1",
            "project-1",
            "workflow-1",
        );

        expect(workflow.kind).toBe("multi");
        expect(workflow.nodes[0]).toMatchObject({
            nodeType: "input",
            nodeConfig: inputNode.nodeConfig,
        });
        // The read must not echo storage columns the node type forbids on
        // write, or a client that edits what it read is rejected for a field
        // the API handed it.
        expect(workflow.nodes[0]).not.toHaveProperty("modelId");
        expect(workflow.nodes[0]).not.toHaveProperty("promptVersionId");
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("insert into workflow_nodes"),
            expect.arrayContaining([
                "workflow-1",
                "input",
                inputNode.nodeConfig,
                null,
            ]),
        );
    });

    it("returns summary rows and forwards the optional kind filter", async () => {
        const db = dbWithRows([
            [
                {
                    id: "workflow-1",
                    teamId: "team-1",
                    projectId: "project-1",
                    name: "Chain",
                    description: "",
                    createdAt: new Date("2026-07-11T00:00:00Z"),
                    nodeCount: 2,
                },
            ],
        ]);
        await expect(
            listWorkflowsPayload(db, "team-1", "project-1"),
        ).resolves.toEqual([
            {
                id: "workflow-1",
                teamId: "team-1",
                projectId: "project-1",
                name: "Chain",
                description: "",
                kind: "prompt",
                createdAt: "2026-07-11T00:00:00.000Z",
                nodeCount: 2,
            },
        ]);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("w.project_id = $2"),
            ["team-1", "project-1", null],
        );

        await listWorkflowsPayload(db, "team-1", "project-1", "multi");

        expect(db.query).toHaveBeenLastCalledWith(
            expect.stringContaining("w.kind = $3"),
            ["team-1", "project-1", "multi"],
        );
    });

    it("rejects prompt versions outside the requested team and project", async () => {
        const db = dbWithRows([[]]);
        await expect(createWorkflowPayload(db, workflowInput)).rejects.toThrow(
            "in this project",
        );
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("p.team_id = $2 and p.project_id = $3"),
            [[workflowInput.nodes[0]!.promptVersionId], "team-1", "project-1"],
        );
    });

    it("requires exactly one judge source", async () => {
        const db = dbWithRows([]);
        await expect(
            createWorkflowPayload(db, {
                ...workflowInput,
                nodes: [
                    {
                        ...workflowInput.nodes[0]!,
                        evalConfig: { type: "judge" },
                    },
                ],
            }),
        ).rejects.toThrow("exactly one judge source");
        expect(db.query).not.toHaveBeenCalled();
    });

    it("rejects empty field-difference configuration", async () => {
        const db = dbWithRows([]);
        await expect(
            createWorkflowPayload(db, {
                ...workflowInput,
                nodes: [
                    {
                        ...workflowInput.nodes[0]!,
                        evalConfig: { type: "field_diff", fieldConfigs: [] },
                    },
                ],
            }),
        ).rejects.toThrow("at least one field");
        expect(db.query).not.toHaveBeenCalled();
    });

    it("archives workflows so historical runs remain referenced", async () => {
        const db = dbWithRows([[]]);
        await deleteWorkflowPayload(db, {
            teamId: "team-1",
            projectId: "project-1",
            workflowId: "workflow-1",
        });
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("set archived_at = now()"),
            ["workflow-1", "team-1", "project-1"],
        );
    });

    it("rejects a foreign dataset before creating a workflow run", async () => {
        const db = dbWithRows([
            [
                {
                    id: "workflow-1",
                    teamId: "team-1",
                    projectId: "project-1",
                    name: "Chain",
                    description: "",
                    createdAt: "2026-07-11",
                },
            ],
            [
                [
                    {
                        id: "node-1",
                        workflowId: "workflow-1",
                        nodeKey: "first",
                        label: "First",
                        promptVersionId:
                            workflowInput.nodes[0]!.promptVersionId,
                        modelId: "gpt-5",
                        evalConfig: { type: "none" },
                    },
                ],
            ].flat(),
            [],
            [
                {
                    id: workflowInput.nodes[0]!.promptVersionId,
                    content: "Prompt",
                },
            ],
            [],
        ]);
        await expect(
            createWorkflowRunPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                workflowId: "workflow-1",
                datasetId: "foreign",
                runTarget: "dataset",
                createdBy: "user-1",
            }),
        ).rejects.toThrow("Dataset not found");
        expect(db.query).toHaveBeenLastCalledWith(
            expect.stringContaining("team_id=$2 and project_id=$3"),
            ["foreign", "team-1", "project-1"],
        );
    });

    it("rejects archived datasets before inserting run cells", async () => {
        const node = {
            id: "node-1",
            workflowId: "workflow-1",
            nodeKey: "first",
            label: "First",
            promptVersionId: workflowInput.nodes[0]!.promptVersionId,
            modelId: "gpt-5",
            evalConfig: { type: "none" },
        };
        const db = dbWithRows([
            [
                {
                    id: "workflow-1",
                    teamId: "team-1",
                    projectId: "project-1",
                    name: "Chain",
                    description: "",
                    createdAt: "2026-07-11",
                },
            ],
            [node],
            [],
            [{ id: node.promptVersionId, content: "Prompt" }],
            [{ archivedAt: "2026-07-11" }],
        ]);
        await expect(
            createWorkflowRunPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                workflowId: "workflow-1",
                datasetId: "dataset-1",
                runTarget: "dataset",
                createdBy: "user-1",
            }),
        ).rejects.toThrow("archived");
    });

    it("requires an STT model before creating an audio workflow run", async () => {
        const node = {
            id: "node-1",
            workflowId: "workflow-1",
            nodeKey: "first",
            label: "First",
            promptVersionId: workflowInput.nodes[0]!.promptVersionId,
            modelId: "gpt-5",
            evalConfig: { type: "none" },
        };
        const db = dbWithRows([
            [
                {
                    id: "workflow-1",
                    teamId: "team-1",
                    projectId: "project-1",
                    name: "Audio chain",
                    description: "",
                    createdAt: "2026-07-11",
                },
            ],
            [node],
            [],
            [{ id: node.promptVersionId, content: "Prompt" }],
            [{ archivedAt: null, modality: "audio" }],
        ]);

        await expect(
            createWorkflowRunPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                workflowId: "workflow-1",
                datasetId: "dataset-1",
                runTarget: "dataset",
                createdBy: "user-1",
            }),
        ).rejects.toThrow("Choose an STT model for audio datasets");
    });

    it("rejects a multi run whose selected dataset differs from its input block", async () => {
        const node = {
            id: "node-input",
            workflowId: "workflow-1",
            nodeKey: "input",
            label: "Image input",
            nodeType: "input",
            nodeConfig: {
                type: "input",
                modality: "image",
                datasetId: "dataset-configured",
            },
            evalConfig: { type: "none" },
        };
        const db = dbWithRows([
            [
                {
                    id: "workflow-1",
                    teamId: "team-1",
                    projectId: "project-1",
                    name: "Image workflow",
                    description: "",
                    kind: "multi",
                    createdAt: "2026-07-20",
                },
            ],
            [node],
            [],
            [{ archivedAt: null, modality: "image" }],
        ]);

        await expect(
            createWorkflowRunPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                workflowId: "workflow-1",
                datasetId: "dataset-selected",
                runTarget: "dataset",
                createdBy: "user-1",
            }),
        ).rejects.toThrow(
            "Select the dataset configured by the workflow input block.",
        );
    });

    it("rejects an unbound multi input before inserting a run row", async () => {
        const node = {
            id: "node-input",
            workflowId: "workflow-1",
            nodeKey: "input",
            label: "Unbound image input",
            nodeType: "input" as const,
            nodeConfig: { type: "input" as const, modality: "image" as const },
            evalConfig: { type: "none" as const },
        };
        const db = dbWithRows([
            [
                {
                    id: "workflow-1",
                    teamId: "team-1",
                    projectId: "project-1",
                    name: "Image workflow",
                    description: "",
                    kind: "multi",
                    createdAt: "2026-07-21",
                },
            ],
            [node],
            [],
            [{ archivedAt: null, modality: "image" }],
        ]);

        await expect(
            createWorkflowRunPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                workflowId: "workflow-1",
                datasetId: "dataset-selected",
                runTarget: "dataset",
                createdBy: "user-1",
            }),
        ).rejects.toThrow(
            'Workflow input "Unbound image input" must select a dataset before running.',
        );
        expect(
            vi
                .mocked(db.query)
                .mock.calls.some(([sql]) =>
                    String(sql).includes("insert into workflow_runs"),
                ),
        ).toBe(false);
    });

    it("rejects a non-vision model from multi run creation", async () => {
        const input = {
            id: "node-input",
            workflowId: "workflow-1",
            nodeKey: "input",
            label: "Image input",
            nodeType: "input",
            nodeConfig: {
                type: "input",
                modality: "image",
                datasetId: "dataset-1",
            },
            evalConfig: { type: "none" },
        };
        const prompt = {
            id: "node-prompt",
            workflowId: "workflow-1",
            nodeKey: "prompt",
            label: "Prompt",
            nodeType: "prompt",
            nodeConfig: { type: "prompt" },
            promptVersionId: "prompt-version-1",
            modelId: "xai/grok-4",
            evalConfig: { type: "none" },
        };
        const db = dbWithRows([
            [
                {
                    id: "workflow-1",
                    teamId: "team-1",
                    projectId: "project-1",
                    name: "Image workflow",
                    description: "",
                    kind: "multi",
                    createdAt: "2026-07-20",
                },
            ],
            [input, prompt],
            [
                {
                    id: "edge-1",
                    workflowId: "workflow-1",
                    fromNodeId: input.id,
                    toNodeId: prompt.id,
                    carryOriginalInput: false,
                },
            ],
            [{ id: "prompt-version-1", content: "Describe" }],
            [{ archivedAt: null, modality: "image" }],
        ]);

        await expect(
            createWorkflowRunPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                workflowId: "workflow-1",
                datasetId: "dataset-1",
                runTarget: "dataset",
                createdBy: "user-1",
            }),
        ).rejects.toThrow(
            "xai/grok-4 cannot run on image inputs because vision support is not available.",
        );
    });
});

describe("workflow STT configuration", () => {
    const savedDefault = { modelId: "openai:gpt-4o-transcribe" };
    const override = { modelId: "openai:gpt-4o-mini-transcribe" };

    it("uses run overrides before saved defaults for audio datasets", () => {
        expect(workflowRunSttConfig("audio", override, savedDefault)).toBe(
            override,
        );
        expect(workflowRunSttConfig("audio", undefined, savedDefault)).toBe(
            savedDefault,
        );
    });

    it("does not apply STT configuration to non-audio datasets", () => {
        expect(workflowRunSttConfig("text", override, savedDefault)).toBe(
            undefined,
        );
        expect(workflowRunSttConfig("image", override, savedDefault)).toBe(
            undefined,
        );
    });

    it("rejects malformed saved defaults before persistence", () => {
        expect(() =>
            validateSttConfigDefinition({
                modelId: "openai:gpt-4o-transcribe",
                transcriptVariant: "unsupported" as "raw",
            }),
        ).toThrow("supported transcript variant");
        expect(() =>
            validateSttConfigDefinition({
                modelId: "unknown:model",
            }),
        ).toThrow("supported STT model");
    });

    it("persists nested STT model ids in the constrained model_id column", () => {
        expect(
            workflowNodeModelId({
                modelId: "stale-model",
                nodeConfig: {
                    type: "stt",
                    sttConfig: { modelId: "soniox:stt-async-v5" },
                },
            }),
        ).toBe("soniox:stt-async-v5");
        expect(
            workflowNodeModelId({
                nodeConfig: {
                    type: "metric_compare",
                    referenceField: "expectedTranscript",
                },
            }),
        ).toBeNull();
    });
});

describe("multiworkflow vision capability validation", () => {
    const configByType = {
        prompt: { type: "prompt" },
        llm_text: { type: "llm_text", promptText: "Process" },
        judge: { type: "judge", rubricPrompt: "Judge" },
    } as const;
    const input = {
        id: "node-input",
        workflowId: "workflow-1",
        nodeKey: "input",
        label: "Image input",
        nodeType: "input" as const,
        nodeConfig: { type: "input" as const, modality: "image" as const },
        evalConfig: { type: "none" as const },
    };

    it.each(["prompt", "llm_text", "judge"] as const)(
        "rejects a non-vision %s node directly downstream of an image input",
        (nodeType) => {
            const target = {
                id: `node-${nodeType}`,
                workflowId: "workflow-1",
                nodeKey: nodeType,
                label: nodeType,
                nodeType,
                nodeConfig: configByType[nodeType],
                modelId: "xai/grok-4",
                evalConfig: { type: "none" as const },
            };

            expect(() =>
                validateWorkflowVisionCapabilities(
                    [input, target],
                    [
                        {
                            id: "edge-1",
                            workflowId: "workflow-1",
                            fromNodeId: input.id,
                            toNodeId: target.id,
                            carryOriginalInput: false,
                        },
                    ],
                ),
            ).toThrow(
                "xai/grok-4 cannot run on image inputs because vision support is not available.",
            );
        },
    );

    it("accepts a vision model and does not validate nodes beyond the direct child", () => {
        const direct = {
            id: "node-direct",
            workflowId: "workflow-1",
            nodeKey: "direct",
            label: "Direct",
            nodeType: "prompt" as const,
            nodeConfig: { type: "prompt" as const },
            modelId: "gpt-4o",
            evalConfig: { type: "none" as const },
        };
        const indirect = {
            ...direct,
            id: "node-indirect",
            nodeKey: "indirect",
            modelId: "xai/grok-4",
        };

        expect(() =>
            validateWorkflowVisionCapabilities(
                [input, direct, indirect],
                [
                    {
                        id: "edge-1",
                        workflowId: "workflow-1",
                        fromNodeId: input.id,
                        toNodeId: direct.id,
                        carryOriginalInput: false,
                    },
                    {
                        id: "edge-2",
                        workflowId: "workflow-1",
                        fromNodeId: direct.id,
                        toNodeId: indirect.id,
                        carryOriginalInput: false,
                    },
                ],
            ),
        ).not.toThrow();
    });
});

describe("multiworkflow run input validation", () => {
    const input = {
        id: "node-input",
        workflowId: "workflow-1",
        nodeKey: "input",
        label: "Image input",
        nodeType: "input" as const,
        nodeConfig: {
            type: "input" as const,
            modality: "image" as const,
            datasetId: "dataset-1",
        },
        evalConfig: { type: "none" as const },
    };

    it("rejects a selected dataset that differs from the input block", () => {
        expect(() =>
            validateMultiWorkflowRunInput([input], "dataset-2", "image"),
        ).toThrow("Select the dataset configured by the workflow input block.");
    });

    it("rejects an unbound input block and names it", () => {
        expect(() =>
            validateMultiWorkflowRunInput(
                [
                    {
                        ...input,
                        label: "Unbound audio",
                        nodeConfig: { type: "input", modality: "audio" },
                    },
                ],
                "dataset-1",
                "audio",
            ),
        ).toThrow(
            'Workflow input "Unbound audio" must select a dataset before running.',
        );
    });

    it("rejects a selected dataset whose modality differs from the input block", () => {
        expect(() =>
            validateMultiWorkflowRunInput([input], "dataset-1", "text"),
        ).toThrow(
            'Workflow input "Image input" requires an image dataset, but the selected dataset is text.',
        );
    });
});

describe("nested workflow run ownership", () => {
    it("lists workflow run history within team and project scope", async () => {
        const db = dbWithRows([
            [
                {
                    id: "run-1",
                    workflowId: "workflow-a",
                    datasetId: "dataset-1",
                    datasetName: "Calls",
                    status: "completed",
                    runTarget: "dataset",
                    total: 2,
                    done: 2,
                    failed: 0,
                    createdAt: new Date("2026-07-12T00:00:00.000Z"),
                },
            ],
        ]);

        await expect(
            listWorkflowRunsPayload(db, "team-1", "project-1", "workflow-a"),
        ).resolves.toMatchObject([
            {
                id: "run-1",
                createdAt: "2026-07-12T00:00:00.000Z",
            },
        ]);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("r.workflow_id = $1"),
            ["workflow-a", "team-1", "project-1"],
        );
    });

    it("uses the workflow path ID when loading progress", async () => {
        const db = dbWithRows([[]]);
        await expect(
            workflowRunProgressPayload(
                db,
                "team-1",
                "project-1",
                "workflow-a",
                "run-b",
            ),
        ).rejects.toThrow("not found");
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("r.workflow_id=$2"),
            ["run-b", "workflow-a", "team-1", "project-1"],
        );
    });

    it("uses the workflow path ID when loading detail", async () => {
        const db = dbWithRows([[]]);
        await expect(
            workflowRunDetailPayload(
                db,
                "team-1",
                "project-1",
                "workflow-a",
                "run-b",
            ),
        ).rejects.toThrow("not found");
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("workflow_id=$2"),
            ["run-b", "workflow-a", "team-1", "project-1"],
        );
    });

    it("serializes historical workflow runs without STT rows as empty results", async () => {
        const db = dbWithRows([
            [
                {
                    id: "run-1",
                    teamId: "team-1",
                    projectId: "project-1",
                    workflowId: "workflow-a",
                    datasetId: "dataset-1",
                    status: "completed",
                    workflowSnapshot: { nodes: [], edges: [] },
                    runTarget: "dataset",
                    createdAt: new Date("2026-07-12T00:00:00.000Z"),
                },
            ],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [
                {
                    status: "completed",
                    total: 0,
                    done: 0,
                    failed: 0,
                    pending: 0,
                },
            ],
        ]);

        await expect(
            workflowRunDetailPayload(
                db,
                "team-1",
                "project-1",
                "workflow-a",
                "run-1",
            ),
        ).resolves.toMatchObject({
            sttItems: [],
            sttScoresByItem: {},
            sttAggregates: [],
        });
    });
});
