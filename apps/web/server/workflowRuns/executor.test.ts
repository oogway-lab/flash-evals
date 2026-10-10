import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    cells: [] as Array<Record<string, any>>,
    executeCell: vi.fn(),
    getOrCreateAudioTranscriptArtifact: vi.fn(),
    getOrCreateTransliteration: vi.fn(),
    runTranscriptEvaluator: vi.fn(),
    scoreWorkflowCell: vi.fn(),
    scoreWorkflowTranscript: vi.fn(),
    updatePayloads: [] as Array<Record<string, unknown>>,
    items: [] as Array<Record<string, any>>,
    snapshot: undefined as any,
    runItems: [] as Array<Record<string, any>>,
    scoreRows: [] as Array<Record<string, any>>,
    labelsByItemId: new Map<string, Record<string, unknown>>(),
    loadImage: vi.fn(),
}));

function withResolvedExecutions(snapshot: any) {
    return {
        ...snapshot,
        nodes: snapshot.nodes.map((node: any) => {
            const nodeType = node.nodeType ?? "prompt";
            if (
                !["prompt", "llm_text", "transliterate", "judge"].includes(
                    nodeType,
                ) ||
                node.resolvedLlmExecution
            )
                return node;
            const modelId =
                node.modelId ??
                node.nodeConfig?.transliteration?.modelId ??
                "model";
            return {
                ...node,
                resolvedLlmExecution: {
                    contractVersion: 1,
                    requestedSelection: {
                        mode: "pinned_route",
                        routeVersionId: `route-${node.nodeKey}`,
                    },
                    routeId: `route-${node.nodeKey}`,
                    routeVersionId: `route-${node.nodeKey}`,
                    routeVersion: 1,
                    route: {
                        modelId,
                        transportConfig: { transport: "openai" },
                        generation: { maxOutputTokens: 4096 },
                        structuredOutput: { mode: "text" },
                        retry: {
                            owner: "mosaic",
                            maxAttempts: 1,
                            timeoutMs: 30_000,
                            retryableErrorClasses: [],
                        },
                        cache: {
                            mosaicReuse: "force_fresh",
                            providerCaching: "allow",
                        },
                    },
                    credential: {
                        providerKeyId: "key-1",
                        rotationVersion: "rotation-1",
                    },
                    capability: {
                        capabilityVersionId: "cap-1",
                        capabilityDigest: "sha256:cap",
                        capturedAt: "2026-07-25T00:00:00.000Z",
                        stale: false,
                        transport: {
                            transport: "openai",
                            transportModelId: modelId,
                            upstreamRoutingModes: ["none"],
                            supportedGenerationControls: ["maxOutputTokens"],
                            supportsStructuredOutput: true,
                            requiresCurrentDiscovery: false,
                        },
                    },
                },
            };
        }),
    };
}

function findCellId(
    value: unknown,
    seen = new WeakSet<object>(),
): string | undefined {
    if (typeof value === "string" && value.startsWith("cell-")) return value;
    if (!value || typeof value !== "object" || seen.has(value))
        return undefined;
    seen.add(value);
    for (const child of Object.values(value)) {
        const found = findCellId(child, seen);
        if (found) return found;
    }
    return undefined;
}

function tableName(table: object): string | undefined {
    const symbol = Object.getOwnPropertySymbols(table).find(
        (candidate) => candidate.toString() === "Symbol(drizzle:Name)",
    );
    return symbol ? (table as Record<symbol, string>)[symbol] : undefined;
}

function query<T>(rows: T[]) {
    const value = {
        where: vi.fn(() => query(rows)),
        limit: vi.fn(async () => rows.slice(0, 1)),
        then: (resolve: (value: T[]) => unknown) =>
            Promise.resolve(rows).then(resolve),
    };
    return value;
}

vi.mock("../db/client", () => ({
    db: {
        select: vi.fn((selection?: Record<string, unknown>) => ({
            from: vi.fn((table: object) => {
                const name = tableName(table);
                if (name === "workflow_runs")
                    return query([
                        {
                            id: "run-1",
                            teamId: "team-1",
                            projectId: "project-1",
                            status: "pending",
                            workflowSnapshot: withResolvedExecutions(
                                mocks.snapshot,
                            ),
                        },
                    ]);
                if (name === "workflow_run_cells") {
                    if (selection?.total) {
                        const failed = mocks.cells.filter(
                            (cell) => cell.status === "failed",
                        ).length;
                        const done = mocks.cells.filter(
                            (cell) =>
                                cell.status === "succeeded" ||
                                cell.status === "cached",
                        ).length;
                        return query([
                            { total: mocks.cells.length, failed, done },
                        ]);
                    }
                    return query(mocks.cells);
                }
                if (name === "dataset_items") return query(mocks.items);
                if (name === "workflow_run_items") {
                    if (selection?.active)
                        return query([
                            {
                                active: mocks.runItems.filter(
                                    (item) =>
                                        item.preparationStatus === "pending" ||
                                        item.preparationStatus === "running" ||
                                        item.evaluationStatus === "pending" ||
                                        item.evaluationStatus === "running",
                                ).length,
                            },
                        ]);
                    return query(mocks.runItems);
                }
                if (name === "labels")
                    return query(
                        [...mocks.labelsByItemId].map(
                            ([datasetItemId, labelJson]) => ({
                                datasetItemId,
                                labelJson,
                            }),
                        ),
                    );
                return query([]);
            }),
        })),
        update: vi.fn((table: object) => ({
            set: vi.fn((payload: Record<string, unknown>) => {
                mocks.updatePayloads.push(payload);
                return {
                    where: vi.fn((condition: unknown) => {
                        const targetId = findCellId(condition);
                        return {
                            returning: vi.fn(async () => {
                                if (tableName(table) === "workflow_run_items") {
                                    const row = mocks.runItems[0];
                                    if (!row) return [];
                                    Object.assign(row, payload);
                                    return [{ id: row.id }];
                                }
                                if (tableName(table) !== "workflow_run_cells")
                                    return [];
                                const cell = mocks.cells.find(
                                    (candidate) => candidate.id === targetId,
                                );
                                if (!cell || cell.status !== "pending")
                                    return [];
                                Object.assign(cell, payload);
                                return [{ id: cell.id }];
                            }),
                            then: (resolve: (value: undefined) => unknown) => {
                                if (
                                    tableName(table) === "workflow_run_items" &&
                                    mocks.runItems[0]
                                ) {
                                    Object.assign(mocks.runItems[0], payload);
                                }
                                if (
                                    tableName(table) === "workflow_run_cells" &&
                                    targetId
                                ) {
                                    const cell = mocks.cells.find(
                                        (candidate) =>
                                            candidate.id === targetId,
                                    );
                                    if (cell) Object.assign(cell, payload);
                                }
                                return Promise.resolve(undefined).then(resolve);
                            },
                        };
                    }),
                };
            }),
        })),
        insert: vi.fn((table: object) => ({
            values: vi.fn((payload: Record<string, unknown>) => {
                if (tableName(table) === "workflow_cell_scores")
                    mocks.scoreRows.push(payload);
                return {
                    onConflictDoNothing: vi.fn(async () => {
                        if (
                            tableName(table) === "workflow_run_items" &&
                            mocks.runItems.length === 0
                        )
                            mocks.runItems.push({
                                id: "workflow-item-1",
                                preparationStatus: "pending",
                                evaluationStatus: "pending",
                                segmentsJson: [],
                                speakersJson: [],
                                warnings: [],
                                ...payload,
                            });
                    }),
                };
            }),
        })),
    },
}));

vi.mock("../jobs/runOrchestrator", () => ({ executeCell: mocks.executeCell }));
vi.mock("./llmInvocation", () => ({
    executeWorkflowLlmInvocation: vi.fn(async (input: any) => {
        const result = await mocks.executeCell(
            input.execution.route.modelId,
            {
                prompt: input.prompt,
                images: input.images,
                maxTokens: input.execution.route.generation.maxOutputTokens,
                reasoningEffort:
                    input.execution.route.generation.reasoningEffort,
            },
            {},
            {},
        );
        return {
            artifact: {
                text: result.outputText,
                ...(result.parsed ? { json: result.parsed } : {}),
            },
            latencyMs: result.latencyMs,
            costUsd: result.costUsd,
        };
    }),
}));
vi.mock("../images/source", () => ({ loadImage: mocks.loadImage }));
vi.mock("../audio/transcription", () => ({
    getOrCreateAudioTranscriptArtifactWithProvenance:
        mocks.getOrCreateAudioTranscriptArtifact,
}));
vi.mock("../audio/transliteration", () => ({
    getOrCreateTransliteration: mocks.getOrCreateTransliteration,
}));
vi.mock("../audio/customEvaluators", () => ({
    runTranscriptEvaluator: mocks.runTranscriptEvaluator,
}));
vi.mock("../llm/pricing", () => ({
    resolvePricingFor: vi.fn(async () => ({})),
    pricingFor: vi.fn(() => ({})),
}));
vi.mock("../secrets/resolveApiKeys", () => ({
    resolveApiKeys: vi.fn(async () => ({
        apiKeys: {},
        sttProviderKeys: {
            openai: "openai-key",
            vercelGateway: "gateway-key",
            soniox: "soniox-key",
        },
    })),
}));
vi.mock("./scoring", () => ({
    loadWorkflowScoringContext: vi.fn(async () => ({
        labelsByItemId: mocks.labelsByItemId,
        judgePromptsByNodeKey: new Map(),
    })),
    scoreWorkflowCell: mocks.scoreWorkflowCell,
    scoreWorkflowTranscriptItem: mocks.scoreWorkflowTranscript,
}));

import {
    executeWorkflowRun,
    supportsWorkflowLlmExecutionContract,
} from "./executor";
import { loadWorkflowScoringContext } from "./scoring";

describe("executeWorkflowRun", () => {
    it("rejects a snapshot from an unsupported LLM execution contract", () => {
        expect(
            supportsWorkflowLlmExecutionContract({
                workflowId: "workflow-1",
                name: "Future",
                nodes: [
                    {
                        id: "node-1",
                        nodeKey: "prompt-1",
                        label: "Prompt",
                        modelId: "model",
                        evalConfig: { type: "none" },
                        resolvedLlmExecution: {
                            contractVersion: 2,
                        } as never,
                    },
                ],
                edges: [],
            }),
        ).toBe(false);
    });

    beforeEach(() => {
        mocks.snapshot = {
            workflowId: "workflow-1",
            name: "Chain",
            nodes: ["a", "b", "c"].map((nodeKey) => ({
                id: `node-${nodeKey}`,
                nodeKey,
                label: nodeKey.toUpperCase(),
                promptVersionId: `pv-${nodeKey}`,
                promptContent: `prompt-${nodeKey}`,
                modelId: "model",
                evalConfig: { type: "none" },
            })),
            edges: [
                {
                    id: "ab",
                    fromNodeId: "node-a",
                    toNodeId: "node-b",
                    carryOriginalInput: false,
                },
                {
                    id: "bc",
                    fromNodeId: "node-b",
                    toNodeId: "node-c",
                    carryOriginalInput: false,
                },
            ],
        };
        mocks.cells = ["a", "b", "c"].map((nodeKey) => ({
            id: `cell-${nodeKey}`,
            datasetItemId: "item-1",
            nodeKey,
            status: "pending",
        }));
        mocks.items = [
            {
                id: "item-1",
                inputText: "original",
                storageKey: null,
            },
        ];
        mocks.executeCell.mockReset();
        mocks.getOrCreateAudioTranscriptArtifact.mockReset();
        mocks.getOrCreateTransliteration.mockReset();
        mocks.runTranscriptEvaluator.mockReset();
        mocks.scoreWorkflowCell.mockReset();
        mocks.scoreWorkflowTranscript.mockReset();
        mocks.loadImage.mockReset();
        mocks.runItems = [];
        mocks.scoreRows = [];
        mocks.labelsByItemId = new Map();
        mocks.updatePayloads.length = 0;
    });

    it("transcribes an audio item once and reuses the transcript across workflow nodes", async () => {
        mocks.snapshot = {
            ...mocks.snapshot,
            sttConfig: {
                modelId: "gpt-4o-mini-transcribe",
                transcriptVariant: "latin",
                transliteration: {
                    enabled: true,
                    modelId: "gpt-4o-mini",
                    targetLanguage: "Latin",
                },
                evaluator: {
                    enabled: true,
                    modelId: "gpt-4o-mini",
                    rubricPrompt: "Score transcription accuracy.",
                },
            },
        };
        mocks.items = [
            {
                id: "item-1",
                type: "audio",
                inputText: null,
                storageKey: "audio-key",
                mimeType: "audio/wav",
            },
        ];
        mocks.getOrCreateAudioTranscriptArtifact.mockResolvedValue({
            artifact: {
                text: "Speaker 1: workflow audio transcript",
                segments: [],
                speakers: [],
                warnings: [],
            },
            cacheHit: false,
            lookupLatencyMs: 1,
        });
        mocks.getOrCreateTransliteration.mockResolvedValue(
            "Speaker 1: latin workflow transcript",
        );
        mocks.executeCell.mockResolvedValue({
            outputText: "node output",
            latencyMs: 1,
            costUsd: 0,
        });

        await executeWorkflowRun("run-1");

        expect(mocks.getOrCreateAudioTranscriptArtifact).toHaveBeenCalledTimes(
            1,
        );
        expect(mocks.getOrCreateAudioTranscriptArtifact).toHaveBeenCalledWith(
            expect.objectContaining({
                datasetItemId: "item-1",
                storageKey: "audio-key",
                mimeType: "audio/wav",
                modelId: "gpt-4o-mini-transcribe",
                openaiApiKey: "openai-key",
            }),
        );
        expect(mocks.getOrCreateTransliteration).toHaveBeenCalledTimes(1);
        expect(mocks.scoreWorkflowTranscript).toHaveBeenCalledTimes(1);
        expect(mocks.scoreWorkflowTranscript).toHaveBeenCalledWith(
            expect.objectContaining({
                ownership: expect.objectContaining({
                    workflowRunItemId: "workflow-item-1",
                }),
                candidate: expect.objectContaining({
                    itemId: "item-1",
                    transcript: "Speaker 1: latin workflow transcript",
                }),
                evaluator: expect.objectContaining({ enabled: true }),
            }),
        );
        expect(mocks.executeCell).toHaveBeenCalledWith(
            "model",
            expect.objectContaining({
                prompt: expect.stringContaining(
                    "Speaker 1: latin workflow transcript",
                ),
            }),
            expect.anything(),
            expect.anything(),
        );
    });

    it("executes a diamond by layers and assembles labeled merge input once", async () => {
        mocks.snapshot = {
            ...mocks.snapshot,
            name: "Diamond",
            nodes: ["a", "b", "c", "d"].map((nodeKey) => ({
                id: `node-${nodeKey}`,
                nodeKey,
                label: nodeKey.toUpperCase(),
                promptVersionId: `pv-${nodeKey}`,
                promptContent: `prompt-${nodeKey}`,
                modelId: "model",
                evalConfig: { type: "none" },
            })),
            edges: [
                {
                    id: "ab",
                    fromNodeId: "node-a",
                    toNodeId: "node-b",
                    carryOriginalInput: false,
                },
                {
                    id: "ac",
                    fromNodeId: "node-a",
                    toNodeId: "node-c",
                    carryOriginalInput: false,
                },
                {
                    id: "bd",
                    fromNodeId: "node-b",
                    toNodeId: "node-d",
                    carryOriginalInput: true,
                },
                {
                    id: "cd",
                    fromNodeId: "node-c",
                    toNodeId: "node-d",
                    carryOriginalInput: true,
                },
            ],
        };
        mocks.cells = ["a", "b", "c", "d"].map((nodeKey) => ({
            id: `cell-${nodeKey}`,
            datasetItemId: "item-1",
            nodeKey,
            status: "pending",
        }));
        mocks.executeCell.mockImplementation(async (_model, request) => ({
            outputText: `out-${String(request.prompt).slice(7, 8)}`,
            latencyMs: 1,
            costUsd: 0,
        }));

        await executeWorkflowRun("run-1");

        expect(mocks.executeCell).toHaveBeenCalledTimes(4);
        expect(mocks.executeCell.mock.calls[3]?.[1].prompt).toBe(
            'prompt-d\n\n<from node="B">out-b</from>\n<from node="C">out-c</from>\n<original_input>original</original_input>',
        );
        expect(mocks.cells.every((cell) => cell.status === "succeeded")).toBe(
            true,
        );
    });

    it("executes A -> B -> C with each output feeding the next node", async () => {
        mocks.executeCell
            .mockResolvedValueOnce({
                outputText: "out-a",
                latencyMs: 1,
                costUsd: 0,
            })
            .mockResolvedValueOnce({
                outputText: "out-b",
                latencyMs: 1,
                costUsd: 0,
            })
            .mockResolvedValueOnce({
                outputText: "out-c",
                latencyMs: 1,
                costUsd: 0,
            });

        await executeWorkflowRun("run-1");

        expect(
            mocks.executeCell.mock.calls.map((call) => call[1].prompt),
        ).toEqual([
            "prompt-a\n\n<input>original</input>",
            "prompt-b\n\nout-a",
            "prompt-c\n\nout-b",
        ]);
        expect(mocks.cells.map((cell) => cell.status)).toEqual([
            "succeeded",
            "succeeded",
            "succeeded",
        ]);
        expect(mocks.updatePayloads).toContainEqual(
            expect.objectContaining({ status: "completed" }),
        );
    });

    it("keeps executing when record-only scoring fails", async () => {
        mocks.executeCell.mockResolvedValue({
            outputText: "output",
            latencyMs: 1,
            costUsd: 0,
        });
        mocks.scoreWorkflowCell.mockRejectedValue(
            new Error("judge unavailable"),
        );
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);

        await executeWorkflowRun("run-1");

        expect(mocks.executeCell).toHaveBeenCalledTimes(3);
        expect(mocks.cells.every((cell) => cell.status === "succeeded")).toBe(
            true,
        );
        expect(consoleError).toHaveBeenCalledTimes(3);
        for (const [line] of consoleError.mock.calls) {
            const payload = JSON.parse(String(line)) as Record<string, unknown>;
            expect(payload).toMatchObject({
                service: "mosaic-worker",
                event: "workflow_cell.scoring_failed",
                errorName: "Error",
            });
            expect(payload).not.toHaveProperty("message");
            expect(String(line)).not.toContain("judge unavailable");
        }
        consoleError.mockRestore();
    });

    it("terminalizes the run and continues unaffected items after transcription fails", async () => {
        mocks.snapshot = {
            ...mocks.snapshot,
            nodes: [mocks.snapshot.nodes[0]],
            edges: [],
            sttConfig: { modelId: "gpt-4o-mini-transcribe" },
        };
        mocks.items = [
            {
                id: "audio-item",
                type: "audio",
                inputText: null,
                storageKey: "audio-key",
                mimeType: "audio/wav",
            },
            {
                id: "text-item",
                type: "text",
                inputText: "continue me",
                storageKey: null,
                mimeType: null,
            },
        ];
        mocks.cells = mocks.items.map((item) => ({
            id: `cell-${item.id}`,
            datasetItemId: item.id,
            nodeKey: "a",
            status: "pending",
        }));
        mocks.getOrCreateAudioTranscriptArtifact.mockRejectedValue(
            new Error("transcription unavailable"),
        );
        mocks.executeCell.mockResolvedValue({
            outputText: "text output",
            latencyMs: 1,
            costUsd: 0,
        });

        await executeWorkflowRun("run-1");

        expect(mocks.cells.map((cell) => cell.status)).toEqual([
            "failed",
            "succeeded",
        ]);
        expect(mocks.executeCell).toHaveBeenCalledTimes(1);
        expect(mocks.runItems[0]).toEqual(
            expect.objectContaining({
                preparationStatus: "error",
                evaluationStatus: "skipped",
            }),
        );
        expect(mocks.updatePayloads).toContainEqual(
            expect.objectContaining({ status: "partial" }),
        );
    });

    it("uses the exact v1 carry format for a node with one parent", async () => {
        mocks.snapshot.edges[0].carryOriginalInput = true;
        mocks.executeCell.mockResolvedValue({
            outputText: "draft",
            latencyMs: 1,
            costUsd: 0,
        });

        await executeWorkflowRun("run-1");

        expect(mocks.executeCell.mock.calls[1]?.[1].prompt).toBe(
            "prompt-b\n\n<upstream_output>draft</upstream_output>\n<original_input>original</original_input>",
        );
    });

    it("allows two executors to race without claiming descendants early", async () => {
        let releaseRoot!: () => void;
        const rootBlocked = new Promise<void>((resolve) => {
            releaseRoot = resolve;
        });
        mocks.executeCell.mockImplementation(async (_model, request) => {
            if (String(request.prompt).startsWith("prompt-a"))
                await rootBlocked;
            return { outputText: "output", latencyMs: 1, costUsd: 0 };
        });

        const first = executeWorkflowRun("run-1");
        await vi.waitFor(() => expect(mocks.cells[0]?.status).toBe("running"));
        const second = executeWorkflowRun("run-1");
        await vi.waitFor(() =>
            expect(mocks.executeCell).toHaveBeenCalledTimes(1),
        );
        expect(mocks.cells.slice(1).map((cell) => cell.status)).toEqual([
            "pending",
            "pending",
        ]);

        releaseRoot();
        await Promise.all([first, second]);

        expect(mocks.executeCell).toHaveBeenCalledTimes(3);
        expect(mocks.cells.every((cell) => cell.status === "succeeded")).toBe(
            true,
        );
    });

    it("uses one run-wide concurrency limit across items and nodes", async () => {
        mocks.snapshot = {
            ...mocks.snapshot,
            nodes: ["a", "b"].map((nodeKey) => ({
                id: `node-${nodeKey}`,
                nodeKey,
                label: nodeKey.toUpperCase(),
                promptVersionId: `pv-${nodeKey}`,
                promptContent: `prompt-${nodeKey}`,
                modelId: "model",
                evalConfig: { type: "none" },
            })),
            edges: [
                {
                    id: "ab",
                    fromNodeId: "node-a",
                    toNodeId: "node-b",
                    carryOriginalInput: false,
                },
            ],
        };
        mocks.items = Array.from({ length: 6 }, (_, index) => ({
            id: `item-${index + 1}`,
            inputText: `input-${index + 1}`,
            storageKey: null,
        }));
        mocks.cells = mocks.items.flatMap((item) =>
            ["a", "b"].map((nodeKey) => ({
                id: `cell-${item.id}-${nodeKey}`,
                datasetItemId: item.id,
                nodeKey,
                status: "pending",
            })),
        );
        let active = 0;
        let maxActive = 0;
        mocks.executeCell.mockImplementation(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active -= 1;
            return { outputText: "output", latencyMs: 1, costUsd: 0 };
        });

        await executeWorkflowRun("run-1");

        expect(mocks.executeCell).toHaveBeenCalledTimes(12);
        expect(maxActive).toBeLessThanOrEqual(4);
    });

    it("terminalizes later cells when a middle prompt fails", async () => {
        mocks.executeCell
            .mockResolvedValueOnce({
                outputText: "out-a",
                latencyMs: 1,
                costUsd: 0,
            })
            .mockRejectedValueOnce(new Error("provider failed"));

        await executeWorkflowRun("run-1");

        expect(mocks.executeCell).toHaveBeenCalledTimes(2);
        expect(mocks.cells.map((cell) => cell.status)).toEqual([
            "succeeded",
            "failed",
            "failed",
        ]);
        expect(mocks.updatePayloads).toContainEqual(
            expect.objectContaining({ status: "partial" }),
        );
    });

    it("fails a diamond merge when either authoritative parent fails", async () => {
        mocks.snapshot = {
            ...mocks.snapshot,
            nodes: ["a", "b", "c", "d"].map((nodeKey) => ({
                id: `node-${nodeKey}`,
                nodeKey,
                label: nodeKey.toUpperCase(),
                promptVersionId: `pv-${nodeKey}`,
                promptContent: `prompt-${nodeKey}`,
                modelId: "model",
                evalConfig: { type: "none" },
            })),
            edges: [
                {
                    id: "ab",
                    fromNodeId: "node-a",
                    toNodeId: "node-b",
                    carryOriginalInput: false,
                },
                {
                    id: "ac",
                    fromNodeId: "node-a",
                    toNodeId: "node-c",
                    carryOriginalInput: false,
                },
                {
                    id: "bd",
                    fromNodeId: "node-b",
                    toNodeId: "node-d",
                    carryOriginalInput: false,
                },
                {
                    id: "cd",
                    fromNodeId: "node-c",
                    toNodeId: "node-d",
                    carryOriginalInput: false,
                },
            ],
        };
        mocks.cells = ["a", "b", "c", "d"].map((nodeKey) => ({
            id: `cell-${nodeKey}`,
            datasetItemId: "item-1",
            nodeKey,
            status: "pending",
        }));
        mocks.executeCell.mockImplementation(async (_model, request) => {
            if (String(request.prompt).startsWith("prompt-b"))
                throw new Error("branch failed");
            return { outputText: "output", latencyMs: 1, costUsd: 0 };
        });

        await executeWorkflowRun("run-1");

        expect(mocks.executeCell).toHaveBeenCalledTimes(3);
        expect(mocks.cells.map((cell) => cell.status)).toEqual([
            "succeeded",
            "failed",
            "succeeded",
            "failed",
        ]);
    });

    it("attaches a non-empty image only to model nodes directly downstream of an image input", async () => {
        mocks.snapshot = {
            workflowId: "workflow-1",
            name: "Image workflow",
            kind: "multi",
            nodes: [
                {
                    id: "node-input",
                    nodeKey: "input",
                    label: "Image input",
                    nodeType: "input",
                    nodeConfig: { type: "input", modality: "image" },
                    evalConfig: { type: "none" },
                },
                {
                    id: "node-prompt",
                    nodeKey: "prompt",
                    label: "Describe",
                    nodeType: "prompt",
                    nodeConfig: { type: "prompt" },
                    promptVersionId: "prompt-version-1",
                    promptContent: "Describe this image.",
                    modelId: "gpt-4o",
                    evalConfig: { type: "none" },
                },
                {
                    id: "node-direct-text",
                    nodeKey: "direct-text",
                    label: "Inspect",
                    nodeType: "llm_text",
                    nodeConfig: { type: "llm_text", promptText: "Inspect" },
                    modelId: "gpt-4o",
                    evalConfig: { type: "none" },
                },
                {
                    id: "node-indirect-text",
                    nodeKey: "indirect-text",
                    label: "Polish",
                    nodeType: "llm_text",
                    nodeConfig: { type: "llm_text", promptText: "Polish" },
                    modelId: "gpt-4o",
                    evalConfig: { type: "none" },
                },
                {
                    id: "node-judge",
                    nodeKey: "judge",
                    label: "Judge",
                    nodeType: "judge",
                    nodeConfig: { type: "judge", rubricPrompt: "Judge image" },
                    modelId: "gpt-4o",
                    evalConfig: { type: "none" },
                },
            ],
            edges: [
                {
                    id: "input-prompt",
                    fromNodeId: "node-input",
                    toNodeId: "node-prompt",
                    carryOriginalInput: false,
                },
                {
                    id: "input-direct-text",
                    fromNodeId: "node-input",
                    toNodeId: "node-direct-text",
                    carryOriginalInput: false,
                },
                {
                    id: "input-judge",
                    fromNodeId: "node-input",
                    toNodeId: "node-judge",
                    carryOriginalInput: false,
                },
                {
                    id: "prompt-text",
                    fromNodeId: "node-prompt",
                    toNodeId: "node-indirect-text",
                    carryOriginalInput: false,
                },
            ],
        };
        mocks.cells = [
            "input",
            "prompt",
            "direct-text",
            "indirect-text",
            "judge",
        ].map((nodeKey) => ({
            id: `cell-${nodeKey}`,
            datasetItemId: "item-1",
            nodeKey,
            status: "pending",
        }));
        mocks.items = [
            {
                id: "item-1",
                type: "image",
                inputText: null,
                storageKey: "image-key",
                mimeType: "image/png",
            },
        ];
        mocks.loadImage.mockResolvedValue({
            mimeType: "image/png",
            base64Data: "aW1hZ2UtYnl0ZXM=",
        });
        mocks.executeCell.mockResolvedValue({
            outputText: "model output",
            usage: {},
            latencyMs: 1,
            costUsd: 0,
        });
        mocks.runTranscriptEvaluator.mockResolvedValue({
            score: 1,
            rationale: "valid image",
            details: { metricKind: "llm_judge" },
        });

        await executeWorkflowRun("run-1");

        expect(mocks.loadImage).toHaveBeenCalledWith("image-key", "image/png");
        expect(mocks.executeCell).toHaveBeenCalledTimes(4);
        const requestFor = (prefix: string) =>
            mocks.executeCell.mock.calls.find((call) =>
                String(call[1].prompt).startsWith(prefix),
            )?.[1];
        expect(requestFor("Describe")?.images).toEqual([
            { mimeType: "image/png", base64Data: "aW1hZ2UtYnl0ZXM=" },
        ]);
        expect(requestFor("Inspect")?.images).not.toHaveLength(0);
        expect(requestFor("Polish")?.images).toEqual([]);
        expect(requestFor("Judge image")?.images).toEqual([
            {
                mimeType: "image/png",
                base64Data: "aW1hZ2UtYnl0ZXM=",
            },
        ]);
    });

    it("resolves text input and executes prompt and llm_text nodes in one multi graph", async () => {
        mocks.snapshot = {
            workflowId: "workflow-1",
            name: "Mixed text workflow",
            kind: "multi",
            nodes: [
                {
                    id: "node-input",
                    nodeKey: "input",
                    label: "Text input",
                    nodeType: "input",
                    nodeConfig: { type: "input", modality: "text" },
                    evalConfig: { type: "none" },
                },
                {
                    id: "node-prompt",
                    nodeKey: "prompt",
                    label: "Draft",
                    nodeType: "prompt",
                    nodeConfig: { type: "prompt" },
                    promptVersionId: "prompt-version-1",
                    promptContent: "Draft",
                    modelId: "gpt-4o",
                    evalConfig: { type: "none" },
                },
                {
                    id: "node-text",
                    nodeKey: "text",
                    label: "Edit",
                    nodeType: "llm_text",
                    nodeConfig: { type: "llm_text", promptText: "Edit" },
                    modelId: "gpt-4o",
                    evalConfig: { type: "none" },
                },
            ],
            edges: [
                {
                    id: "input-prompt",
                    fromNodeId: "node-input",
                    toNodeId: "node-prompt",
                    carryOriginalInput: false,
                },
                {
                    id: "prompt-text",
                    fromNodeId: "node-prompt",
                    toNodeId: "node-text",
                    carryOriginalInput: false,
                },
            ],
        };
        mocks.cells = ["input", "prompt", "text"].map((nodeKey) => ({
            id: `cell-${nodeKey}`,
            datasetItemId: "item-1",
            nodeKey,
            status: "pending",
        }));
        mocks.items = [
            {
                id: "item-1",
                type: "text",
                inputText: "the dataset item text",
                storageKey: null,
                mimeType: null,
            },
        ];
        mocks.executeCell
            .mockResolvedValueOnce({
                outputText: "draft output",
                latencyMs: 1,
                costUsd: 0,
            })
            .mockResolvedValueOnce({
                outputText: "edited output",
                usage: {},
                latencyMs: 1,
                costUsd: 0,
            });

        await executeWorkflowRun("run-1");

        expect(mocks.executeCell).toHaveBeenCalledTimes(2);
        expect(mocks.executeCell.mock.calls[0]?.[1].prompt).toBe(
            "Draft\n\nthe dataset item text",
        );
        expect(mocks.executeCell.mock.calls[1]?.[1].prompt).toBe(
            "Edit\n\ndraft output",
        );
        expect(mocks.cells[0]).toEqual(
            expect.objectContaining({
                status: "succeeded",
                outputJson: { text: "the dataset item text" },
            }),
        );
    });

    it("passes an audio input through the existing STT byte path in a multi graph", async () => {
        mocks.snapshot = {
            workflowId: "workflow-1",
            name: "Audio workflow",
            kind: "multi",
            nodes: [
                {
                    id: "node-input",
                    nodeKey: "input",
                    label: "Audio input",
                    nodeType: "input",
                    nodeConfig: { type: "input", modality: "audio" },
                    evalConfig: { type: "none" },
                },
                {
                    id: "node-stt",
                    nodeKey: "stt",
                    label: "Transcribe",
                    nodeType: "stt",
                    nodeConfig: {
                        type: "stt",
                        sttConfig: { modelId: "soniox:stt-async-v5" },
                    },
                    evalConfig: { type: "none" },
                },
            ],
            edges: [
                {
                    id: "input-stt",
                    fromNodeId: "node-input",
                    toNodeId: "node-stt",
                    carryOriginalInput: false,
                },
            ],
        };
        mocks.cells = ["input", "stt"].map((nodeKey) => ({
            id: `cell-${nodeKey}`,
            datasetItemId: "item-1",
            nodeKey,
            status: "pending",
        }));
        mocks.items = [
            {
                id: "item-1",
                type: "audio",
                inputText: null,
                storageKey: "audio-key",
                mimeType: "audio/wav",
            },
        ];
        mocks.getOrCreateAudioTranscriptArtifact.mockResolvedValue({
            artifact: { text: "unchanged transcript", segments: [] },
        });

        await executeWorkflowRun("run-1");

        expect(mocks.getOrCreateAudioTranscriptArtifact).toHaveBeenCalledTimes(
            1,
        );
        expect(mocks.getOrCreateAudioTranscriptArtifact).toHaveBeenCalledWith(
            expect.objectContaining({
                datasetItemId: "item-1",
                storageKey: "audio-key",
                mimeType: "audio/wav",
                modelId: "soniox:stt-async-v5",
            }),
        );
        expect(mocks.cells[1]).toEqual(
            expect.objectContaining({
                status: "succeeded",
                outputJson: expect.objectContaining({
                    text: "unchanged transcript",
                }),
            }),
        );
    });

    it("executes disconnected input-rooted branches in a multi graph", async () => {
        mocks.snapshot = {
            workflowId: "workflow-1",
            name: "Disconnected multi workflow",
            kind: "multi",
            nodes: [
                {
                    id: "node-input-a",
                    nodeKey: "input-a",
                    label: "Input A",
                    nodeType: "input",
                    nodeConfig: { type: "input", modality: "text" },
                    evalConfig: { type: "none" },
                },
                {
                    id: "node-prompt-a",
                    nodeKey: "prompt-a",
                    label: "Prompt A",
                    nodeType: "prompt",
                    nodeConfig: { type: "prompt" },
                    promptContent: "Prompt A",
                    modelId: "gpt-4o",
                    evalConfig: { type: "none" },
                },
                {
                    id: "node-input-b",
                    nodeKey: "input-b",
                    label: "Input B",
                    nodeType: "input",
                    nodeConfig: { type: "input", modality: "text" },
                    evalConfig: { type: "none" },
                },
                {
                    id: "node-text-b",
                    nodeKey: "text-b",
                    label: "Text B",
                    nodeType: "llm_text",
                    nodeConfig: { type: "llm_text", promptText: "Text B" },
                    modelId: "gpt-4o",
                    evalConfig: { type: "none" },
                },
            ],
            edges: [
                {
                    id: "branch-a",
                    fromNodeId: "node-input-a",
                    toNodeId: "node-prompt-a",
                    carryOriginalInput: false,
                },
                {
                    id: "branch-b",
                    fromNodeId: "node-input-b",
                    toNodeId: "node-text-b",
                    carryOriginalInput: false,
                },
            ],
        };
        mocks.cells = ["input-a", "prompt-a", "input-b", "text-b"].map(
            (nodeKey) => ({
                id: `cell-${nodeKey}`,
                datasetItemId: "item-1",
                nodeKey,
                status: "pending",
            }),
        );
        mocks.executeCell.mockResolvedValue({
            outputText: "output",
            usage: {},
            latencyMs: 1,
            costUsd: 0,
        });

        await executeWorkflowRun("run-1");

        expect(mocks.executeCell).toHaveBeenCalledTimes(2);
        expect(mocks.cells.every((cell) => cell.status === "succeeded")).toBe(
            true,
        );
    });

    it("executes same-model STT roots with distinct configs and downstream text", async () => {
        mocks.snapshot = {
            workflowId: "workflow-1",
            name: "STT branches",
            kind: "stt",
            nodes: [
                {
                    id: "node-stt-a",
                    nodeKey: "stt-a",
                    label: "Diarized",
                    nodeType: "stt",
                    nodeConfig: {
                        type: "stt",
                        sttConfig: {
                            modelId: "soniox:stt-rt-v4",
                            config: { enableSpeakerDiarization: true },
                        },
                    },
                    evalConfig: { type: "none" },
                },
                {
                    id: "node-text-a",
                    nodeKey: "text-a",
                    label: "Clean A",
                    nodeType: "llm_text",
                    nodeConfig: { type: "llm_text", promptText: "Clean" },
                    modelId: "gpt-5",
                    evalConfig: { type: "none" },
                },
                {
                    id: "node-stt-b",
                    nodeKey: "stt-b",
                    label: "Plain",
                    nodeType: "stt",
                    nodeConfig: {
                        type: "stt",
                        sttConfig: {
                            modelId: "soniox:stt-rt-v4",
                            config: { enableSpeakerDiarization: false },
                        },
                    },
                    evalConfig: { type: "none" },
                },
                {
                    id: "node-text-b",
                    nodeKey: "text-b",
                    label: "Clean B",
                    nodeType: "llm_text",
                    nodeConfig: { type: "llm_text", promptText: "Clean" },
                    modelId: "gpt-5",
                    evalConfig: { type: "none" },
                },
            ],
            edges: [
                {
                    id: "a",
                    fromNodeId: "node-stt-a",
                    toNodeId: "node-text-a",
                    carryOriginalInput: false,
                },
                {
                    id: "b",
                    fromNodeId: "node-stt-b",
                    toNodeId: "node-text-b",
                    carryOriginalInput: false,
                },
            ],
        };
        mocks.cells = ["stt-a", "text-a", "stt-b", "text-b"].map((nodeKey) => ({
            id: `cell-${nodeKey}`,
            datasetItemId: "item-1",
            nodeKey,
            status: "pending",
        }));
        mocks.items = [
            {
                id: "item-1",
                type: "audio",
                storageKey: "audio-key",
                mimeType: "audio/wav",
            },
        ];
        mocks.getOrCreateAudioTranscriptArtifact.mockImplementation(
            async (input) => ({
                artifact: {
                    text: input.config.enableSpeakerDiarization
                        ? "speaker transcript"
                        : "plain transcript",
                    segments: [],
                    warnings: [],
                },
                cacheHit: false,
                lookupLatencyMs: 1,
            }),
        );
        mocks.executeCell.mockResolvedValue({
            outputText: "cleaned",
            usage: {},
            latencyMs: 1,
        });

        await executeWorkflowRun("run-1");

        expect(mocks.getOrCreateAudioTranscriptArtifact).toHaveBeenCalledTimes(
            2,
        );
        expect(
            mocks.getOrCreateAudioTranscriptArtifact.mock.calls.map(
                (call) => call[0].config.enableSpeakerDiarization,
            ),
        ).toEqual([true, false]);
        expect(
            mocks.executeCell.mock.calls.map((call) => call[1].prompt),
        ).toEqual(["Clean\n\nspeaker transcript", "Clean\n\nplain transcript"]);
    });

    it.each([
        { modality: "image", hasLabel: true },
        { modality: "image", hasLabel: false },
        { modality: "text", hasLabel: true },
        { modality: "text", hasLabel: false },
    ] as const)(
        "loads metric references for $modality workflows (label present: $hasLabel)",
        async ({ modality, hasLabel }) => {
            const actualScoring = await vi.importActual<{
                loadWorkflowScoringContext: typeof loadWorkflowScoringContext;
            }>("./scoring");
            vi.mocked(loadWorkflowScoringContext).mockImplementationOnce(
                actualScoring.loadWorkflowScoringContext,
            );
            const candidate =
                modality === "image"
                    ? "[Image input: image/png]"
                    : "synthetic text";
            mocks.snapshot = {
                workflowId: "workflow-1",
                name: "Keyless metric workflow",
                kind: "multi",
                nodes: [
                    {
                        id: "node-input",
                        nodeKey: "input",
                        label: "Input",
                        nodeType: "input",
                        nodeConfig: { type: "input", modality },
                        evalConfig: { type: "none" },
                    },
                    {
                        id: "node-metric",
                        nodeKey: "metric",
                        label: "Metric",
                        nodeType: "metric_compare",
                        nodeConfig: {
                            type: "metric_compare",
                            referenceField: "expectedTranscript",
                        },
                        evalConfig: { type: "none" },
                    },
                ],
                edges: [
                    {
                        id: "edge-1",
                        fromNodeId: "node-input",
                        toNodeId: "node-metric",
                        carryOriginalInput: false,
                    },
                ],
            };
            mocks.cells = ["input", "metric"].map((nodeKey) => ({
                id: `cell-${nodeKey}`,
                datasetItemId: "item-1",
                nodeKey,
                status: "pending",
            }));
            mocks.items = [
                {
                    id: "item-1",
                    type: modality,
                    inputText: candidate,
                    ...(modality === "image"
                        ? {
                              storageKey: "synthetic-image",
                              mimeType: "image/png",
                          }
                        : {}),
                },
            ];
            mocks.loadImage.mockResolvedValue({
                mimeType: "image/png",
                base64: "c3ludGhldGlj",
            });
            if (hasLabel)
                mocks.labelsByItemId.set("item-1", {
                    expectedTranscript: candidate,
                });

            await executeWorkflowRun("run-1");

            expect(mocks.cells.map((cell) => cell.status)).toEqual([
                "succeeded",
                "succeeded",
            ]);
            expect(mocks.cells[1].inputText).toBe(candidate);
            expect(mocks.scoreRows).toEqual([
                expect.objectContaining({
                    workflowRunCellId: "cell-metric",
                    scorerType: "transcript_metric",
                    score: hasLabel ? 1 : null,
                    detailsJson: expect.objectContaining(
                        hasLabel
                            ? {
                                  referenceField: "expectedTranscript",
                                  wer: 0,
                                  cer: 0,
                              }
                            : {
                                  referenceField: "expectedTranscript",
                                  reason: "missing_reference",
                              },
                    ),
                }),
            ]);
            expect(mocks.cells[1].outputJson.text).toBe(hasLabel ? "1" : "");
            expect(mocks.executeCell).not.toHaveBeenCalled();
            expect(
                mocks.getOrCreateAudioTranscriptArtifact,
            ).not.toHaveBeenCalled();
        },
    );

    it("scores expectedTranscriptLatin from an upstream text node", async () => {
        mocks.snapshot = metricWorkflowSnapshot();
        mocks.cells = ["stt", "text", "metric"].map((nodeKey) => ({
            id: `cell-${nodeKey}`,
            datasetItemId: "item-1",
            nodeKey,
            status: "pending",
        }));
        mocks.items = [
            {
                id: "item-1",
                type: "audio",
                storageKey: "audio-key",
                mimeType: "audio/wav",
            },
        ];
        mocks.labelsByItemId.set("item-1", {
            expectedTranscriptLatin: "namaste",
        });
        mocks.getOrCreateAudioTranscriptArtifact.mockResolvedValue({
            artifact: { text: "नमस्ते", segments: [], warnings: [] },
            cacheHit: false,
            lookupLatencyMs: 1,
        });
        mocks.executeCell.mockResolvedValue({
            outputText: "namaste",
            usage: {},
            latencyMs: 1,
        });

        await executeWorkflowRun("run-1");

        expect(mocks.cells.find((cell) => cell.nodeKey === "metric")).toEqual(
            expect.objectContaining({
                status: "succeeded",
                inputText: "namaste",
            }),
        );
        expect(mocks.scoreRows).toContainEqual(
            expect.objectContaining({
                workflowRunCellId: "cell-metric",
                scorerType: "transcript_metric",
                score: 1,
                detailsJson: expect.objectContaining({
                    referenceField: "expectedTranscriptLatin",
                }),
            }),
        );
    });

    it("records a missing metric reference as explicitly unscored", async () => {
        mocks.snapshot = metricWorkflowSnapshot();
        mocks.cells = ["stt", "text", "metric"].map((nodeKey) => ({
            id: `cell-${nodeKey}`,
            datasetItemId: "item-1",
            nodeKey,
            status: "pending",
        }));
        mocks.items = [
            {
                id: "item-1",
                type: "audio",
                storageKey: "audio-key",
                mimeType: "audio/wav",
            },
        ];
        mocks.getOrCreateAudioTranscriptArtifact.mockResolvedValue({
            artifact: { text: "नमस्ते", segments: [], warnings: [] },
            cacheHit: false,
            lookupLatencyMs: 1,
        });
        mocks.executeCell.mockResolvedValue({
            outputText: "namaste",
            usage: {},
            latencyMs: 1,
        });

        await executeWorkflowRun("run-1");

        expect(mocks.scoreRows).toContainEqual(
            expect.objectContaining({
                workflowRunCellId: "cell-metric",
                scorerType: "transcript_metric",
                score: null,
                detailsJson: expect.objectContaining({
                    referenceField: "expectedTranscriptLatin",
                    reason: "missing_reference",
                }),
            }),
        );
        expect(
            mocks.cells.find((cell) => cell.nodeKey === "metric")?.outputJson,
        ).toEqual({ text: "" });
    });

    it("fails unknown STT workflow node types closed", async () => {
        mocks.snapshot = {
            workflowId: "workflow-1",
            name: "Unknown node",
            kind: "stt",
            nodes: [
                {
                    id: "node-unknown",
                    nodeKey: "unknown",
                    label: "Unknown",
                    nodeType: "future_node",
                    nodeConfig: { type: "future_node" },
                    evalConfig: { type: "none" },
                },
            ],
            edges: [],
        };
        mocks.cells = [
            {
                id: "cell-unknown",
                datasetItemId: "item-1",
                nodeKey: "unknown",
                status: "pending",
            },
        ];

        await executeWorkflowRun("run-1");

        expect(mocks.executeCell).not.toHaveBeenCalled();
        expect(mocks.cells[0]).toEqual(
            expect.objectContaining({
                status: "failed",
                error: "Unsupported workflow node type: future_node.",
            }),
        );
    });

    it("executes judge nodes without a gold label", async () => {
        mocks.snapshot = {
            workflowId: "workflow-1",
            name: "PII judge",
            kind: "stt",
            nodes: [
                {
                    id: "node-stt",
                    nodeKey: "stt",
                    label: "STT",
                    nodeType: "stt",
                    nodeConfig: {
                        type: "stt",
                        sttConfig: { modelId: "gpt-4o-mini-transcribe" },
                    },
                    evalConfig: { type: "none" },
                },
                {
                    id: "node-judge",
                    nodeKey: "judge",
                    label: "PII judge",
                    nodeType: "judge",
                    nodeConfig: {
                        type: "judge",
                        rubricPrompt: "Does the transcript expose PII?",
                    },
                    modelId: "gpt-5",
                    evalConfig: { type: "none" },
                },
            ],
            edges: [
                {
                    id: "edge",
                    fromNodeId: "node-stt",
                    toNodeId: "node-judge",
                    carryOriginalInput: true,
                },
            ],
        };
        mocks.cells = ["stt", "judge"].map((nodeKey) => ({
            id: `cell-${nodeKey}`,
            datasetItemId: "item-1",
            nodeKey,
            status: "pending",
        }));
        mocks.items = [
            {
                id: "item-1",
                type: "audio",
                inputText: "Original audio context",
                storageKey: "audio-key",
                mimeType: "audio/wav",
            },
        ];
        mocks.getOrCreateAudioTranscriptArtifact.mockResolvedValue({
            artifact: {
                text: "OTP is 123456",
                segments: [],
                warnings: [],
            },
            cacheHit: false,
            lookupLatencyMs: 1,
        });
        mocks.runTranscriptEvaluator.mockResolvedValue({
            score: 0,
            rationale: "PII leaked",
            details: { metricKind: "llm_judge" },
        });
        mocks.executeCell.mockResolvedValue({
            outputText: '{"score":0,"criteria":[],"winner":"not_applicable"}',
            parsed: { score: 0, criteria: [], winner: "not_applicable" },
            usage: {},
            latencyMs: 1,
        });

        await executeWorkflowRun("run-1");

        expect(mocks.executeCell).toHaveBeenCalledWith(
            "gpt-5",
            expect.objectContaining({
                prompt: expect.stringContaining(
                    "<candidate_output>\nOTP is 123456\n</candidate_output>",
                ),
            }),
            {},
            {},
        );
        expect(mocks.scoreRows).toContainEqual(
            expect.objectContaining({
                scorerType: "transcript_judge",
                detailsJson: expect.objectContaining({
                    modelId: "gpt-5",
                    rubricPrompt: "Does the transcript expose PII?",
                }),
            }),
        );
        expect(mocks.cells.map((cell) => cell.status)).toEqual([
            "succeeded",
            "succeeded",
        ]);
    });
});

function metricWorkflowSnapshot() {
    return {
        workflowId: "workflow-1",
        name: "Latin metric",
        kind: "stt",
        nodes: [
            {
                id: "node-stt",
                nodeKey: "stt",
                label: "STT",
                nodeType: "stt",
                nodeConfig: {
                    type: "stt",
                    sttConfig: { modelId: "soniox:stt-async-v5" },
                },
                evalConfig: { type: "none" },
            },
            {
                id: "node-text",
                nodeKey: "text",
                label: "Latin text",
                nodeType: "llm_text",
                nodeConfig: {
                    type: "llm_text",
                    promptText: "Transliterate",
                },
                modelId: "gpt-5",
                evalConfig: { type: "none" },
            },
            {
                id: "node-metric",
                nodeKey: "metric",
                label: "Latin metric",
                nodeType: "metric_compare",
                nodeConfig: {
                    type: "metric_compare",
                    referenceField: "expectedTranscriptLatin",
                },
                evalConfig: { type: "none" },
            },
        ],
        edges: [
            {
                id: "stt-text",
                fromNodeId: "node-stt",
                toNodeId: "node-text",
                carryOriginalInput: false,
            },
            {
                id: "text-metric",
                fromNodeId: "node-text",
                toNodeId: "node-metric",
                carryOriginalInput: false,
            },
        ],
    };
}
