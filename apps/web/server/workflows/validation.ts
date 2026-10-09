export interface IWorkflowGraphNode {
    nodeKey: string;
}

export interface IWorkflowGraphEdge {
    fromNodeKey: string;
    toNodeKey: string;
}

export type WorkflowValidationResult =
    | { ok: true; orderedNodeKeys: string[]; layers: string[][] }
    | { ok: false; error: string };

interface IWorkflowGraph {
    inbound: Map<string, number>;
    outbound: Map<string, string[]>;
    adjacent: Map<string, string[]>;
}

type NodeKeyValidationResult =
    { ok: true; keys: Set<string> } | { ok: false; error: string };

type GraphBuildResult =
    { ok: true; graph: IWorkflowGraph } | { ok: false; error: string };

function validateNodeKeys(
    nodes: IWorkflowGraphNode[],
): NodeKeyValidationResult {
    if (nodes.length === 0) {
        return { ok: false, error: "Add at least one workflow node." };
    }

    const keys = new Set(nodes.map((node) => node.nodeKey));
    if (
        keys.size !== nodes.length ||
        [...keys].some((key) => key.trim() === "")
    ) {
        return {
            ok: false,
            error: "Workflow node keys must be unique and non-empty.",
        };
    }

    return { ok: true, keys };
}

function createNeighborMap(keys: Set<string>): Map<string, string[]> {
    return new Map([...keys].map((key) => [key, []]));
}

function buildGraph(
    keys: Set<string>,
    edges: IWorkflowGraphEdge[],
): GraphBuildResult {
    const inbound = new Map([...keys].map((key) => [key, 0]));
    const outbound = createNeighborMap(keys);
    const adjacent = createNeighborMap(keys);
    const edgeKeys = new Set<string>();

    for (const edge of edges) {
        if (!keys.has(edge.fromNodeKey) || !keys.has(edge.toNodeKey)) {
            return {
                ok: false,
                error: "Every workflow edge must reference an existing node.",
            };
        }

        const edgeKey = `${edge.fromNodeKey}\u0000${edge.toNodeKey}`;
        if (edgeKeys.has(edgeKey)) {
            return {
                ok: false,
                error: "Duplicate directed workflow edges are not allowed.",
            };
        }

        edgeKeys.add(edgeKey);
        inbound.set(edge.toNodeKey, (inbound.get(edge.toNodeKey) ?? 0) + 1);
        outbound.get(edge.fromNodeKey)?.push(edge.toNodeKey);
        adjacent.get(edge.fromNodeKey)?.push(edge.toNodeKey);
        adjacent.get(edge.toNodeKey)?.push(edge.fromNodeKey);
    }

    return { ok: true, graph: { inbound, outbound, adjacent } };
}

function topologicallyLayer(
    keys: Set<string>,
    graph: IWorkflowGraph,
): WorkflowValidationResult {
    const roots = [...keys].filter((key) => graph.inbound.get(key) === 0);
    if (roots.length === 0) {
        return { ok: false, error: "Workflow cycles are not allowed." };
    }

    const remainingInbound = new Map(graph.inbound);
    const layers: string[][] = [];
    const orderedNodeKeys: string[] = [];
    let ready = roots;

    while (ready.length > 0) {
        const layer = ready;
        const next: string[] = [];
        layers.push(layer);
        orderedNodeKeys.push(...layer);

        for (const key of layer) {
            for (const child of graph.outbound.get(key) ?? []) {
                const count = (remainingInbound.get(child) ?? 0) - 1;
                remainingInbound.set(child, count);
                if (count === 0) next.push(child);
            }
        }
        ready = next;
    }

    return orderedNodeKeys.length === keys.size
        ? { ok: true, orderedNodeKeys, layers }
        : { ok: false, error: "Workflow cycles are not allowed." };
}

function isConnected(
    keys: Set<string>,
    adjacent: Map<string, string[]>,
): boolean {
    const connected = new Set<string>();
    const pending = [[...keys][0]!];

    while (pending.length > 0) {
        const key = pending.pop()!;
        if (connected.has(key)) continue;
        connected.add(key);
        pending.push(...(adjacent.get(key) ?? []));
    }

    return connected.size === keys.size;
}

export function validateWorkflowGraph(
    nodes: IWorkflowGraphNode[],
    edges: IWorkflowGraphEdge[],
    options: { allowDisconnected?: boolean } = {},
): WorkflowValidationResult {
    const nodeKeyResult = validateNodeKeys(nodes);
    if (!nodeKeyResult.ok) return nodeKeyResult;

    const graphResult = buildGraph(nodeKeyResult.keys, edges);
    if (!graphResult.ok) return graphResult;

    const layeredResult = topologicallyLayer(
        nodeKeyResult.keys,
        graphResult.graph,
    );
    if (!layeredResult.ok) return layeredResult;

    if (
        !options.allowDisconnected &&
        !isConnected(nodeKeyResult.keys, graphResult.graph.adjacent)
    ) {
        return {
            ok: false,
            error: "Workflow nodes must form one connected graph.",
        };
    }

    return layeredResult;
}
