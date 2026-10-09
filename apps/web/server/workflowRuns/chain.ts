import { validateWorkflowGraph } from "../workflows/validation";

export interface IChainNode {
    nodeKey: string;
}

export interface IChainEdge {
    fromNodeKey: string;
    toNodeKey: string;
    carryOriginalInput: boolean;
}

export function orderLinearSnapshot<T extends IChainNode>(
    nodes: T[],
    edges: IChainEdge[],
): T[] {
    const result = validateWorkflowGraph(nodes, edges);
    if (!result.ok) throw new Error(result.error);
    const byKey = new Map(nodes.map((node) => [node.nodeKey, node]));
    return result.orderedNodeKeys.map((key) => {
        const node = byKey.get(key);
        if (!node) throw new Error(`Workflow snapshot is missing node ${key}.`);
        return node;
    });
}

export function planLayers<T extends IChainNode>(
    nodes: T[],
    edges: IChainEdge[],
    options?: { allowDisconnected?: boolean },
): T[][] {
    const result = validateWorkflowGraph(nodes, edges, options);
    if (!result.ok) throw new Error(result.error);
    const byKey = new Map(nodes.map((node) => [node.nodeKey, node]));
    return result.layers.map((layer) =>
        layer.map((key) => {
            const node = byKey.get(key);
            if (!node)
                throw new Error(`Workflow snapshot is missing node ${key}.`);
            return node;
        }),
    );
}

export interface IUpstreamOutput {
    nodeKey: string;
    label: string;
    output: string;
}

export function assembleDagNodeInput(
    originalInput: string,
    inboundEdges: IChainEdge[],
    upstreamOutputs: Map<string, IUpstreamOutput>,
): string {
    if (inboundEdges.length === 0) return `<input>${originalInput}</input>`;
    const orderedEdges = [...inboundEdges].sort((left, right) =>
        left.fromNodeKey.localeCompare(right.fromNodeKey),
    );
    const sources = orderedEdges.map((edge) =>
        upstreamOutputs.get(edge.fromNodeKey),
    );
    if (sources.some((source) => !source))
        throw new Error("A workflow node is missing an upstream output.");
    if (sources.length === 1) {
        return assembleNodeInput(
            originalInput,
            sources[0]!.output,
            orderedEdges[0]!.carryOriginalInput,
        );
    }
    const labeled = sources.map(
        (source) => `<from node="${source!.label}">${source!.output}</from>`,
    );
    if (orderedEdges.some((edge) => edge.carryOriginalInput)) {
        labeled.push(`<original_input>${originalInput}</original_input>`);
    }
    return labeled.join("\n");
}

export function assembleNodeInput(
    originalInput: string,
    upstreamOutput: string | undefined,
    carryOriginalInput: boolean,
): string {
    if (upstreamOutput === undefined) return `<input>${originalInput}</input>`;
    if (!carryOriginalInput) return upstreamOutput;
    return `<upstream_output>${upstreamOutput}</upstream_output>\n<original_input>${originalInput}</original_input>`;
}
