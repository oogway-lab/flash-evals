"use client";

import {
    useActionState,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import type {
    IPromptWorkflow,
    IRunSetupResponse,
    IWorkflowLlmProjectDefaultState,
    IWorkflowLlmRoute,
    IWorkflowLlmRouteCandidate,
    IWorkflowLlmSelection,
    IWorkflowNodeConfig,
    WorkflowLlmTransport,
    WorkflowRunCondition,
    IWorkflowStepSettings,
    WorkflowNodeType,
} from "@flash-evals/api-contract";
import { isWorkflowModelBackedNodeType } from "@flash-evals/api-contract";
import {
    addEdge,
    Background,
    Controls,
    MarkerType,
    ReactFlow,
    useEdgesState,
    useNodesState,
    type Connection,
    type Edge,
    type EdgeChange,
    type Node,
    type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LayoutGrid, Plus, Save } from "lucide-react";
import type { IActionState } from "@/app/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UnsavedChangesGuard } from "@/components/layout/unsaved-changes-guard";
import { SttFlowNode } from "./flow-node";
import { SttNodeInspector } from "./stt-node-inspector";
import {
    validateSttGraphConnection,
    type ISttGraphNodeData,
} from "./stt-canvas-graph";
import { WORKFLOW_NODE_REPAIR_EVENT } from "./workflow-node-repair";
import { FinalAnswerFields } from "./final-answer-fields";
import { EdgeModeFields } from "./edge-mode-fields";
import { NODE_TYPE_LABELS } from "@/lib/labels";

export type SttNodeData = ISttGraphNodeData & {
    nodeConfig: IWorkflowNodeConfig;
    promptVersionId?: string;
    modelId?: string;
    reasoningConfig?: {
        effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
    };
    llmExecutionSelection?: IWorkflowLlmSelection;
    evalConfig: { type: "none" };
    runCondition?: WorkflowRunCondition;
    stepSettings?: IWorkflowStepSettings;
};
export type SttCanvasNode = Node<SttNodeData>;

/** What a connection saves besides its ends. */
export interface ISttEdgeData extends Record<string, unknown> {
    carryOriginalInput?: boolean;
    /** The target waits for the source but reads the original input. */
    orderOnly?: boolean;
}

const ORDER_ONLY_TARGETS = new Set<WorkflowNodeType>(["prompt", "llm_text"]);

/** A connection drawn on the canvas: dashed and labelled when order-only. */
export function canvasEdge(
    edge: Pick<Edge, "id" | "source" | "target">,
    data: ISttEdgeData,
): Edge {
    return {
        ...edge,
        data,
        markerEnd: { type: MarkerType.ArrowClosed },
        ...(data.orderOnly
            ? {
                  label: "order only",
                  style: { strokeDasharray: "6 4" },
              }
            : {}),
    };
}

/** The saved form of the canvas's connections. */
export function serializeEdges(edges: Edge[]): Array<{
    fromNodeKey: string;
    toNodeKey: string;
    carryOriginalInput: boolean;
    orderOnly?: boolean;
}> {
    return edges.map((edge) => {
        const data = (edge.data ?? {}) as ISttEdgeData;
        return {
            fromNodeKey: edge.source,
            toNodeKey: edge.target,
            carryOriginalInput: data.carryOriginalInput === true,
            ...(data.orderOnly ? { orderOnly: true } : {}),
        };
    });
}
type CreateLlmRouteAction = (input: {
    transport: WorkflowLlmTransport;
    modelId: string;
    name: string;
    reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
}) => Promise<{ route?: IWorkflowLlmRoute; error?: string }>;
type LoadLlmModelsAction = (
    transport: WorkflowLlmTransport,
) => Promise<{ candidates?: IWorkflowLlmRouteCandidate[]; error?: string }>;
const EMPTY_LLM_ROUTES: IWorkflowLlmRoute[] = [];
const nodeTypes = {
    input: SttFlowNode,
    prompt: SttFlowNode,
    stt: SttFlowNode,
    llm_text: SttFlowNode,
    transliterate: SttFlowNode,
    judge: SttFlowNode,
    metric_compare: SttFlowNode,
};

function graphNodes(workflow: IPromptWorkflow): SttCanvasNode[] {
    // Nodes saved without a type are prompt steps in a prompt pipeline.
    const defaultType = workflow.kind === "prompt" ? "prompt" : "stt";
    const depth = new Map(workflow.nodes.map((node) => [node.id, 0]));
    for (let pass = 0; pass < workflow.nodes.length; pass += 1)
        for (const edge of workflow.edges)
            depth.set(
                edge.toNodeId,
                Math.max(
                    depth.get(edge.toNodeId) ?? 0,
                    (depth.get(edge.fromNodeId) ?? 0) + 1,
                ),
            );
    const rows = new Map<number, number>();
    return workflow.nodes.map((node) => {
        const column = depth.get(node.id) ?? 0;
        const row = rows.get(column) ?? 0;
        rows.set(column, row + 1);
        return {
            id: node.nodeKey,
            type: node.nodeType ?? defaultType,
            position: node.position ?? { x: column * 260, y: row * 150 },
            data: {
                nodeKey: node.nodeKey,
                label: node.label,
                nodeType: node.nodeType ?? defaultType,
                nodeConfig:
                    node.nodeConfig ??
                    (defaultType === "prompt"
                        ? { type: "prompt" }
                        : { type: "stt", sttConfig: { modelId: "" } }),
                promptVersionId: node.promptVersionId,
                modelId: node.modelId,
                reasoningConfig: node.reasoningConfig,
                llmExecutionSelection: node.llmExecutionSelection,
                evalConfig: { type: "none" },
                ...(node.runCondition
                    ? { runCondition: node.runCondition }
                    : {}),
                ...(node.stepSettings
                    ? { stepSettings: node.stepSettings }
                    : {}),
            },
        };
    });
}

/** Steps with a path to `nodeKey` (they run before it), in canvas order. */
export function earlierStepsOf(
    nodes: SttCanvasNode[],
    edges: Array<Pick<Edge, "source" | "target">>,
    nodeKey: string | undefined,
): Array<{ nodeKey: string; label: string }> {
    if (!nodeKey) return [];
    const ancestors = new Set<string>();
    const pending = [nodeKey];
    while (pending.length) {
        const key = pending.pop()!;
        for (const edge of edges)
            if (edge.target === key && !ancestors.has(edge.source)) {
                ancestors.add(edge.source);
                pending.push(edge.source);
            }
    }
    return nodes
        .filter(
            (node) =>
                ancestors.has(node.id) &&
                node.data.nodeType !== "input" &&
                node.data.nodeType !== "stt",
        )
        .map((node) => ({ nodeKey: node.id, label: node.data.label }));
}

function defaultNode(
    type: WorkflowNodeType,
    setup: IRunSetupResponse,
    index: number,
    defaultRoute?: IWorkflowLlmRoute,
): SttNodeData {
    const legacyLlm =
        setup.availableModels.find((model) => model.available)?.id ?? "";
    // Every provider an eval run can use, the makers' own APIs included, can
    // run a workflow step.
    const simpleTransport =
        setup.availableModels.find((model) => model.id === legacyLlm)
            ?.transports?.[0] ?? "gateway";
    const llm = defaultRoute?.latestVersion?.config.modelId ?? legacyLlm;
    const reasoningEffort =
        defaultRoute?.latestVersion?.config.generation.reasoningEffort;
    const stt = setup.sttModels.find((model) => model.available)?.id ?? "";
    const base = {
        nodeKey: `${type}-${crypto.randomUUID()}`,
        label: `${NODE_TYPE_LABELS[type]} ${index}`,
        nodeType: type,
        evalConfig: { type: "none" as const },
    };
    switch (type) {
        case "input":
            return {
                ...base,
                nodeConfig: { type, modality: "audio" },
            };
        case "prompt":
            return {
                ...base,
                nodeConfig: { type },
                promptVersionId: setup.versionOptions[0]?.id,
                modelId: llm,
                ...(reasoningEffort
                    ? { reasoningConfig: { effort: reasoningEffort } }
                    : {}),
                llmExecutionSelection: {
                    mode: "simple",
                    transport: simpleTransport,
                },
            };
        case "stt":
            return {
                ...base,
                nodeConfig: { type, sttConfig: { modelId: stt } },
            };
        case "llm_text":
            return {
                ...base,
                nodeConfig: { type, promptText: "" },
                modelId: llm,
                ...(reasoningEffort
                    ? { reasoningConfig: { effort: reasoningEffort } }
                    : {}),
                llmExecutionSelection: {
                    mode: "simple",
                    transport: simpleTransport,
                },
            };
        case "transliterate":
            return {
                ...base,
                nodeConfig: {
                    type,
                    transliteration: {
                        enabled: true,
                        targetScript: "latin",
                        modelId: llm,
                    },
                },
                ...(reasoningEffort
                    ? { reasoningConfig: { effort: reasoningEffort } }
                    : {}),
                llmExecutionSelection: {
                    mode: "simple",
                    transport: simpleTransport,
                },
            };
        case "judge":
            return {
                ...base,
                nodeConfig: { type, rubricPrompt: "" },
                modelId: llm,
                ...(reasoningEffort
                    ? { reasoningConfig: { effort: reasoningEffort } }
                    : {}),
                llmExecutionSelection: {
                    mode: "simple",
                    transport: simpleTransport,
                },
            };
        case "metric_compare":
            return {
                ...base,
                nodeConfig: { type, referenceField: "expectedTranscript" },
            };
        default:
            return {
                ...base,
                nodeType: "llm_text",
                nodeConfig: { type: "llm_text", promptText: "" },
                modelId: llm,
                llmExecutionSelection: {
                    mode: "simple",
                    transport: simpleTransport,
                },
            };
    }
}

const ALL_BLOCK_TYPES = [
    "input",
    "prompt",
    "stt",
    "llm_text",
    "transliterate",
    "judge",
    "metric_compare",
] as const satisfies readonly WorkflowNodeType[];

/** Blocks a pipeline kind accepts: a "prompt" pipeline holds prompt steps only. */
export function blockTypesFor(
    kind: IPromptWorkflow["kind"],
): readonly WorkflowNodeType[] {
    return kind === "prompt" ? ["prompt"] : ALL_BLOCK_TYPES;
}

function canvasRootType(
    kind: IPromptWorkflow["kind"],
): "input" | "stt" | "none" {
    if (kind === "multi") return "input";
    return kind === "prompt" ? "none" : "stt";
}

// Selection and measurement changes don't alter the saved graph.
function editsGraph(changes: Array<NodeChange | EdgeChange>): boolean {
    return changes.some(
        (change) => change.type !== "select" && change.type !== "dimensions",
    );
}

export function SttCanvas({
    workflow,
    setup,
    saveAction,
    llmRoutes = EMPTY_LLM_ROUTES,
    projectDefault,
    onCreateLlmRoute,
    onLoadLlmModels,
    onDirtyChange,
}: {
    workflow: IPromptWorkflow;
    setup: IRunSetupResponse;
    saveAction: (state: IActionState, data: FormData) => Promise<IActionState>;
    llmRoutes?: IWorkflowLlmRoute[];
    projectDefault?: IWorkflowLlmProjectDefaultState;
    onCreateLlmRoute?: CreateLlmRouteAction;
    onLoadLlmModels?: LoadLlmModelsAction;
    onDirtyChange?: (dirty: boolean) => void;
}) {
    const initialNodes = useMemo(() => graphNodes(workflow), [workflow]);
    const idByNode = useMemo(
        () => new Map(workflow.nodes.map((node) => [node.id, node.nodeKey])),
        [workflow],
    );
    const initialEdges = useMemo<Edge[]>(
        () =>
            workflow.edges.map((edge) =>
                canvasEdge(
                    {
                        id: edge.id,
                        source: idByNode.get(edge.fromNodeId) ?? "",
                        target: idByNode.get(edge.toNodeId) ?? "",
                    },
                    {
                        carryOriginalInput: edge.carryOriginalInput,
                        ...(edge.orderOnly ? { orderOnly: true } : {}),
                    },
                ),
            ),
        [workflow.edges, idByNode],
    );
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
    const [selected, setSelected] = useState<string>();
    const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
    const [availableRoutes, setAvailableRoutes] = useState(llmRoutes);
    useEffect(() => setAvailableRoutes(llmRoutes), [llmRoutes]);
    const [dirty, setDirty] = useState(false);
    const [graphError, setGraphError] = useState<string>();
    const [finalAnswer, setFinalAnswer] = useState(workflow.finalAnswer);

    // Keyboard deletes (Backspace/Delete) wait on this confirmation.
    const [pendingNodeDelete, setPendingNodeDelete] = useState<{
        labels: string[];
        resolve: (confirmed: boolean) => void;
    }>();
    const [state, formAction, pending] = useActionState(saveAction, {});
    const submittedGraph = useRef<string>(undefined);
    useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
    const defaultRoute = useMemo(
        () => routeAtVersion(availableRoutes, projectDefault?.routeVersionId),
        [availableRoutes, projectDefault?.routeVersionId],
    );
    useEffect(() => {
        const repair = (event: Event) => {
            const nodeKey = (event as CustomEvent<{ nodeKey?: string }>).detail
                ?.nodeKey;
            if (nodeKey && nodes.some((node) => node.id === nodeKey))
                setSelected(nodeKey);
        };
        document.addEventListener(WORKFLOW_NODE_REPAIR_EVENT, repair);
        return () =>
            document.removeEventListener(WORKFLOW_NODE_REPAIR_EVENT, repair);
    }, [nodes]);
    const onConnect = useCallback(
        (connection: Connection) => {
            if (!connection.source || !connection.target) return;
            const error = validateSttGraphConnection(
                nodes,
                edges,
                connection.source,
                connection.target,
                canvasRootType(workflow.kind),
            );
            if (error) return setGraphError(error);
            setGraphError(undefined);
            setDirty(true);
            setEdges((current) =>
                addEdge(
                    {
                        ...connection,
                        markerEnd: { type: MarkerType.ArrowClosed },
                    },
                    current,
                ),
            );
        },
        [nodes, edges, setEdges, workflow.kind],
    );
    function addNode(type: WorkflowNodeType) {
        const data = defaultNode(type, setup, nodes.length + 1, defaultRoute);
        setNodes((current) => [
            ...current,
            {
                id: data.nodeKey,
                type,
                data,
                position: { x: 40, y: 40 + current.length * 30 },
            },
        ]);
        setDirty(true);
    }
    function autoLayout() {
        setNodes((current) =>
            current.map((node, index) => ({
                ...node,
                position: {
                    x: (index % 3) * 260,
                    y: Math.floor(index / 3) * 150,
                },
            })),
        );
        setDirty(true);
    }
    const serializedNodes = nodes.map((node) => ({
        ...node.data,
        position: node.position,
    }));
    const serializedEdges = serializeEdges(edges);
    const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
    const graph = JSON.stringify([
        serializedNodes,
        serializedEdges,
        finalAnswer ?? null,
    ]);
    // Clear the dirty flag only once a save succeeds, and only while the graph
    // still matches what was submitted (edits made mid-save stay unsaved).
    useEffect(() => {
        if (state.ok && submittedGraph.current === graph) setDirty(false);
    }, [state, graph]);
    const selectedNode = nodes.find((node) => node.id === selected);
    // Display-only copy of the nodes: flags nodes whose LLM route needs
    // repair and names each node for screen readers. The saved graph is
    // serialized from `nodes`, so none of this is persisted.
    const displayNodes = useMemo(
        () =>
            nodes.map((node) => {
                const needsRepair = nodeNeedsRouteRepair(
                    node.data,
                    availableRoutes,
                    defaultRoute,
                );
                return {
                    ...node,
                    ariaLabel: `${NODE_TYPE_LABELS[node.data.nodeType]}: ${node.data.label}${
                        needsRepair ? " (needs repair)" : ""
                    }`,
                    data: { ...node.data, needsRepair },
                };
            }),
        [nodes, availableRoutes, defaultRoute],
    );
    return (
        <div className="space-y-4">
            <form
                action={formAction}
                onSubmit={() => {
                    submittedGraph.current = graph;
                }}
                className="flex flex-wrap gap-2"
            >
                <input type="hidden" name="workflowId" value={workflow.id} />
                <input type="hidden" name="kind" value={workflow.kind} />
                <input type="hidden" name="name" value={workflow.name} />
                <input
                    type="hidden"
                    name="description"
                    value={workflow.description}
                />
                <input
                    type="hidden"
                    name="nodes"
                    value={JSON.stringify(serializedNodes)}
                />
                <input
                    type="hidden"
                    name="edges"
                    value={JSON.stringify(serializedEdges)}
                />
                <input
                    type="hidden"
                    name="finalAnswer"
                    value={JSON.stringify(finalAnswer ?? null)}
                />
                <div
                    role="group"
                    aria-label="Add block"
                    className="flex flex-wrap gap-2"
                >
                    {blockTypesFor(workflow.kind).map((type) => (
                        <Button
                            key={type}
                            type="button"
                            variant="secondary"
                            onClick={() => addNode(type)}
                        >
                            <Plus />
                            {NODE_TYPE_LABELS[type]}
                        </Button>
                    ))}
                </div>
                <span
                    aria-hidden="true"
                    data-slot="toolbar-separator"
                    className="mx-1 hidden h-10 w-px bg-border sm:block"
                />
                <Button type="button" variant="ghost" onClick={autoLayout}>
                    <LayoutGrid />
                    Auto layout
                </Button>
                <Button
                    type="submit"
                    loading={pending}
                    loadingText="Saving canvas…"
                >
                    <Save />
                    Save canvas
                </Button>
                {/* Fixed width so the toolbar doesn't reflow as it changes. */}
                <span
                    role="status"
                    className="flex h-10 w-36 items-center gap-2 text-copy-14 text-muted-foreground"
                >
                    <span
                        aria-hidden="true"
                        className={cn(
                            "size-2 shrink-0 rounded-full",
                            dirty ? "bg-eval-warning" : "bg-eval-success",
                        )}
                    />
                    {dirty ? "Unsaved changes" : "Saved"}
                </span>
            </form>
            {selectedEdge ? (
                <ConnectionPanel
                    key={selectedEdge.id}
                    edge={selectedEdge}
                    nodes={nodes}
                    onChange={(orderOnly) => {
                        setDirty(true);
                        setEdges((current) =>
                            current.map((edge) =>
                                edge.id === selectedEdge.id
                                    ? withOrderOnly(edge, orderOnly)
                                    : edge,
                            ),
                        );
                    }}
                    onClose={() => setSelectedEdgeId(undefined)}
                />
            ) : null}
            <Card className="relative h-[65vh] min-h-[480px] overflow-hidden">
                {graphError || state.formError ? (
                    // Over the canvas rather than above it, so errors don't
                    // push the canvas down.
                    <Alert
                        variant="destructive"
                        className="absolute inset-x-3 top-3 z-10 w-auto"
                    >
                        <AlertDescription>
                            {graphError ?? state.formError}
                        </AlertDescription>
                    </Alert>
                ) : null}
                {nodes.length === 0 ? (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
                        <p className="max-w-xs text-center text-copy-14 text-muted-foreground">
                            The canvas is empty. Add an Input block from the
                            toolbar, then connect the blocks that process it.
                        </p>
                    </div>
                ) : null}
                <ReactFlow
                    nodes={displayNodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    onNodesChange={(changes) => {
                        if (editsGraph(changes)) setDirty(true);
                        onNodesChange(changes);
                    }}
                    onEdgesChange={(changes) => {
                        if (editsGraph(changes)) setDirty(true);
                        onEdgesChange(changes);
                    }}
                    onConnect={onConnect}
                    onBeforeDelete={({ nodes: doomed }) =>
                        // Edges alone are cheap to redraw; removing a node
                        // (and its settings) asks first.
                        doomed.length === 0
                            ? Promise.resolve(true)
                            : new Promise<boolean>((resolve) =>
                                  setPendingNodeDelete({
                                      labels: doomed.map(
                                          (node) => node.data.label,
                                      ),
                                      resolve,
                                  }),
                              )
                    }
                    onNodeClick={(_event, node) => {
                        setSelectedEdgeId(undefined);
                        setSelected(node.id);
                    }}
                    onEdgeClick={(_event, edge) => setSelectedEdgeId(edge.id)}
                    fitView
                >
                    <Background color="var(--border)" />
                    <Controls />
                </ReactFlow>
            </Card>
            <FinalAnswerFields
                value={finalAnswer}
                steps={nodes
                    .filter(
                        (node) =>
                            node.data.nodeType !== "input" &&
                            node.data.nodeType !== "stt",
                    )
                    .map((node) => ({
                        nodeKey: node.id,
                        label: node.data.label,
                    }))}
                versions={setup.versionOptions}
                onChange={(next) => {
                    setFinalAnswer(next);
                    setDirty(true);
                }}
            />
            <UnsavedChangesGuard when={dirty} />
            <ConfirmDialog
                open={pendingNodeDelete !== undefined}
                onOpenChange={(open) => {
                    if (open) return;
                    pendingNodeDelete?.resolve(false);
                    setPendingNodeDelete(undefined);
                }}
                title={
                    pendingNodeDelete?.labels.length === 1
                        ? `Remove “${pendingNodeDelete.labels[0]}”?`
                        : `Remove ${pendingNodeDelete?.labels.length ?? 0} blocks?`
                }
                description="Their settings and connections are removed from the canvas. Save the canvas to keep the change."
                confirmLabel="Remove"
                onConfirm={() => {
                    pendingNodeDelete?.resolve(true);
                    setPendingNodeDelete(undefined);
                }}
            />
            <SttNodeInspector
                node={selectedNode}
                setup={setup}
                earlierSteps={earlierStepsOf(nodes, edges, selected)}
                llmRoutes={availableRoutes}
                projectDefault={projectDefault}
                onCreateLlmRoute={onCreateLlmRoute}
                onLoadLlmModels={onLoadLlmModels}
                onRouteCreated={(route) =>
                    setAvailableRoutes((current) => [
                        ...current.filter(
                            (candidate) => candidate.id !== route.id,
                        ),
                        route,
                    ])
                }
                onClose={() => setSelected(undefined)}
                onChange={(data) => {
                    setDirty(true);
                    setNodes((current) =>
                        current.map((node) =>
                            node.id === selected ? { ...node, data } : node,
                        ),
                    );
                }}
                onRemove={() => {
                    setNodes((current) =>
                        current.filter((node) => node.id !== selected),
                    );
                    setEdges((current) =>
                        current.filter(
                            (edge) =>
                                edge.source !== selected &&
                                edge.target !== selected,
                        ),
                    );
                    setSelected(undefined);
                    setDirty(true);
                }}
                onDuplicate={() => {
                    if (!selectedNode || selectedNode.data.nodeType !== "stt")
                        return;
                    const data = {
                        ...selectedNode.data,
                        nodeKey: `stt-${crypto.randomUUID()}`,
                        label: `${selectedNode.data.label} copy`,
                        nodeConfig: structuredClone(
                            selectedNode.data.nodeConfig,
                        ),
                    };
                    setNodes((current) => [
                        ...current,
                        {
                            ...selectedNode,
                            id: data.nodeKey,
                            data,
                            position: {
                                x: selectedNode.position.x,
                                y: selectedNode.position.y + 150,
                            },
                        },
                    ]);
                    setDirty(true);
                }}
            />
        </div>
    );
}

/** A connection switched to (or from) order-only. */
function withOrderOnly(edge: Edge, orderOnly: boolean): Edge {
    const { label: _label, style: _style, ...rest } = edge;
    const { orderOnly: _old, ...data } = (edge.data ?? {}) as ISttEdgeData;
    return canvasEdge(rest, orderOnly ? { ...data, orderOnly } : data);
}

/** Settings of the connection clicked on the canvas. */
function ConnectionPanel({
    edge,
    nodes,
    onChange,
    onClose,
}: {
    edge: Edge;
    nodes: SttCanvasNode[];
    onChange: (orderOnly: boolean) => void;
    onClose: () => void;
}) {
    const nodeOf = (key: string) => nodes.find((node) => node.id === key);
    const target = nodeOf(edge.target);
    return (
        <EdgeModeFields
            sourceLabel={nodeOf(edge.source)?.data.label ?? edge.source}
            targetLabel={target?.data.label ?? edge.target}
            orderOnly={
                (edge.data as ISttEdgeData | undefined)?.orderOnly === true
            }
            canBeOrderOnly={ORDER_ONLY_TARGETS.has(
                target?.data.nodeType ?? "prompt",
            )}
            onChange={onChange}
            onClose={onClose}
        />
    );
}

function nodeNeedsRouteRepair(
    data: SttNodeData,
    routes: IWorkflowLlmRoute[],
    defaultRoute: IWorkflowLlmRoute | undefined,
): boolean {
    if (!isWorkflowModelBackedNodeType(data.nodeType)) return false;
    const selection = data.llmExecutionSelection;
    if (!selection) return true;
    if (selection.mode === "project_default") return !defaultRoute;
    if (selection.mode === "pinned_route")
        return !routeAtVersion(routes, selection.routeVersionId);
    return false;
}

function routeAtVersion(
    routes: IWorkflowLlmRoute[],
    versionId: string | undefined,
): IWorkflowLlmRoute | undefined {
    if (!versionId) return undefined;
    for (const route of routes) {
        const versions = route.versions?.length
            ? route.versions
            : route.latestVersion
              ? [route.latestVersion]
              : [];
        const version = versions.find(
            (candidate) => candidate.id === versionId,
        );
        if (version) return { ...route, latestVersion: version };
    }
    return undefined;
}
