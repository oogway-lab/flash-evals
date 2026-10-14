"use client";

import { useEffect, useState } from "react";
import type { IWorkflowRunDetailResponse } from "@mosaic/api-contract";

type WorkflowCell = IWorkflowRunDetailResponse["cells"][number];

/** Resolve legacy blocked errors against captured edges and the same recording. */
export function blockedByCell(
    detail: IWorkflowRunDetailResponse,
    cell: WorkflowCell,
) {
    if (cell.status !== "failed") return undefined;
    const sourceKey = /^Blocked by failed node (.+)\.$/.exec(
        cell.error ?? "",
    )?.[1];
    if (!sourceKey) return undefined;
    const nodes = detail.workflowRun.workflowSnapshot.nodes;
    const source = nodes.find((node) => node.nodeKey === sourceKey);
    const target = nodes.find((node) => node.nodeKey === cell.nodeKey);
    if (
        !source ||
        !target ||
        !detail.edges.some(
            (edge) =>
                edge.fromNodeId === source.id && edge.toNodeId === target.id,
        )
    )
        return undefined;
    const upstream = detail.cells.find(
        (candidate) =>
            candidate.nodeKey === sourceKey &&
            candidate.datasetItemId === cell.datasetItemId &&
            candidate.status === "failed",
    );
    return upstream ? { cell: upstream, label: source.label } : undefined;
}

/** Desktop and mobile render separately; focus only the currently visible row. */
export function visibleWorkflowCell(cellId: string) {
    return Array.from(
        document.querySelectorAll<HTMLElement>("[data-workflow-cell-id]"),
    ).find(
        (element) =>
            element.dataset.workflowCellId === cellId &&
            element.getClientRects().length > 0,
    );
}

export function useWorkflowCellNavigation(detail: IWorkflowRunDetailResponse) {
    const [highlightedCellId, setHighlightedCellId] = useState<string>();
    useEffect(() => {
        const sync = () => {
            const id = new URLSearchParams(window.location.hash.slice(1)).get(
                "cell",
            );
            setHighlightedCellId(
                detail.cells.some((cell) => cell.id === id)
                    ? (id ?? undefined)
                    : undefined,
            );
        };
        sync();
        window.addEventListener("hashchange", sync);
        window.addEventListener("popstate", sync);
        return () => {
            window.removeEventListener("hashchange", sync);
            window.removeEventListener("popstate", sync);
        };
    }, [detail.cells]);
    useEffect(() => {
        if (!highlightedCellId) return;
        const frame = requestAnimationFrame(() =>
            focusWorkflowCell(highlightedCellId),
        );
        return () => cancelAnimationFrame(frame);
    }, [highlightedCellId]);
    return {
        highlightedCellId,
        revealCell(id: string, href: string) {
            if (
                window.location.hash !==
                new URL(href, window.location.href).hash
            )
                window.history.pushState(null, "", href);
            setHighlightedCellId(id);
            // A repeated click still reveals a cell already highlighted in the URL.
            requestAnimationFrame(() => focusWorkflowCell(id));
        },
    };
}

function focusWorkflowCell(id: string) {
    const element = visibleWorkflowCell(id);
    element?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "instant",
    });
    element?.focus({ preventScroll: true });
}

export function BlockedCellLink({
    detail,
    cell,
    onReveal,
}: {
    detail: IWorkflowRunDetailResponse;
    cell: WorkflowCell;
    onReveal: (id: string, href: string) => void;
}) {
    const upstream = blockedByCell(detail, cell);
    if (!upstream) return null;
    const run = detail.workflowRun;
    const href = `/multiworkflow/${encodeURIComponent(run.workflowId)}/runs/${encodeURIComponent(run.id)}#cell=${encodeURIComponent(upstream.cell.id)}`;
    return (
        <span>
            Blocked by{" "}
            <a
                href={href}
                className="text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onClick={(event) => {
                    if (
                        event.button !== 0 ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey ||
                        window.location.pathname !==
                            new URL(href, window.location.href).pathname
                    )
                        return;
                    event.preventDefault();
                    onReveal(upstream.cell.id, href);
                }}
            >
                {upstream.label}
            </a>
            .
        </span>
    );
}
