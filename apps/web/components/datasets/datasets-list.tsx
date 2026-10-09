"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { IDatasetListRow } from "@mosaic/api-contract";
import { MISSING_VALUE } from "@/lib/format";
import { RelativeTime } from "@/components/ui/relative-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Num } from "@/components/ui/num";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { filterDatasets } from "./datasets-list-filter";
import { DatasetRowActions } from "./dataset-row-actions";
import { datasetTypeLabel } from "./dataset-labels";
import { Hint } from "@/components/ui/hint";
import { EmptyState } from "@/components/layout/empty-state";
import { Checkbox } from "@/components/ui/checkbox";

function LabeledCell({ dataset }: { dataset: IDatasetListRow }) {
    if (dataset.purpose === "golden") {
        return (
            <>
                {dataset.labeledItemCount} of {dataset.itemCount}
            </>
        );
    }
    return (
        <Hint content="Evaluation datasets don't need expected answers.">
            <span
                tabIndex={0}
                className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
                <Num>{MISSING_VALUE}</Num>
            </span>
        </Hint>
    );
}

export function DatasetsList({
    datasets,
    showArchived,
}: {
    datasets: IDatasetListRow[];
    showArchived: boolean;
}) {
    const router = useRouter();
    const [query, setQuery] = useState("");

    const filtered = filterDatasets(datasets, query, showArchived);
    const trimmedQuery = query.trim();

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <Input
                    type="search"
                    placeholder="Search by name"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="sm:w-80 sm:flex-none"
                    aria-label="Search datasets by name"
                />
                <label className="flex items-center gap-2 text-copy-14 text-on-surface">
                    <Checkbox
                        checked={showArchived}
                        onChange={(event) =>
                            router.push(
                                event.target.checked
                                    ? "/datasets?archived=true"
                                    : "/datasets",
                            )
                        }
                    />
                    Show archived only
                </label>
            </div>

            {filtered.length === 0 ? (
                <DatasetsEmpty
                    query={trimmedQuery}
                    onClear={() => setQuery("")}
                />
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead className="hidden sm:table-cell">
                                Type
                            </TableHead>
                            <TableHead align="numeric">Items</TableHead>
                            <TableHead align="numeric">Labeled</TableHead>
                            <TableHead className="hidden sm:table-cell">
                                Created
                            </TableHead>
                            <TableHead className="w-12">
                                <span className="sr-only">Actions</span>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.map((d) => (
                            <TableRow key={d.id}>
                                <TableCell>
                                    <Link
                                        href={`/datasets/${d.id}`}
                                        className="text-label-14 text-on-surface hover:underline"
                                    >
                                        {d.name}
                                    </Link>
                                    {d.archived && (
                                        <span className="ml-2 text-copy-14 text-muted-foreground">
                                            Archived
                                        </span>
                                    )}
                                    <p className="text-copy-14 text-muted-foreground sm:hidden">
                                        {datasetTypeLabel(d)}
                                    </p>
                                </TableCell>
                                <TableCell className="hidden text-muted-foreground sm:table-cell">
                                    {datasetTypeLabel(d)}
                                </TableCell>
                                <TableCell align="numeric">
                                    {d.itemCount}
                                </TableCell>
                                <TableCell
                                    align="numeric"
                                    className={cn(
                                        d.purpose !== "golden" &&
                                            "text-muted-foreground",
                                    )}
                                >
                                    <LabeledCell dataset={d} />
                                </TableCell>
                                <TableCell className="hidden text-muted-foreground sm:table-cell">
                                    <RelativeTime value={d.createdAt} />
                                </TableCell>
                                <TableCell className="text-right">
                                    <DatasetRowActions dataset={d} />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
}

function DatasetsEmpty({
    query,
    onClear,
}: {
    query: string;
    onClear: () => void;
}) {
    if (!query) {
        return (
            <EmptyState
                variant="filter-empty"
                title="No datasets to show"
                description="Nothing matches the current view. Toggle “Show archived only” to see other datasets."
            />
        );
    }
    return (
        <EmptyState
            variant="filter-empty"
            title={`No datasets match “${query}”`}
            description="Try a different name or clear the search."
            action={
                <Button type="button" variant="secondary" onClick={onClear}>
                    Clear search
                </Button>
            }
        />
    );
}
