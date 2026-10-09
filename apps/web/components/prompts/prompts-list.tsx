"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { IPromptListRow } from "@mosaic/api-contract";
import { MISSING_VALUE } from "@/lib/format";
import { PROMPT_KIND_LABELS } from "@/lib/labels";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Num } from "@/components/ui/num";
import { RelativeTime } from "@/components/ui/relative-time";
import { PromptStatusBadge } from "@/components/ui/status-badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { filterPrompts } from "./prompts-list-filter";
import { PromptRowActions } from "./prompt-row-actions";

export function PromptsList({ prompts }: { prompts: IPromptListRow[] }) {
    const [query, setQuery] = useState("");
    const filtered = filterPrompts(prompts, query);
    const trimmedQuery = query.trim();

    return (
        <div className="flex flex-col gap-4">
            <Input
                type="search"
                placeholder="Search by name"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="sm:w-80"
                aria-label="Search prompts by name"
            />

            {filtered.length === 0 ? (
                <EmptyState
                    variant="filter-empty"
                    title={`No prompts match “${trimmedQuery}”`}
                    description="Try a different name or clear the search."
                    action={
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setQuery("")}
                        >
                            Clear search
                        </Button>
                    }
                />
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead className="hidden sm:table-cell">
                                Kind
                            </TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead
                                align="numeric"
                                className="hidden sm:table-cell"
                            >
                                Version
                            </TableHead>
                            <TableHead className="hidden sm:table-cell">
                                Updated
                            </TableHead>
                            <TableHead className="w-12">
                                <span className="sr-only">Actions</span>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.map((prompt) => (
                            <TableRow key={prompt.id}>
                                <TableCell className="max-w-48 sm:max-w-md">
                                    <Link
                                        href={`/prompts/${prompt.id}`}
                                        className="text-label-14 text-on-surface hover:underline"
                                    >
                                        {prompt.name}
                                    </Link>
                                    <p className="text-copy-14 text-muted-foreground sm:hidden">
                                        {PROMPT_KIND_LABELS[prompt.kind]}
                                        {prompt.latest &&
                                            ` · v${prompt.latest.version}`}
                                    </p>
                                    {prompt.latest?.optimizedWithAi && (
                                        <p className="flex items-center gap-1 text-label-12 text-muted-foreground">
                                            <Sparkles
                                                className="size-3"
                                                aria-hidden
                                            />
                                            Optimized with AI
                                        </p>
                                    )}
                                    {prompt.description && (
                                        <p className="line-clamp-2 text-copy-14 text-muted-foreground">
                                            {prompt.description}
                                        </p>
                                    )}
                                </TableCell>
                                <TableCell className="hidden text-muted-foreground sm:table-cell">
                                    {PROMPT_KIND_LABELS[prompt.kind]}
                                </TableCell>
                                <TableCell>
                                    {prompt.latest ? (
                                        <PromptStatusBadge
                                            status={prompt.latest.status}
                                        />
                                    ) : (
                                        <Num>{MISSING_VALUE}</Num>
                                    )}
                                </TableCell>
                                <TableCell
                                    align="numeric"
                                    className="hidden sm:table-cell"
                                >
                                    {prompt.latest ? (
                                        `v${prompt.latest.version}`
                                    ) : (
                                        <Num>{MISSING_VALUE}</Num>
                                    )}
                                </TableCell>
                                <TableCell className="hidden text-muted-foreground sm:table-cell">
                                    {prompt.latest ? (
                                        <RelativeTime
                                            value={prompt.latest.createdAt}
                                        />
                                    ) : (
                                        <Num>{MISSING_VALUE}</Num>
                                    )}
                                </TableCell>
                                <TableCell className="text-right">
                                    <PromptRowActions
                                        promptId={prompt.id}
                                        name={prompt.name}
                                    />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
}
