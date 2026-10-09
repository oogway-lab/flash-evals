"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { TriangleAlert } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/cn";
import { NODE_TYPE_LABELS, labelFor } from "@/lib/labels";
import type { ISttGraphNodeData } from "./stt-canvas-graph";

/** Canvas-only flag, set by the canvas; never saved with the graph. */
export interface ISttFlowNodeDisplay {
    needsRepair?: boolean;
}

export function SttFlowNode({ data, selected }: NodeProps) {
    const node = data as ISttGraphNodeData & ISttFlowNodeDisplay;
    return (
        <div
            data-slot="flow-node"
            data-selected={selected || undefined}
            data-needs-repair={node.needsRepair || undefined}
            className={cn(
                "w-56 rounded-sm border bg-neutral p-3 text-on-surface transition-colors hover:bg-surface",
                node.needsRepair ? "border-eval-warning" : "border-border",
                selected && "outline-2 outline-offset-2 outline-ring",
            )}
        >
            {node.nodeType !== "input" ? (
                <Handle type="target" position={Position.Left} />
            ) : null}
            <div className="flex items-center justify-between gap-2">
                <span className="text-label-12 text-muted-foreground">
                    {labelFor(NODE_TYPE_LABELS, node.nodeType)}
                </span>
                {node.needsRepair ? (
                    <span className="inline-flex items-center gap-1 text-label-12 text-eval-warning">
                        <TriangleAlert
                            className="size-3.5"
                            aria-hidden="true"
                        />
                        Needs repair
                    </span>
                ) : null}
            </div>
            {/* Truncated with a hover hint; a selected or keyboard-focused
                node shows the whole label (see globals.css). */}
            <Hint content={node.label}>
                <p
                    data-slot="flow-node-label"
                    className={cn(
                        "pt-2 text-label-14",
                        selected ? "wrap-break-word" : "truncate",
                    )}
                >
                    {node.label}
                </p>
            </Hint>
            {!["judge", "metric_compare"].includes(node.nodeType) ? (
                <Handle type="source" position={Position.Right} />
            ) : null}
        </div>
    );
}
