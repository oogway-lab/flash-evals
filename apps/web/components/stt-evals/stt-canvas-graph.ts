import type { Edge, Node } from "@xyflow/react";
import type { WorkflowNodeType } from "@mosaic/api-contract";

export interface ISttGraphNodeData extends Record<string, unknown> {
    nodeKey: string;
    label: string;
    nodeType: WorkflowNodeType;
}

export function validateSttGraphConnection(
    nodes: Array<Node<ISttGraphNodeData>>,
    edges: Array<Pick<Edge, "source" | "target">>,
    source: string,
    target: string,
    rootType: "input" | "stt" = "input",
): string | undefined {
    if (source === target) return "A node cannot connect to itself.";
    const targetNode = nodes.find((node) => node.id === target);
    if (targetNode?.data.nodeType === rootType)
        return rootType === "input"
            ? "Input nodes must remain branch roots."
            : "STT nodes must remain branch roots.";
    const proposed = [...edges, { source, target }];
    const outgoing = new Map<string, string[]>();
    for (const edge of proposed)
        outgoing.set(edge.source, [
            ...(outgoing.get(edge.source) ?? []),
            edge.target,
        ]);
    const stack = [target];
    const seen = new Set<string>();
    while (stack.length) {
        const key = stack.pop()!;
        if (key === source) return "That connection would create a cycle.";
        if (seen.has(key)) continue;
        seen.add(key);
        stack.push(...(outgoing.get(key) ?? []));
    }

    const rootsByNode = new Map<string, Set<string>>();
    for (const node of nodes)
        if (node.data.nodeType === rootType)
            rootsByNode.set(node.id, new Set([node.id]));
    for (let pass = 0; pass < nodes.length; pass += 1)
        for (const edge of proposed) {
            const targetRoots =
                rootsByNode.get(edge.target) ?? new Set<string>();
            for (const root of rootsByNode.get(edge.source) ?? [])
                targetRoots.add(root);
            rootsByNode.set(edge.target, targetRoots);
        }
    if ([...rootsByNode.values()].some((roots) => roots.size > 1))
        return rootType === "input"
            ? "Each node must belong to exactly one input root branch."
            : "Each node must belong to exactly one STT root branch.";
    return undefined;
}
