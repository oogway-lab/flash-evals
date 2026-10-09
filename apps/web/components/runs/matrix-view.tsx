"use client";

import {
    useCallback,
    useMemo,
    useOptimistic,
    useState,
    useTransition,
} from "react";
import { toast } from "sonner";
import { ArrowRight, Check, CircleAlert, MessageSquare } from "lucide-react";
import type {
    IMatrixCellScore,
    IRunConfigSnapshot,
} from "@mosaic/api-contract";
import {
    MISSING_VALUE,
    formatCostColumn,
    fmtLatency,
    fmtTokens,
    sumTokens,
} from "@/lib/format";
import { Num } from "@/components/ui/num";
import { Skeleton } from "@/components/ui/skeleton";
import {
    CellStatusBadge,
    isCellInFlight,
    ReviewVerdictBadge,
} from "@/components/ui/status-badge";
import { ScorePill } from "@/components/ui/score-pill";
import { Button } from "@/components/ui/button";
import { ClampedText } from "@/components/ui/clamped-text";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/layout/empty-state";
import { cn } from "@/lib/cn";
import { CellDrawer } from "@/components/runs/cell-drawer";
import { ImagePreview } from "@/components/runs/image-preview";
import {
    type ModelCol,
    type ItemRow,
    type CellData,
    type DrawerPayload,
    type ReviewVerdict,
    type SaveCellAnnotationAction,
} from "@/components/runs/types";
import { sttVariantDisplay } from "./stt-variant-display";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

type ReviewFilter = "all" | "approved" | "issue" | "failed";

const reviewFilters: { value: ReviewFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "approved", label: "Approved" },
    { value: "issue", label: "Issue" },
    { value: "failed", label: "Failed" },
];

export function MatrixView({
    models,
    items,
    cells,
    scoresByCell,
    saveCellAnnotationAction,
    configSnapshot = {},
}: {
    models: ModelCol[];
    items: ItemRow[];
    cells: CellData[];
    scoresByCell: Record<string, IMatrixCellScore[]>;
    saveCellAnnotationAction: SaveCellAnnotationAction;
    configSnapshot?: IRunConfigSnapshot;
}) {
    const [drawerKey, setDrawerKey] = useState<{
        itemId: string;
        runModelId: string;
    } | null>(null);
    const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");

    const cellByKey = useMemo(() => {
        const map = new Map<string, CellData>();
        for (const c of cells) {
            map.set(`${c.datasetItemId}:${c.runModelId}`, c);
        }
        return map;
    }, [cells]);
    const cellFor = useCallback(
        (itemId: string, runModelId: string) =>
            cellByKey.get(`${itemId}:${runModelId}`),
        [cellByKey],
    );
    const itemById = useMemo(
        () => new Map(items.map((item) => [item.id, item])),
        [items],
    );
    const modelById = useMemo(
        () => new Map(models.map((model) => [model.id, model])),
        [models],
    );
    const drawer = useMemo<DrawerPayload | null>(() => {
        if (!drawerKey) return null;

        const cell = cellByKey.get(
            `${drawerKey.itemId}:${drawerKey.runModelId}`,
        );
        const item = itemById.get(drawerKey.itemId);
        const model = modelById.get(drawerKey.runModelId);

        if (!cell || !item || !model) return null;

        return {
            cell,
            item,
            model,
            scores: scoresByCell[cell.id] ?? [],
        };
    }, [cellByKey, drawerKey, itemById, modelById, scoresByCell]);
    const reviewSummary = useMemo(() => {
        const summary = {
            total: cells.length,
            reviewed: 0,
            unreviewed: 0,
            approved: 0,
            needs_review: 0,
            issue: 0,
            failed: 0,
        };

        for (const cell of cells) {
            if (cell.status === "failed") summary.failed += 1;
            const verdict = cell.annotation?.verdict ?? "unreviewed";
            summary[verdict] += 1;
            if (verdict !== "unreviewed") summary.reviewed += 1;
        }

        return summary;
    }, [cells]);
    const filteredItems = useMemo(() => {
        if (reviewFilter === "all") return items;

        return items.filter((item) =>
            models.some((model) => {
                const cell = cellFor(item.id, model.id);
                if (!cell) return false;
                if (reviewFilter === "failed") return cell.status === "failed";
                return (
                    (cell.annotation?.verdict ?? "unreviewed") === reviewFilter
                );
            }),
        );
    }, [items, models, reviewFilter, cellFor]);
    const drawerKeys = useMemo(
        () =>
            filteredItems.flatMap((item) =>
                models
                    .filter((model) => cellFor(item.id, model.id))
                    .map((model) => ({
                        itemId: item.id,
                        runModelId: model.id,
                    })),
            ),
        [filteredItems, models, cellFor],
    );
    const drawerIndex = drawerKey
        ? drawerKeys.findIndex(
              (key) =>
                  key.itemId === drawerKey.itemId &&
                  key.runModelId === drawerKey.runModelId,
          )
        : -1;
    const previousDrawerKey =
        drawerIndex > 0 ? drawerKeys[drawerIndex - 1] : undefined;
    const nextDrawerKey =
        drawerIndex >= 0 && drawerIndex < drawerKeys.length - 1
            ? drawerKeys[drawerIndex + 1]
            : undefined;

    // One unit and precision for every cost in the grid.
    const fmtCostValue = formatCostColumn(cells.map((cell) => cell.costUsd));

    return (
        <div className="flex flex-col gap-3">
            <Card
                variant="inset"
                className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
                <div>
                    <p className="text-label-14 text-on-surface tabular-nums">
                        {reviewSummary.reviewed} / {reviewSummary.total} cells
                        reviewed
                    </p>
                    <p className="text-copy-14 text-muted-foreground tabular-nums">
                        {reviewSummary.issue} issue · {reviewSummary.failed}{" "}
                        failed
                    </p>
                </div>
                <Tabs
                    value={reviewFilter}
                    onValueChange={(v) => setReviewFilter(v as ReviewFilter)}
                >
                    <TabsList aria-label="Filter matrix by review status">
                        {reviewFilters.map((filter) => (
                            <TabsTrigger
                                key={filter.value}
                                value={filter.value}
                            >
                                {filter.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            </Card>

            <Table
                containerClassName="max-h-[75dvh] rounded-sm border border-border"
                className="min-w-[800px] border-separate border-spacing-0"
            >
                <TableHeader className="sticky top-0 z-20">
                    <TableRow className="hover:bg-transparent">
                        <TableHead className="sticky left-0 z-30 h-auto min-w-[180px] border-r border-b border-border bg-muted py-3 align-top">
                            Item
                        </TableHead>
                        {models.map((m) => (
                            <TableHead
                                key={m.id}
                                className={cn(
                                    "h-auto min-w-[200px] border-b border-border py-3 align-top",
                                    m.isReference
                                        ? "border-l-2 border-l-eval-ref bg-eval-ref-muted text-eval-ref"
                                        : "bg-muted",
                                )}
                            >
                                <div className="flex flex-wrap items-start gap-2">
                                    <MatrixModelDisplay
                                        modelId={m.modelId}
                                        snapshot={configSnapshot}
                                    />
                                    {m.isReference && (
                                        <Badge variant="ref">Reference</Badge>
                                    )}
                                </div>
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {filteredItems.map((item) => (
                        <TableRow
                            key={item.id}
                            className="hover:bg-transparent"
                        >
                            <TableCell className="sticky left-0 z-10 border-r border-b border-border bg-neutral">
                                <MatrixItemPreview item={item} />
                            </TableCell>
                            {models.map((m) => {
                                const cell = cellFor(item.id, m.id);
                                return (
                                    <TableCell
                                        key={m.id}
                                        className={cn(
                                            "border-b border-border p-2",
                                            m.isReference &&
                                                "bg-eval-ref-muted/30",
                                        )}
                                    >
                                        {cell ? (
                                            <MatrixCell
                                                cell={cell}
                                                scores={
                                                    scoresByCell[cell.id] ?? []
                                                }
                                                fmtCostValue={fmtCostValue}
                                                saveCellAnnotationAction={
                                                    saveCellAnnotationAction
                                                }
                                                onOpen={() =>
                                                    setDrawerKey({
                                                        itemId: item.id,
                                                        runModelId: m.id,
                                                    })
                                                }
                                            />
                                        ) : (
                                            <Num>{MISSING_VALUE}</Num>
                                        )}
                                    </TableCell>
                                );
                            })}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            {filteredItems.length === 0 && (
                <>
                    {items.length === 0 ? (
                        <EmptyState
                            variant="filter-empty"
                            title="No items in this run"
                            description="This run has no dataset items, so there are no cells to review."
                        />
                    ) : (
                        <EmptyState
                            variant="filter-empty"
                            title="No items match this filter"
                            description="No item has a cell with this review status."
                            action={
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => setReviewFilter("all")}
                                >
                                    Clear filter
                                </Button>
                            }
                        />
                    )}
                </>
            )}

            <CellDrawer
                open={drawer !== null}
                onClose={() => setDrawerKey(null)}
                data={drawer}
                modelDisplayName={
                    drawer
                        ? sttVariantDisplay(
                              configSnapshot,
                              drawer.model.modelId,
                          )?.label
                        : undefined
                }
                saveCellAnnotationAction={saveCellAnnotationAction}
                onPrevious={
                    previousDrawerKey
                        ? () => setDrawerKey(previousDrawerKey)
                        : undefined
                }
                onNext={
                    nextDrawerKey
                        ? () => setDrawerKey(nextDrawerKey)
                        : undefined
                }
            />
        </div>
    );
}

function MatrixItemPreview({ item }: { item: ItemRow }) {
    return (
        <div className="flex flex-col gap-2">
            {isImageItem(item) && item.storageKey && (
                <ImagePreview
                    storageKey={item.storageKey}
                    alt={item.inputText ?? "Dataset item"}
                    className="w-28"
                />
            )}
            {isAudioItem(item) && item.storageKey && (
                <p className="text-label-12 text-muted-foreground">Audio</p>
            )}
            {item.inputText && (
                <p className="line-clamp-3 text-copy-14 text-on-surface">
                    {item.inputText}
                </p>
            )}
            {!item.storageKey && !item.inputText && (
                <p className="text-copy-14 text-muted-foreground">No preview</p>
            )}
        </div>
    );
}

function MatrixCell({
    cell,
    scores,
    fmtCostValue,
    saveCellAnnotationAction,
    onOpen,
}: {
    cell: CellData;
    scores: IMatrixCellScore[];
    fmtCostValue: ReturnType<typeof formatCostColumn>;
    saveCellAnnotationAction: SaveCellAnnotationAction;
    onOpen: () => void;
}) {
    const judge = scores.find((s) => s.scorerType === "judge");
    const total = sumTokens(cell.promptTokens, cell.completionTokens);
    const inFlight = isCellInFlight(cell.status);
    const verdict = cell.annotation?.verdict ?? "unreviewed";

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                <CellStatusBadge status={cell.status} />
                {inFlight ? (
                    // latency · tokens · cost, once the cell finishes
                    <Skeleton className="h-5 w-32" />
                ) : (
                    <span className="text-copy-14 text-muted-foreground tabular-nums">
                        {fmtLatency(cell.latencyMs)} · {fmtTokens(total)} tok ·{" "}
                        {fmtCostValue(cell.costUsd)}
                    </span>
                )}
                {verdict !== "unreviewed" && (
                    <ReviewVerdictBadge verdict={verdict} />
                )}
                {cell.annotation?.comment && (
                    <span className="inline-flex items-center gap-1 text-copy-14 text-muted-foreground">
                        <MessageSquare
                            className="size-3.5"
                            aria-hidden="true"
                        />
                        <span className="sr-only">Has reviewer comment</span>
                        Note
                    </span>
                )}
            </div>
            {cell.error ? (
                <ClampedText className="text-copy-14 text-eval-danger">
                    {cell.error}
                </ClampedText>
            ) : inFlight ? (
                // judge score pill
                <Skeleton className="h-5 w-16" />
            ) : (
                <div className="flex flex-wrap gap-1">
                    <ScorePill score={judge?.score} label="judge" />
                </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                <QuickReview
                    cell={cell}
                    saveCellAnnotationAction={saveCellAnnotationAction}
                />
                <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="gap-1 text-copy-14"
                    onClick={onOpen}
                >
                    View details
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                </Button>
            </div>
        </div>
    );
}

function MatrixModelDisplay({
    modelId,
    snapshot,
}: {
    modelId: string;
    snapshot: IRunConfigSnapshot;
}) {
    const variant = sttVariantDisplay(snapshot, modelId);
    if (!variant) return <span className="text-mono-13">{modelId}</span>;
    return (
        <div className="flex flex-col gap-1">
            <span>{variant.label}</span>
            <span className="text-mono-13 text-muted-foreground">
                {variant.baseModelId}
            </span>
            {variant.diffBadges.length > 0 && (
                <span className="text-label-12 text-muted-foreground">
                    {variant.diffBadges.join(" · ")}
                </span>
            )}
        </div>
    );
}

function isAudioItem(item: ItemRow): boolean {
    return (
        item.type === "audio" || item.mimeType?.startsWith("audio/") === true
    );
}

function isImageItem(item: ItemRow): boolean {
    return Boolean(item.storageKey && !isAudioItem(item));
}

// Inline approve/issue controls that save a verdict without opening the drawer.
// Preserves any existing comment so a quick verdict change does not wipe notes.
function QuickReview({
    cell,
    saveCellAnnotationAction,
}: {
    cell: CellData;
    saveCellAnnotationAction: SaveCellAnnotationAction;
}) {
    const [isPending, startTransition] = useTransition();
    // Show the new verdict immediately; it reverts on its own if the save fails.
    const [current, setOptimisticVerdict] = useOptimistic<ReviewVerdict>(
        cell.annotation?.verdict ?? "unreviewed",
    );

    const setVerdict = (verdict: ReviewVerdict) => {
        const next = current === verdict ? "unreviewed" : verdict;
        const formData = new FormData();
        formData.set("runCellId", cell.id);
        formData.set("verdict", next);
        formData.set("comment", cell.annotation?.comment ?? "");
        startTransition(async () => {
            setOptimisticVerdict(next);
            const result = await saveCellAnnotationAction(formData);
            if (!result.ok) {
                toast.error(result.formError ?? "Couldn’t save the review.");
            }
        });
    };

    const options: {
        value: ReviewVerdict;
        label: string;
        icon: typeof Check;
    }[] = [
        { value: "approved", label: "Approve", icon: Check },
        { value: "issue", label: "Issue", icon: CircleAlert },
    ];

    return (
        <div
            role="group"
            aria-label="Quick review"
            className="flex items-center gap-1"
        >
            {options.map((option) => {
                const Icon = option.icon;
                const selected = current === option.value;
                return (
                    <Button
                        key={option.value}
                        type="button"
                        size="sm"
                        variant={selected ? "default" : "secondary"}
                        aria-pressed={selected}
                        aria-label={`Mark ${option.label.toLowerCase()}`}
                        disabled={isPending}
                        onClick={() => setVerdict(option.value)}
                    >
                        <Icon className="size-3.5" aria-hidden="true" />
                        {option.label}
                    </Button>
                );
            })}
        </div>
    );
}
