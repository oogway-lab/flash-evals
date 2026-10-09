import Link from "next/link";
import { notFound } from "next/navigation";
import { MosaicApiError } from "@mosaic/api-contract";
import { requireActiveProject as requirePagePrincipal } from "@/server/projects/activeProject";
import { RunComparison } from "@/components/runs/run-comparison";
import { saveCellAnnotationAction, saveRunNoteAction } from "@/app/actions";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { SectionTitle } from "@/components/layout/section-title";
import { RunSummary } from "@/components/runs/run-summary";
import { RunDetailView } from "@/components/runs/run-detail-view";
import { RunNotes } from "@/components/runs/run-notes";
import { runNoteTitle } from "@/components/runs/run-title";
import { RetryFailedCellsForm } from "@/components/runs/retry-failed-cells-form";
import type { CellData } from "@/components/runs/types";
import { buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { IdLabel } from "@/components/ui/id-label";
import { serverApiClient } from "@/server/api/client";
import { shortId } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RunPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ compareWith?: string }>;
}) {
    const { id } = await params;
    const { compareWith } = await searchParams;
    const principal = await requirePagePrincipal();
    const detail = await serverApiClient()
        .getRunDetail(principal.teamId, principal.projectId, id, {
            compareWith,
        })
        .catch((err: unknown) => {
            if (err instanceof MosaicApiError && err.status === 404) notFound();
            throw err;
        });
    const { run, progress, models, items, cells } = detail;

    // "Run again" prefills New run with this run's dataset, prompt, and models
    // so the user can tweak (model, effort, prompt) and re-run, then compare.
    const reRunModelIds = [...new Set(models.map((m) => m.modelId))];
    const reRunParams = new URLSearchParams({
        datasetId: run.datasetId,
        sourceRunId: run.id,
    });
    if (models[0]?.promptVersionId)
        reRunParams.set("promptVersionId", models[0].promptVersionId);
    if (reRunModelIds.length)
        reRunParams.set("models", reRunModelIds.join(","));
    const reRunHref = `/runs/new?${reRunParams.toString()}` as const;

    // The note's first line names the run. Without one the page is titled by
    // the short ID, and that ID (with its copy button) is shown only once.
    const noteTitle = runNoteTitle(detail.note?.body);

    return (
        <Page>
            <PageHeader
                title={noteTitle ?? `Run ${shortId(run.id)}`}
                titleContent={
                    noteTitle ? undefined : (
                        <div className="flex items-center gap-1">
                            <h1 className="text-heading-24 text-on-surface">
                                Run {shortId(run.id)}
                            </h1>
                            <CopyButton value={run.id} what="run ID" />
                        </div>
                    )
                }
                meta={
                    noteTitle ? (
                        <IdLabel id={run.id} noun="run ID" />
                    ) : undefined
                }
                breadcrumbs={[{ label: "Runs", href: "/runs" }]}
                action={
                    <div className="flex flex-col items-stretch gap-2 sm:flex-row">
                        <Link href={reRunHref} className={buttonVariants()}>
                            Rerun
                        </Link>
                        {(run.status === "partial" ||
                            run.status === "failed") && (
                            <RetryFailedCellsForm runId={run.id} />
                        )}
                    </div>
                }
            />

            <div className="flex flex-col gap-6">
                <RunSummary
                    progressUrl={`/api/runs/${run.id}/progress`}
                    initial={{ status: run.status, ...progress }}
                    leaderboard={detail.leaderboard}
                    configSnapshot={run.configSnapshot}
                    datasetId={run.datasetId}
                    createdAt={run.createdAt}
                    context={detail.context}
                />
                <RunNotes
                    runId={run.id}
                    note={detail.note}
                    saveAction={saveRunNoteAction}
                />
            </div>

            <RunDetailView
                leaderboard={detail.leaderboard}
                models={models.map((m) => ({
                    id: m.id,
                    modelId: m.modelId,
                    isReference: m.isReference,
                }))}
                items={items.map((i) => ({
                    id: i.id,
                    type: i.type,
                    inputText: i.inputText,
                    storageKey: i.storageKey,
                    mimeType: i.mimeType,
                }))}
                cells={cells.map((c) => ({
                    id: c.id,
                    datasetItemId: c.datasetItemId,
                    runModelId: c.runModelId,
                    status: c.status,
                    outputJson: c.outputJson as CellData["outputJson"],
                    latencyMs: c.latencyMs,
                    costUsd: c.costUsd,
                    promptTokens: c.promptTokens,
                    completionTokens: c.completionTokens,
                    annotation: c.annotation,
                    error: c.error,
                }))}
                scoresByCell={detail.scoresByCell}
                audioTranscripts={detail.audioTranscripts}
                configSnapshot={run.configSnapshot}
                saveCellAnnotationAction={saveCellAnnotationAction}
            />

            <section className="flex flex-col gap-4">
                <SectionTitle>Compare runs</SectionTitle>
                <RunComparison
                    comparableRuns={detail.comparableRuns}
                    baselineRunId={detail.baselineRunId}
                    comparison={detail.comparison}
                />
            </section>
        </Page>
    );
}
