import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, Circle, CircleCheck } from "lucide-react";
import type { IDashboardStats } from "@mosaic/api-contract";
import { EmptyState } from "@/components/layout/empty-state";
import { SectionTitle } from "@/components/layout/section-title";
import { Num } from "@/components/ui/num";
import { RelativeTime } from "@/components/ui/relative-time";
import { RunStatusBadge, RunningDot } from "@/components/ui/status-badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { RunCellsProgress, RunLinkCell } from "@/components/runs/run-row-cells";
import { serverApiClient } from "@/server/api/client";

const linkClassName =
    "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * One step per flag the API reports, so a step's label says exactly what it
 * checks and is never shown unchecked when it is done.
 */
export const setupSteps: ReadonlyArray<{
    key: string;
    label: string;
    href: Route;
    check: (stats: IDashboardStats) => boolean;
}> = [
    {
        key: "dataset",
        label: "Create a dataset and add items",
        href: "/datasets",
        check: (s) => s.hasDatasetWithItems,
    },
    {
        key: "schema",
        label: "Define a labeling schema on a dataset",
        href: "/datasets",
        check: (s) => s.hasDatasetWithSchema,
    },
    {
        key: "prompt",
        label: "Create a prompt",
        href: "/prompts",
        check: (s) => s.hasPrompt,
    },
    {
        key: "run",
        label: "Start your first run",
        href: "/runs/new",
        check: (s) => s.runCount > 0,
    },
];

/** Setup is over once the project has run an evaluation. */
export function isSetupComplete(stats: IDashboardStats) {
    return stats.runCount > 0;
}

function datasetDetail(stats: IDashboardStats): string | undefined {
    if (stats.datasetCount === 0) return undefined;
    if (!stats.hasDatasetWithItems) return "None have items yet";
    if (!stats.hasDatasetWithSchema) return "None have a labeling schema";
    return undefined;
}

export async function DashboardContent({
    teamId,
    projectId,
}: {
    teamId: string;
    projectId: string;
}) {
    const { stats, recentRuns } = await serverApiClient().getDashboard(
        teamId,
        projectId,
    );
    const setupComplete = isSetupComplete(stats);

    return (
        <>
            {setupComplete ? null : <GettingStarted stats={stats} />}
            <StatStrip stats={stats} />
            {setupComplete ? <RecentRuns recentRuns={recentRuns} /> : null}
        </>
    );
}

function GettingStarted({ stats }: { stats: IDashboardStats }) {
    return (
        <section className="flex flex-col gap-4">
            <SectionTitle>Getting started</SectionTitle>
            <ol className="divide-y divide-border border-y border-border">
                {setupSteps.map((step) => {
                    const done = step.check(stats);
                    return (
                        <li key={step.key}>
                            <Link
                                href={step.href}
                                className={`group flex items-center gap-3 py-3 ${linkClassName}`}
                            >
                                {done ? (
                                    <CircleCheck
                                        className="size-4 shrink-0 text-eval-success"
                                        aria-hidden="true"
                                    />
                                ) : (
                                    <Circle
                                        className="size-4 shrink-0 text-muted-foreground"
                                        aria-hidden="true"
                                    />
                                )}
                                <span className="sr-only">
                                    {done ? "Done:" : "To do:"}
                                </span>
                                <span
                                    className={
                                        done
                                            ? "text-copy-14 text-muted-foreground"
                                            : "text-label-14 text-on-surface group-hover:underline"
                                    }
                                >
                                    {step.label}
                                </span>
                                <ArrowRight
                                    className="ml-auto size-4 shrink-0 text-muted-foreground"
                                    aria-hidden="true"
                                />
                            </Link>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}

function StatStrip({ stats }: { stats: IDashboardStats }) {
    const items: ReadonlyArray<{
        label: string;
        href: Route;
        value: number;
        detail?: ReactNode;
    }> = [
        {
            label: "Datasets",
            href: "/datasets",
            value: stats.datasetCount,
            detail: datasetDetail(stats),
        },
        { label: "Prompts", href: "/prompts", value: stats.promptCount },
        {
            label: "Runs",
            href: "/runs",
            value: stats.runCount,
            detail:
                stats.runningCount > 0 ? (
                    <span className="inline-flex items-center gap-2 text-eval-success">
                        <RunningDot />
                        <span>
                            <Num>{stats.runningCount}</Num> running
                        </span>
                    </span>
                ) : undefined,
        },
    ];

    return (
        <ul
            aria-label="Project totals"
            className="grid divide-y divide-border border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0"
        >
            {items.map((item) => (
                <li key={item.label}>
                    <Link
                        href={item.href}
                        className={`flex h-full flex-col gap-1 py-4 transition-colors hover:bg-muted/60 sm:px-6 sm:first:pl-0 ${linkClassName}`}
                    >
                        <span className="text-copy-14 text-muted-foreground">
                            {item.label}
                        </span>
                        <span className="text-heading-20 text-on-surface">
                            <Num>{item.value}</Num>
                        </span>
                        {item.detail ? (
                            <span className="text-copy-14 text-muted-foreground">
                                {item.detail}
                            </span>
                        ) : null}
                    </Link>
                </li>
            ))}
        </ul>
    );
}

type RecentRun = Awaited<
    ReturnType<ReturnType<typeof serverApiClient>["getDashboard"]>
>["recentRuns"][number];

function RecentRuns({ recentRuns }: { recentRuns: RecentRun[] }) {
    return (
        <section className="flex flex-col gap-4">
            <SectionTitle
                actions={
                    <Link
                        href="/runs"
                        className={`text-copy-14 text-accent-text underline-offset-4 hover:underline ${linkClassName}`}
                    >
                        View all
                    </Link>
                }
            >
                Recent runs
            </SectionTitle>
            {recentRuns.length === 0 ? (
                <EmptyState
                    title="No runs yet"
                    description="Start an evaluation to compare models on one of your datasets."
                    actionLabel="Start your first evaluation"
                    actionHref="/runs/new"
                />
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Run</TableHead>
                            <TableHead>Dataset</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead align="numeric">Progress</TableHead>
                            <TableHead>Created</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {recentRuns.map((r) => (
                            <TableRow key={r.id}>
                                <TableCell>
                                    <RunLinkCell
                                        id={r.id}
                                        noteTitle={r.noteTitle}
                                    />
                                </TableCell>
                                <TableCell>{r.datasetName}</TableCell>
                                <TableCell>
                                    <RunStatusBadge status={r.status} />
                                </TableCell>
                                <TableCell
                                    align="numeric"
                                    className="whitespace-nowrap text-muted-foreground"
                                >
                                    <RunCellsProgress progress={r.progress} />
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                    <RelativeTime value={r.createdAt} />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </section>
    );
}
