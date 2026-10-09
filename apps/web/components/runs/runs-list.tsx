"use client";

import { useState } from "react";
import type { IRunListRow } from "@mosaic/api-contract";
import { fmtScore, MISSING_VALUE, shortId } from "@/lib/format";
import { RelativeTime } from "@/components/ui/relative-time";
import { deleteRunAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
    ConfirmActionDialog,
    RowActionsMenu,
} from "@/components/ui/row-actions-menu";
import { HintText } from "@/components/ui/hint";
import { Num } from "@/components/ui/num";
import { RunStatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/layout/empty-state";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { runNoteTitle } from "@/components/runs/run-title";
import { RunCellsProgress, RunLinkCell } from "@/components/runs/run-row-cells";

type Filter = "all" | "running" | "completed" | "failed";

// The run column stays pinned while the other columns scroll on narrow
// screens. The pseudo-element draws its right edge so it stays put.
const STICKY_CELL =
    "sticky left-0 z-10 bg-background after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-border";

/**
 * The row's overflow menu. Delete is the only action today, but it lives in
 * the menu (not as a visible icon) so a destructive control never competes
 * with the link to the run, and further actions have a place to go.
 */
function RunRowActions({ run }: { run: IRunListRow }) {
    const [open, setOpen] = useState(false);
    const name = runNoteTitle(run.noteTitle) ?? `run ${shortId(run.id)}`;

    return (
        <>
            <RowActionsMenu name={name}>
                <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setOpen(true)}
                >
                    Delete run
                </DropdownMenuItem>
            </RowActionsMenu>

            <ConfirmActionDialog
                open={open}
                onOpenChange={setOpen}
                title="Delete run?"
                description={`Run ${shortId(run.id)} and its model outputs, scores, notes, and annotations will be permanently deleted.`}
                confirmLabel="Delete"
                pendingLabel="Deleting…"
                action={deleteRunAction}
                fields={{ runId: run.id }}
            />
        </>
    );
}

function ModelsCell({ models }: { models: string[] }) {
    if (models.length === 0) return <Num>{MISSING_VALUE}</Num>;
    return (
        <HintText
            hint={
                <ul className="flex flex-col gap-1">
                    {models.map((model) => (
                        <li key={model} className="text-mono-13">
                            {model}
                        </li>
                    ))}
                </ul>
            }
        >
            {models.length} {models.length === 1 ? "model" : "models"}
        </HintText>
    );
}

/**
 * The top model by score. While the run is still going, a model with a few
 * cells scored can outrank a fully scored one, so the cell calls it the
 * leader. When only some models have a score the leader may also change once
 * the rest arrive, so the cell says how many it is the best of.
 */
function BestModelCell({ run }: { run: IRunListRow }) {
    const { best } = run;
    if (!best) return <Num>{MISSING_VALUE}</Num>;
    const active =
        run.status === "running" ||
        run.status === "pending" ||
        run.progress.pending > 0;
    const partial = best.scored < best.total;
    const qualifier = active
        ? partial
            ? `leading of ${best.scored} scored`
            : "leading"
        : partial
          ? `best of ${best.scored} scored`
          : undefined;
    return (
        <div className="flex min-w-0 flex-col gap-1">
            {best.tiedCount > 1 ? (
                <span className="text-muted-foreground">
                    {best.tiedCount} models tied
                </span>
            ) : (
                <span className="block max-w-56 truncate text-mono-13">
                    {best.modelId}
                </span>
            )}
            {qualifier && (
                <span className="text-label-12 text-muted-foreground">
                    {qualifier}
                </span>
            )}
        </div>
    );
}

export function RunsList({ runs }: { runs: IRunListRow[] }) {
    const [filter, setFilter] = useState<Filter>("all");

    const filtered = runs.filter((r) => {
        if (filter === "all") return true;
        if (filter === "running")
            return r.status === "running" || r.status === "pending";
        if (filter === "completed")
            return r.status === "completed" || r.status === "partial";
        return r.status === "failed";
    });

    return (
        <div className="flex flex-col gap-4">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                <TabsList className="self-start">
                    <TabsTrigger value="all">All</TabsTrigger>
                    <TabsTrigger value="running">Running</TabsTrigger>
                    <TabsTrigger value="completed">Completed</TabsTrigger>
                    <TabsTrigger value="failed">Failed</TabsTrigger>
                </TabsList>
            </Tabs>

            {filtered.length === 0 ? (
                <EmptyState
                    variant="filter-empty"
                    title="No runs match this filter"
                    description="No run has this status right now."
                    action={
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setFilter("all")}
                        >
                            Clear filter
                        </Button>
                    }
                />
            ) : (
                <Table className="min-w-max">
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                            <TableHead className={STICKY_CELL}>Run</TableHead>
                            <TableHead>Dataset</TableHead>
                            <TableHead>Models</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Best model</TableHead>
                            <TableHead align="numeric">Score</TableHead>
                            <TableHead align="numeric">Cells</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead className="w-12">
                                <span className="sr-only">Actions</span>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.map((r) => (
                            <TableRow
                                key={r.id}
                                className="group hover:bg-muted"
                            >
                                <TableCell
                                    className={cn(
                                        STICKY_CELL,
                                        "group-hover:bg-muted",
                                    )}
                                >
                                    <RunLinkCell
                                        id={r.id}
                                        noteTitle={r.noteTitle}
                                    />
                                </TableCell>
                                <TableCell>{r.datasetName}</TableCell>
                                <TableCell className="text-muted-foreground">
                                    <ModelsCell models={r.models} />
                                </TableCell>
                                <TableCell>
                                    <RunStatusBadge status={r.status} />
                                </TableCell>
                                <TableCell>
                                    <BestModelCell run={r} />
                                </TableCell>
                                <TableCell align="numeric">
                                    <Num>{fmtScore(r.best?.score)}</Num>
                                </TableCell>
                                <TableCell
                                    align="numeric"
                                    className="whitespace-nowrap text-muted-foreground"
                                >
                                    <RunCellsProgress progress={r.progress} />
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-muted-foreground">
                                    <RelativeTime value={r.createdAt} />
                                </TableCell>
                                <TableCell className="text-right">
                                    <RunRowActions run={r} />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
}
