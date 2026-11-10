import { notFound } from "next/navigation";
import { FlashEvalsApiError } from "@flash-evals/api-contract";
import { requireActiveProject as requirePagePrincipal } from "@/server/projects/activeProject";
import { RunComparison } from "@/components/runs/run-comparison";
import {
    decideDisagreementAction,
    loadDisagreementsAction,
    saveCellAnnotationAction,
    saveRunNoteAction,
} from "@/app/actions";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { SectionTitle } from "@/components/layout/section-title";
import { CostChart } from "@/components/runs/cost-chart";
import { goldenScoreLabel } from "@/components/runs/golden-score";
import { RunAnswer } from "@/components/runs/run-answer";
import {
    buildModelResults,
    describeRunAnswer,
    runHeading,
} from "@/components/runs/run-results";
import { RunSummary } from "@/components/runs/run-summary";
import { TaskGridWithReview } from "@/components/runs/task-grid-with-review";
import { RunDetailView } from "@/components/runs/run-detail-view";
import { RunNotes } from "@/components/runs/run-notes";
import { runNoteTitle } from "@/components/runs/run-title";
import { RunHeaderActions } from "@/components/runs/run-header-actions";
import { RetryFailedCellsForm } from "@/components/runs/retry-failed-cells-form";
import type { CellData } from "@/components/runs/types";
import { IdLabel } from "@/components/ui/id-label";
import { serverApiClient } from "@/server/api/client";
import { modelInfoFor, runModelProviders } from "@/server/runs/modelInfo";
import {
    servedByModel,
    temperatureByModel,
    thinkingByModel,
} from "@/components/runs/run-results";

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
            if (err instanceof FlashEvalsApiError && err.status === 404)
                notFound();
            throw err;
        });
    const { run, progress, models, items, cells } = detail;

    // "Run again" prefills New run with this run's dataset, prompt, and models
    // so the user can tweak (model, effort, prompt) and re-run, then compare.
    // A benchmark run lists its benchmark first: New run makes the first
    // model the reference, and the reference is the benchmark.
    const reRunModels = run.configSnapshot.benchmark
        ? [...models].sort(
              (a, b) => Number(b.isReference) - Number(a.isReference),
          )
        : models;
    const reRunModelIds = [...new Set(reRunModels.map((m) => m.modelId))];
    const reRunParams = new URLSearchParams({
        datasetId: run.datasetId,
        sourceRunId: run.id,
    });
    if (models[0]?.promptVersionId)
        reRunParams.set("promptVersionId", models[0].promptVersionId);
    if (reRunModelIds.length)
        reRunParams.set("models", reRunModelIds.join(","));
    const reRunHref = `/runs/new?${reRunParams.toString()}` as const;

    const modelInfo = await modelInfoFor(
        models.map((m) => m.modelId),
        runModelProviders(run.configSnapshot),
    );
    const results = buildModelResults({
        leaderboard: detail.leaderboard,
        comparison: detail.benchmarkComparison,
        snapshot: run.configSnapshot,
        modelInfo,
        servedBy: servedByModel(detail.cells),
        thinking: thinkingByModel(detail.cells),
        temperature: temperatureByModel(models),
    });
    const goldenLabel = goldenScoreLabel(run.configSnapshot);
    const answer = describeRunAnswer({
        results,
        leaderboard: detail.leaderboard,
        comparison: detail.benchmarkComparison,
        active: run.status === "pending" || run.status === "running",
        fieldScoreName: goldenLabel.scoreName,
    });
    const heading = runHeading({
        runId: run.id,
        results,
        context: detail.context,
    });
    // The note's first line names the run; it sits under the question the
    // run answers, next to the short ID.
    const noteTitle = runNoteTitle(detail.note?.body);

    return (
        <Page>
            <PageHeader
                title={heading}
                meta={
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-copy-14 text-muted-foreground">
                        {noteTitle && <span>{noteTitle}</span>}
                        <IdLabel id={run.id} noun="run ID" />
                    </div>
                }
                breadcrumbs={[{ label: "Runs", href: "/runs" }]}
                action={
                    <RunHeaderActions
                        runId={run.id}
                        status={run.status}
                        stopReason={run.stopReason}
                        reRunHref={reRunHref}
                    />
                }
            />

            <div className="flex flex-col gap-6">
                <RunAnswer answer={answer} />
                <RunSummary
                    progressUrl={`/api/runs/${run.id}/progress`}
                    initial={{
                        status: run.status,
                        ...(run.stopReason
                            ? { stopReason: run.stopReason }
                            : {}),
                        ...(run.error ? { error: run.error } : {}),
                        ...progress,
                    }}
                    retryAction={
                        <RetryFailedCellsForm runId={run.id} variant="stuck" />
                    }
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

            {results.length > 1 && (
                <section className="flex flex-col gap-4">
                    <SectionTitle
                        description={
                            detail.benchmarkComparison
                                ? "Each dot is a model. Higher agrees more with what it was compared with; further left is cheaper per call."
                                : `Each dot is a model. Higher is better; further left is cheaper per call. ${goldenLabel.label}: ${goldenLabel.explanation}`
                        }
                    >
                        {detail.benchmarkComparison
                            ? "Cost and agreement"
                            : `Cost and ${goldenLabel.scoreName}`}
                    </SectionTitle>
                    <CostChart
                        results={results}
                        metric={
                            detail.benchmarkComparison ? "agreement" : "golden"
                        }
                        highlightId={answer.pick?.runModelId}
                        goldenLabel={goldenLabel}
                    />
                </section>
            )}

            {detail.benchmarkComparison && run.configSnapshot.benchmark && (
                <section className="flex flex-col gap-4">
                    <SectionTitle description="Each model's result on each task, against the task's target. Click a result to see the transcripts behind it.">
                        Task by task
                    </SectionTitle>
                    <TaskGridWithReview
                        runId={run.id}
                        results={results}
                        benchmark={run.configSnapshot.benchmark}
                        loadAction={loadDisagreementsAction}
                        decideAction={decideDisagreementAction}
                    />
                </section>
            )}

            <section className="flex flex-col gap-4">
                <SectionTitle description="Sorted by cost per call, cheapest first. The matrix shows every item.">
                    Models
                </SectionTitle>
                <RunDetailView
                    results={results}
                    runStatus={run.status}
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
                        ...(c.reasoningTokens !== undefined
                            ? { reasoningTokens: c.reasoningTokens }
                            : {}),
                        ...(c.thinking ? { thinking: c.thinking } : {}),
                        annotation: c.annotation,
                        error: c.error,
                    }))}
                    scoresByCell={detail.scoresByCell}
                    audioTranscripts={detail.audioTranscripts}
                    configSnapshot={run.configSnapshot}
                    saveCellAnnotationAction={saveCellAnnotationAction}
                />
            </section>

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
