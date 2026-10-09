export const WORKFLOW_NODE_REPAIR_EVENT = "mosaic:repair-workflow-node";

export function requestWorkflowNodeRepair(nodeKey: string): void {
    document.dispatchEvent(
        new CustomEvent(WORKFLOW_NODE_REPAIR_EVENT, {
            detail: { nodeKey },
        }),
    );
}

export function workflowNodeKeyFromErrorPath(path: string): string | undefined {
    const match = /^nodes\.([^.]+)\./.exec(path);
    return match?.[1];
}
