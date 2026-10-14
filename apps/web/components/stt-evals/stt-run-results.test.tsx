import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
    waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IWorkflowRunDetailResponse } from "@mosaic/api-contract";
import { SttRunResults } from "./stt-run-results";

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
});

function detail(): IWorkflowRunDetailResponse {
    const nodes = [
        {
            id: "node-a",
            workflowId: "workflow-1",
            nodeKey: "stt-a",
            label: "Diarized",
            nodeType: "stt" as const,
            nodeConfig: {
                type: "stt" as const,
                sttConfig: {
                    modelId: "soniox",
                    config: { diarization: true },
                },
            },
            evalConfig: { type: "none" as const },
        },
        {
            id: "node-text",
            workflowId: "workflow-1",
            nodeKey: "text-a",
            label: "Cleanup",
            nodeType: "llm_text" as const,
            nodeConfig: { type: "llm_text" as const, promptText: "Clean" },
            modelId: "gpt-5",
            evalConfig: { type: "none" as const },
        },
        {
            id: "node-b",
            workflowId: "workflow-1",
            nodeKey: "stt-b",
            label: "Plain",
            nodeType: "stt" as const,
            nodeConfig: {
                type: "stt" as const,
                sttConfig: {
                    modelId: "soniox",
                    config: { diarization: false },
                },
            },
            evalConfig: { type: "none" as const },
        },
    ];
    const edges = [
        {
            id: "edge-a",
            workflowId: "workflow-1",
            workflowRunId: "run-1",
            fromNodeId: "node-a",
            toNodeId: "node-text",
            carryOriginalInput: false,
        },
    ];
    return {
        workflowRun: {
            id: "run-1",
            teamId: "team-1",
            projectId: "project-1",
            workflowId: "workflow-1",
            datasetId: "dataset-1",
            status: "completed",
            runTarget: "dataset",
            workflowSnapshot: {
                workflowId: "workflow-1",
                name: "STT variants",
                kind: "stt",
                nodes,
                edges,
            },
            createdAt: "2026-07-14T00:00:00.000Z",
        },
        progress: { total: 3, done: 3, failed: 0, pending: 0 },
        nodes,
        edges,
        items: [
            {
                id: "item-1",
                type: "audio",
                inputText: null,
                storageKey: "audio.wav",
                mimeType: "audio/wav",
            },
            {
                id: "item-2",
                type: "audio",
                inputText: null,
                storageKey: "audio-2.wav",
                mimeType: "audio/wav",
            },
        ],
        cells: [
            {
                id: "cell-stt-a",
                workflowRunId: "run-1",
                datasetItemId: "item-1",
                nodeKey: "stt-a",
                status: "succeeded",
                inputText: "original audio context",
                outputJson: {
                    text: "raw transcript",
                    segments: [
                        {
                            speaker: "1",
                            startMs: 510,
                            endMs: 2910,
                            text: "first speaker turn",
                            language: "en",
                        },
                        {
                            speaker: "2",
                            startMs: 3330,
                            endMs: 5070,
                            text: "second speaker turn",
                        },
                    ],
                    usage: { promptTokens: 10, completionTokens: 5 },
                },
            },
            {
                id: "cell-text-a",
                workflowRunId: "run-1",
                datasetItemId: "item-1",
                nodeKey: "text-a",
                status: "succeeded",
                inputText: "raw transcript",
                outputJson: {
                    text: "clean transcript",
                    usage: {
                        promptTokens: 3,
                        completionTokens: 2,
                        thinkingTokens: 1,
                    },
                },
                llmExecution: {
                    availability: "complete",
                    requested: { mode: "project_default" },
                    resolved: {
                        contractVersion: 1,
                        requestedSelection: { mode: "project_default" },
                        routeId: "route-1",
                        routeVersionId: "route-version-1",
                        routeVersion: 3,
                        route: {
                            transportConfig: {
                                transport: "openrouter",
                                upstreamPolicy: {
                                    mode: "preference",
                                    order: ["openai", "azure"],
                                    allowFallbacks: true,
                                },
                                requireParameters: true,
                                responseCache: "allow",
                            },
                            modelId: "gpt-4o",
                            generation: {
                                maxOutputTokens: 512,
                                reasoningEffort: "medium",
                            },
                            structuredOutput: { mode: "text" },
                            retry: {
                                owner: "gateway",
                                timeoutMs: 60_000,
                            },
                            cache: {
                                mosaicReuse: "force_fresh",
                                providerCaching: "allow",
                            },
                        },
                        credential: {
                            providerKeyId: "key-1",
                            rotationVersion: "rotation-1",
                            hint: "Team OpenRouter",
                        },
                        capability: {
                            capabilityVersionId: "capability-1",
                            capabilityDigest: "digest-1",
                            capturedAt: "2026-07-24T00:00:00.000Z",
                            stale: false,
                            transport: {
                                transport: "openrouter",
                                modelId: "gpt-4o",
                                transportModelId: "openai/gpt-4o",
                                upstreamRoutingModes: ["preference"],
                                supportedGenerationControls: [
                                    "maxOutputTokens",
                                    "reasoningEffort",
                                ],
                                supportsStructuredOutput: true,
                                requiresCurrentDiscovery: true,
                            },
                        },
                    },
                    actual: {
                        status: "resolved",
                        identity: {
                            transport: "openrouter",
                            modelId: "openai/gpt-4o",
                            upstreamProvider: "azure",
                        },
                        generationId: "generation-1",
                        evidenceCompleteness: "complete",
                    },
                    attempts: [
                        {
                            sequence: 1,
                            owner: "gateway",
                            requested: {
                                transport: "openrouter",
                                modelId: "openai/gpt-4o",
                                upstreamProvider: "openai",
                            },
                            outcome: "failed",
                            errorClass: "upstream_unavailable",
                        },
                        {
                            sequence: 2,
                            owner: "gateway",
                            requested: {
                                transport: "openrouter",
                                modelId: "openai/gpt-4o",
                                upstreamProvider: "azure",
                            },
                            actual: {
                                status: "resolved",
                                identity: {
                                    transport: "openrouter",
                                    modelId: "openai/gpt-4o",
                                    upstreamProvider: "azure",
                                },
                                evidenceCompleteness: "complete",
                            },
                            outcome: "succeeded",
                        },
                    ],
                    cache: { status: "miss" },
                    usage: {
                        inputTokens: 3,
                        outputTokens: 2,
                        reasoningTokens: 1,
                        cacheReadTokens: 2,
                    },
                    currentCost: {
                        usd: 0.0042,
                        source: "gateway_reported",
                    },
                    currentLatencyMs: 725,
                },
            },
            {
                id: "cell-stt-b",
                workflowRunId: "run-1",
                datasetItemId: "item-1",
                nodeKey: "stt-b",
                status: "succeeded",
                inputText: "",
                outputJson: { text: "plain transcript" },
            },
            {
                id: "cell-stt-a-2",
                workflowRunId: "run-1",
                datasetItemId: "item-2",
                nodeKey: "stt-a",
                status: "succeeded",
                inputText: "second audio context",
                outputJson: { text: "second transcript" },
            },
        ],
        scoresByCell: {
            "cell-stt-a": [
                {
                    scorerType: "transcript_metric",
                    score: 0.75,
                    rationale: null,
                    detailsJson: {
                        metricKind: "mechanical_stt",
                        layer: "stt",
                        wer: 0.25,
                        cer: 0.1,
                        wordCounts: {
                            substitutions: 2,
                            deletions: 1,
                            insertions: 0,
                            referenceLength: 12,
                        },
                        hardFailures: ["repetition"],
                        diarization: {
                            speakerCountDelta: 0,
                            coverageRatio: 0.9,
                            der: 0.15,
                            falseAlarmRate: 0.05,
                            missedDetectionRate: null,
                            speakerConfusionRate: 0.1,
                            cpWer: 0.2,
                            perSpeakerWer: { Priyanshu: 0.125 },
                            concatenatedWer: 0.25,
                        },
                    },
                },
                {
                    scorerType: "transcript_judge",
                    score: 0.8,
                    rationale: "Strong overall fidelity",
                    detailsJson: {
                        modelId: "gpt-5-mini",
                        rubricPrompt: "Judge transcript fidelity.",
                        criteria: [
                            {
                                name: "Meaning preservation",
                                score: 0.9,
                                reasoning: "All key decisions are retained.",
                            },
                        ],
                    },
                },
            ],
            "cell-stt-a-2": [
                {
                    scorerType: "transcript_metric",
                    score: 0.5,
                    rationale: null,
                    detailsJson: {
                        wer: 0.5,
                        cer: 0.2,
                        wordCounts: {
                            substitutions: 3,
                            deletions: 1,
                            insertions: 1,
                            referenceLength: 10,
                        },
                        hardFailures: ["hallucination", "repetition"],
                    },
                },
            ],
        },
        nodeAggregates: [],
        sttItems: [],
        sttScoresByItem: {},
        sttAggregates: [],
    };
}

describe("SttRunResults", () => {
    it("summarizes scores and costs for a text pipeline without STT nodes", () => {
        const result = detail();
        const input = {
            ...result.nodes[0]!,
            nodeType: "input" as const,
            label: "News article",
            nodeConfig: { type: "input" as const, modality: "text" as const },
        };
        result.nodes = [input, result.nodes[1]!];
        result.workflowRun.workflowSnapshot = {
            ...result.workflowRun.workflowSnapshot,
            kind: "multi",
            nodes: result.nodes,
        };
        result.cells = result.cells
            .filter(
                (cell) =>
                    cell.datasetItemId === "item-1" && cell.nodeKey !== "stt-b",
            )
            .map((cell) => ({
                ...cell,
                costUsd: cell.nodeKey === "text-a" ? 0.01 : 0,
            }));
        result.scoresByCell = {
            "cell-text-a": [
                {
                    scorerType: "transcript_judge",
                    score: 0.9,
                    rationale: "Faithful",
                    detailsJson: {},
                },
            ],
        };
        render(<SttRunResults detail={result} />);
        const summary = screen
            .getByRole("heading", { name: "News article" })
            .closest('[data-slot="card"]');
        expect(summary).toHaveTextContent("Completed branch");
        expect(summary).toHaveTextContent("0.90");
        expect(summary).toHaveTextContent("$0.01");
    });

    it("labels each branch from its cell statuses", () => {
        const completed = detail();
        render(<SttRunResults detail={completed} />);
        expect(screen.getAllByText("Completed branch")).toHaveLength(2);
        cleanup();

        const running = detail();
        running.workflowRun.status = "running";
        running.cells = running.cells.map((cell) =>
            cell.id === "cell-text-a"
                ? { ...cell, status: "running", outputJson: undefined }
                : cell.nodeKey === "stt-b"
                  ? { ...cell, status: "pending", outputJson: undefined }
                  : cell,
        );
        render(<SttRunResults detail={running} />);

        const diarized = screen
            .getByRole("heading", { name: "Diarized" })
            .closest(".border") as HTMLElement;
        expect(
            within(diarized).getByText("Running branch"),
        ).toBeInTheDocument();
        const plain = screen
            .getByRole("heading", { name: "Plain" })
            .closest(".border") as HTMLElement;
        expect(within(plain).getByText("Pending branch")).toBeInTheDocument();
        expect(screen.queryByText("Completed branch")).not.toBeInTheDocument();
    });

    it("shows skeletons for in-flight cells and a pulsing badge while running", () => {
        const running = detail();
        running.workflowRun.status = "running";
        running.cells = running.cells.map((cell) =>
            cell.id === "cell-text-a"
                ? { ...cell, status: "running", outputJson: undefined }
                : cell.nodeKey === "stt-b"
                  ? { ...cell, status: "pending", outputJson: undefined }
                  : cell,
        );
        const inFlight = running.cells.filter(
            (cell) => cell.status === "running" || cell.status === "pending",
        ).length;
        render(<SttRunResults detail={running} />);

        const rows = Array.from(
            document.querySelectorAll<HTMLElement>("[data-workflow-cell-id]"),
        );
        const skeletonRows = rows.filter((row) =>
            row.querySelector('[data-slot="skeleton"]'),
        );
        expect(skeletonRows).toHaveLength(inFlight);
        // output preview + score for each in-flight row
        for (const row of skeletonRows) {
            expect(row.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
                3,
            );
        }
        const runningBadge = screen.getByLabelText("Cell status: Running");
        expect(
            runningBadge.querySelector('[data-slot="status-running-dot"]'),
        ).toBeInTheDocument();
        // finished rows keep their real output
        const items = screen.getByRole("list", { name: "Items" });
        expect(within(items).getByText("second transcript")).toBeVisible();
    });

    it("shows per-root usage without treating unavailable values as zero", () => {
        render(<SttRunResults detail={detail()} />);

        const diarized = screen
            .getByRole("heading", { name: "Diarized" })
            .closest(".border") as HTMLElement;
        expect(
            within(diarized).getByText("Input tokens").nextSibling,
        ).toHaveTextContent("13");
        expect(
            within(diarized).getByText("Output tokens").nextSibling,
        ).toHaveTextContent("7");
        expect(
            within(diarized).getByText("Thinking tokens").nextSibling,
        ).toHaveTextContent("1");

        const plain = screen
            .getByRole("heading", { name: "Plain" })
            .closest(".border") as HTMLElement;
        expect(
            within(plain).getByText("Input tokens").nextSibling,
        ).toHaveTextContent("–");
        expect(
            within(plain).getByText("Thinking tokens").nextSibling,
        ).toHaveTextContent("–");
    });

    it("keeps artifacts compact and exposes full text in the detail sheet", () => {
        render(<SttRunResults detail={detail()} />);

        // Inputs repeat the previous step's output, so only the sheet shows them.
        expect(screen.queryByText("original audio context")).toBeNull();
        expect(screen.getByText("clean transcript")).toHaveClass(
            "line-clamp-2",
        );
        expect(
            screen.getAllByText(/Speaker 1 0\.51s–2\.91s: first speaker turn/),
        ).not.toHaveLength(0);

        fireEvent.click(
            screen.getAllByRole("button", {
                name: "Open details for Diarized, item item-1",
            })[0]!,
        );
        const inspector = screen.getByRole("dialog", { name: "Diarized" });

        fireEvent.click(within(inspector).getByRole("tab", { name: "Input" }));
        expect(
            within(inspector).getByRole("region", { name: "Full input" }),
        ).toHaveTextContent("original audio context");

        fireEvent.click(within(inspector).getByRole("tab", { name: "Output" }));
        expect(
            within(inspector).getByRole("region", { name: "Full output" }),
        ).toHaveTextContent("Speaker 1 0.51s–2.91s: first speaker turn");
        expect(
            within(inspector).getByRole("region", {
                name: "Diarized transcript",
            }),
        ).toHaveTextContent("Speaker 2");
        expect(
            within(inspector).getByRole("region", {
                name: "Raw output payload",
            }),
        ).toHaveTextContent("Raw output payload");
    });

    it("explains requested, resolved, actual, fallback, cache, usage, and cost provenance", () => {
        render(<SttRunResults detail={detail()} />);

        expect(screen.getAllByText("gpt-4o")).not.toHaveLength(0);
        expect(screen.getAllByText("openrouter → azure")).not.toHaveLength(0);

        fireEvent.click(
            screen.getAllByRole("button", {
                name: "Open details for Cleanup, item item-1",
            })[0]!,
        );
        const inspector = screen.getByRole("dialog", { name: "Cleanup" });

        expect(within(inspector).getByText("Project default")).toBeVisible();
        expect(
            within(inspector).getByText(
                "openrouter · gpt-4o · preference · route v3",
            ),
        ).toBeVisible();
        expect(
            within(inspector).getByText("openrouter · openai/gpt-4o · azure"),
        ).toBeVisible();
        expect(within(inspector).getByText("Fallback observed")).toBeVisible();
        expect(
            within(inspector).getByText(
                "Live generation · Flash Evals reuse miss",
            ),
        ).toBeVisible();
        expect(within(inspector).getByText("Reasoning tokens")).toBeVisible();
        expect(within(inspector).getByText("Cache read tokens")).toBeVisible();
        expect(
            within(inspector).queryByText("Cache write tokens"),
        ).not.toBeInTheDocument();
        expect(
            within(inspector).getByText("$0.0042 · Gateway reported"),
        ).toBeVisible();
    });

    it("does not label a same-route retry as fallback", () => {
        const retried = detail();
        const execution = retried.cells.find(
            (cell) => cell.id === "cell-text-a",
        )!.llmExecution;
        if (execution?.availability !== "complete")
            throw new Error("Expected complete execution fixture");
        execution.attempts[0]!.requested.upstreamProvider = "azure";

        render(<SttRunResults detail={retried} />);
        fireEvent.click(
            screen.getAllByRole("button", {
                name: "Open details for Cleanup, item item-1",
            })[0]!,
        );
        const inspector = screen.getByRole("dialog", { name: "Cleanup" });

        expect(
            within(inspector).getByText("No fallback observed"),
        ).toBeVisible();
        expect(
            within(inspector).queryByText("Fallback observed"),
        ).not.toBeInTheDocument();
    });

    it("keeps legacy model cells navigable and does not synthesize unavailable facts", () => {
        const legacy = detail();
        const legacyCell = legacy.cells.find(
            (cell) => cell.id === "cell-text-a",
        )!;
        legacyCell.llmExecution = { availability: "legacy_unavailable" };

        render(<SttRunResults detail={legacy} />);
        fireEvent.click(
            screen.getAllByRole("button", {
                name: "Open details for Cleanup, item item-1",
            })[0]!,
        );
        const inspector = screen.getByRole("dialog", { name: "Cleanup" });

        expect(
            within(inspector).getByText("Legacy routing evidence unavailable"),
        ).toBeVisible();
        expect(
            within(inspector).queryByText("$0.0000"),
        ).not.toBeInTheDocument();
        expect(
            within(inspector).queryByText("0 tokens"),
        ).not.toBeInTheDocument();
        expect(
            within(inspector).queryByText("Live generation"),
        ).not.toBeInTheDocument();
    });

    it("labels provider-reported and estimated costs distinctly", () => {
        const providerReported = detail();
        const providerExecution = providerReported.cells.find(
            (cell) => cell.id === "cell-text-a",
        )!.llmExecution;
        if (providerExecution?.availability !== "complete")
            throw new Error("Expected complete execution fixture");
        providerExecution.currentCost = {
            usd: 0.0031,
            source: "provider_reported",
        };
        const view = render(<SttRunResults detail={providerReported} />);
        fireEvent.click(
            screen.getAllByRole("button", {
                name: "Open details for Cleanup, item item-1",
            })[0]!,
        );
        expect(
            within(screen.getByRole("dialog", { name: "Cleanup" })).getByText(
                "$0.0031 · Provider reported",
            ),
        ).toBeVisible();

        const estimated = detail();
        const estimatedExecution = estimated.cells.find(
            (cell) => cell.id === "cell-text-a",
        )!.llmExecution;
        if (estimatedExecution?.availability !== "complete")
            throw new Error("Expected complete execution fixture");
        estimatedExecution.currentCost = {
            usd: 0.0028,
            source: "catalog_estimate",
        };
        view.rerender(<SttRunResults detail={estimated} />);
        expect(
            within(screen.getByRole("dialog", { name: "Cleanup" })).getByText(
                "$0.0028 · Catalog estimate",
            ),
        ).toBeVisible();
    });

    it("separates Flash Evals reuse from live and provider cache provenance", () => {
        const reused = detail();
        const execution = reused.cells.find(
            (cell) => cell.id === "cell-text-a",
        )!.llmExecution;
        if (execution?.availability !== "complete")
            throw new Error("Expected complete execution fixture");
        execution.cache = {
            status: "mosaic_reuse",
            fingerprintVersion: 1,
            fingerprint: "fingerprint-1",
            sourceRunId: "origin-run",
            sourceCellId: "origin-cell",
            artifactDigest: "artifact-1",
        };
        execution.currentCost = { source: "unavailable" };
        execution.originCost = {
            usd: 0.0064,
            source: "provider_reported",
        };

        render(<SttRunResults detail={reused} />);
        fireEvent.click(
            screen.getAllByRole("button", {
                name: "Open details for Cleanup, item item-1",
            })[0]!,
        );
        const inspector = screen.getByRole("dialog", { name: "Cleanup" });
        // The "Flash Evals reuse" setting label, plus the cache result value.
        expect(
            within(inspector).getAllByText("Flash Evals reuse"),
        ).toHaveLength(2);
        expect(within(inspector).getByText("origin-run")).toBeVisible();
        expect(within(inspector).getByText("origin-cell")).toBeVisible();
        expect(
            within(inspector).getByRole("button", { name: "Copy source run" }),
        ).toBeInTheDocument();
        expect(
            within(inspector).getByRole("button", { name: "Copy source cell" }),
        ).toBeInTheDocument();
        expect(
            within(inspector).getByText("$0.0064 · Provider reported"),
        ).toBeVisible();
        expect(
            within(inspector).queryByText("Provider response cache hit"),
        ).not.toBeInTheDocument();
        expect(
            within(inspector).queryByText("Live generation"),
        ).not.toBeInTheDocument();
    });

    it("shows an OpenRouter response-cache hit without claiming an upstream call", () => {
        const cached = detail();
        const execution = cached.cells.find(
            (cell) => cell.id === "cell-text-a",
        )!.llmExecution;
        if (execution?.availability !== "complete")
            throw new Error("Expected complete execution fixture");
        execution.cache = {
            status: "provider_cache",
            kind: "response",
            hit: true,
        };
        execution.actual = {
            status: "not_invoked",
            evidenceCompleteness: "complete",
        };
        execution.attempts = [];

        render(<SttRunResults detail={cached} />);
        fireEvent.click(
            screen.getAllByRole("button", {
                name: "Open details for Cleanup, item item-1",
            })[0]!,
        );
        const inspector = screen.getByRole("dialog", { name: "Cleanup" });
        expect(
            within(inspector).getByText("Provider response cache hit"),
        ).toBeVisible();
        expect(
            within(inspector).getByText("Not invoked · complete evidence"),
        ).toBeVisible();
        expect(
            within(inspector).queryByText("openrouter · openai/gpt-4o · azure"),
        ).not.toBeInTheDocument();
    });

    it("shows branch metric aggregates and opens the full score breakdown", () => {
        render(<SttRunResults detail={detail()} />);

        const diarized = screen
            .getByRole("heading", { name: "Diarized" })
            .closest(".border") as HTMLElement;
        expect(
            within(diarized).getByText("Average WER").nextSibling,
        ).toHaveTextContent("37.5%");
        expect(
            within(diarized).getByText("Average CER").nextSibling,
        ).toHaveTextContent("15.0%");
        expect(within(diarized).getByText("3 hard failures")).toBeVisible();

        const plain = screen
            .getByRole("heading", { name: "Plain" })
            .closest(".border") as HTMLElement;
        expect(
            within(plain).getByText("Average WER").nextSibling,
        ).toHaveTextContent("–");

        fireEvent.click(
            screen.getAllByRole("button", {
                name: "Open details for Diarized, item item-1",
            })[0]!,
        );
        const inspector = screen.getByRole("dialog", {
            name: "Diarized",
        });
        expect(
            within(inspector).getByText("WER").nextSibling,
        ).toHaveTextContent("25.0%");
        expect(
            within(inspector).getByText("Substitutions").nextSibling,
        ).toHaveTextContent("2");
        expect(within(inspector).getByText("repetition")).toBeVisible();
        expect(
            within(inspector).getByText("DER").nextSibling,
        ).toHaveTextContent("15.0%");
        expect(
            within(inspector).getByText("Missed detection rate").nextSibling,
        ).toHaveTextContent("–");
        expect(within(inspector).getByText("Priyanshu: 12.5%")).toBeVisible();
        expect(
            within(inspector).getByText("Judge transcript fidelity."),
        ).toBeVisible();
        expect(
            within(inspector).getByText("Meaning preservation"),
        ).toBeVisible();
        expect(
            within(inspector).getByText("All key decisions are retained."),
        ).toBeVisible();

        fireEvent.click(
            within(inspector).getByRole("button", { name: "Close" }),
        );
        expect(screen.queryByRole("dialog", { name: "Diarized" })).toBeNull();
        expect(
            screen.getAllByRole("button", {
                name: "Open details for Diarized, item item-1",
            })[0]!,
        ).toHaveAttribute("aria-expanded", "false");
    });
});

describe("blocked cell navigation", () => {
    function blockedDetail() {
        const result = detail();
        result.cells = result.cells.map((cell) =>
            cell.id === "cell-text-a"
                ? {
                      ...cell,
                      status: "failed",
                      outputJson: undefined,
                      error: "Blocked by failed node stt-a.",
                  }
                : cell.id === "cell-stt-a"
                  ? { ...cell, status: "failed", error: "Provider unavailable" }
                  : cell,
        );
        result.cells.unshift({
            ...result.cells[0]!,
            id: "other-item-cell",
            datasetItemId: "item-2",
        });
        return result;
    }

    it("links the blocked output to the exact upstream recording and closes the inspector", async () => {
        window.history.replaceState(
            null,
            "",
            "/multiworkflow/workflow-1/runs/run-1",
        );
        render(<SttRunResults detail={blockedDetail()} />);
        fireEvent.click(
            screen.getAllByRole("button", {
                name: "Open details for Cleanup, item item-1",
            })[0]!,
        );
        const inspector = screen.getByRole("dialog", { name: "Cleanup" });
        fireEvent.click(within(inspector).getByRole("tab", { name: "Output" }));
        const link = within(inspector).getByRole("link", { name: "Diarized" });
        expect(link).toHaveAttribute(
            "href",
            "/multiworkflow/workflow-1/runs/run-1#cell=cell-stt-a",
        );
        fireEvent.click(link);
        await waitFor(() =>
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
        );
        expect(window.location.hash).toBe("#cell=cell-stt-a");
        for (const target of document.querySelectorAll(
            '[data-workflow-cell-id="cell-stt-a"]',
        ))
            expect(target).toHaveClass("outline-2");
        expect(
            document.querySelector('[data-workflow-cell-id="other-item-cell"]'),
        ).not.toHaveClass("outline-2");
    });

    it("restores a direct cell link on load and follows back navigation", async () => {
        window.history.replaceState(
            null,
            "",
            "/multiworkflow/workflow-1/runs/run-1#cell=cell-stt-a",
        );
        render(<SttRunResults detail={blockedDetail()} />);
        await waitFor(() =>
            expect(
                document.querySelector('[data-workflow-cell-id="cell-stt-a"]'),
            ).toHaveClass("outline-2"),
        );
        window.history.replaceState(
            null,
            "",
            "/multiworkflow/workflow-1/runs/run-1#cell=unknown",
        );
        fireEvent(window, new PopStateEvent("popstate"));
        await waitFor(() =>
            expect(
                document.querySelector('[data-workflow-cell-id="cell-stt-a"]'),
            ).not.toHaveClass("outline-2"),
        );
    });

    it("does not fabricate a link when the source is missing or not a captured dependency", () => {
        const result = blockedDetail();
        result.edges = [];
        render(<SttRunResults detail={result} />);
        expect(
            screen.queryByRole("link", { name: "Diarized" }),
        ).not.toBeInTheDocument();
        expect(
            screen.getAllByText("Blocked by failed node stt-a.").length,
        ).toBeGreaterThan(0);
    });
});

describe("item output groups", () => {
    function stepLabels(item: HTMLElement) {
        return Array.from(
            item.querySelectorAll<HTMLElement>("[data-workflow-cell-id]"),
        ).map((row) => row.querySelector("p")?.textContent);
    }

    it("groups each item's steps in pipeline order, branch by branch", () => {
        const shuffled = detail();
        shuffled.cells.reverse();
        render(<SttRunResults detail={shuffled} />);

        const items = Array.from(
            screen.getByRole("list", { name: "Items" }).children,
        ) as HTMLElement[];
        expect(items).toHaveLength(2);
        expect(stepLabels(items[0]!)).toEqual(["Diarized", "Cleanup", "Plain"]);
        expect(stepLabels(items[1]!)).toEqual(["Diarized"]);
        expect(within(items[0]!).getByText("3 of 3 succeeded")).toBeVisible();
    });

    it("filters items by ID and status and collapses their steps", () => {
        const failed = detail();
        failed.cells = failed.cells.map((cell) =>
            cell.id === "cell-stt-a-2"
                ? {
                      ...cell,
                      status: "failed",
                      outputJson: undefined,
                      error: "Provider timed out.",
                  }
                : cell,
        );
        render(<SttRunResults detail={failed} />);

        fireEvent.click(screen.getByRole("button", { name: /^Failed/ }));
        expect(screen.queryByText("clean transcript")).toBeNull();
        expect(screen.getByText("1 failed")).toBeVisible();
        expect(screen.getByText("Provider timed out.")).toHaveClass(
            "text-danger",
        );

        fireEvent.click(screen.getByRole("button", { name: /^All/ }));
        fireEvent.change(screen.getByRole("searchbox"), {
            target: { value: "ITEM-1" },
        });
        expect(screen.getByText("clean transcript")).toBeVisible();
        expect(screen.queryByText("1 failed")).toBeNull();

        const collapse = screen.getByRole("button", {
            name: "Collapse item item-1",
        });
        fireEvent.click(collapse);
        expect(collapse).toHaveAttribute("aria-expanded", "false");
        expect(screen.getByText("clean transcript")).not.toBeVisible();
        fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
        expect(screen.getByText("clean transcript")).toBeVisible();
    });

    it("renders markdown emphasis in previews and shows the configured STT model", () => {
        const markdown = detail();
        markdown.cells = markdown.cells.map((cell) =>
            cell.id === "cell-text-a"
                ? {
                      ...cell,
                      outputJson: {
                          text: "**Main Topic:** pricing\n* units sold out",
                      },
                  }
                : cell,
        );
        render(<SttRunResults detail={markdown} />);

        const topic = screen.getByText("Main Topic:");
        expect(topic.tagName).toBe("STRONG");
        expect(topic.parentElement).toHaveTextContent(
            "Main Topic: pricing units sold out",
        );
        expect(screen.getAllByText("soniox")).not.toHaveLength(0);
    });
});

describe("original recording playback", () => {
    function audioInputDetail() {
        const result = detail();
        const node: IWorkflowRunDetailResponse["nodes"][number] = {
            id: "node-input",
            workflowId: "workflow-1",
            nodeKey: "input-1",
            label: "Audio input",
            nodeType: "input",
            nodeConfig: { type: "input", modality: "audio" },
            evalConfig: { type: "none" },
        };
        result.workflowRun.workflowSnapshot.nodes.push(node);
        result.cells.push({
            id: "cell-input",
            workflowRunId: "run-1",
            datasetItemId: "item-1",
            nodeKey: "input-1",
            status: "succeeded",
            inputText: "<input></input>",
            outputJson: { text: "[Audio input: audio/wav]" },
        });
        result.items[0]!.storageKey = "datasets/audio/recording one.wav";
        return result;
    }

    it("renders lazy native players in input rows and both sheet tabs", () => {
        const { container } = render(
            <SttRunResults detail={audioInputDetail()} />,
        );
        const players = container.querySelectorAll("audio");
        expect(players).toHaveLength(1); // one responsive row per step
        for (const player of players) {
            expect(player).toHaveAttribute("controls");
            expect(player).toHaveAttribute("preload", "none");
            expect(player).toHaveAttribute(
                "src",
                "/api/images/datasets/audio/recording%20one.wav",
            );
            expect(player).not.toHaveAttribute("autoplay");
        }
        fireEvent.click(
            screen.getAllByRole("button", {
                name: "Open details for Audio input, item item-1",
            })[0]!,
        );
        const inspector = screen.getByRole("dialog", { name: "Audio input" });
        fireEvent.click(within(inspector).getByRole("tab", { name: "Input" }));
        expect(
            within(inspector)
                .getByRole("region", { name: "Original recording" })
                .querySelector("audio"),
        ).toHaveAttribute(
            "src",
            "/api/images/datasets/audio/recording%20one.wav",
        );
        fireEvent.click(within(inspector).getByRole("tab", { name: "Output" }));
        expect(
            within(inspector)
                .getByRole("region", { name: "Full output" })
                .querySelector("audio"),
        ).toBeInTheDocument();
    });

    it("keeps downstream text visible alongside the original recording and explains media failures", () => {
        render(<SttRunResults detail={audioInputDetail()} />);
        fireEvent.click(
            screen.getAllByRole("button", {
                name: "Open details for Cleanup, item item-1",
            })[0]!,
        );
        const inspector = screen.getByRole("dialog", { name: "Cleanup" });
        fireEvent.click(within(inspector).getByRole("tab", { name: "Input" }));
        expect(
            within(inspector).getByRole("region", { name: "Full input" }),
        ).toHaveTextContent("raw transcript");
        fireEvent.error(
            within(inspector)
                .getByRole("region", { name: "Original recording" })
                .querySelector("audio")!,
        );
        expect(within(inspector).getByRole("alert")).toHaveTextContent(
            "Audio could not be loaded",
        );
        expect(
            within(inspector).getByRole("link", {
                name: "Open original recording",
            }),
        ).toHaveAttribute(
            "href",
            "/api/images/datasets/audio/recording%20one.wav",
        );
    });
});
