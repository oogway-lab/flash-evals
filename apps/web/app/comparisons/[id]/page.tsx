import { notFound } from "next/navigation";
import { FlashEvalsApiError } from "@flash-evals/api-contract";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { SectionTitle } from "@/components/layout/section-title";
import { AutoRefresh } from "@/components/comparisons/auto-refresh";
import { CancelComparisonButton } from "@/components/comparisons/cancel-comparison-button";
import { ComparisonMembers } from "@/components/comparisons/comparison-members";
import { SetupRanking } from "@/components/comparisons/setup-ranking";
import { describeDataRules } from "@/components/stt-evals/run-settings";
import { Num } from "@/components/ui/num";
import { RunStatusBadge } from "@/components/ui/status-badge";
import { fmtCost } from "@/lib/format";
import { serverApiClient } from "@/server/api/client";
import { modelInfoFor } from "@/server/runs/modelInfo";
import { requireActiveProject } from "@/server/projects/activeProject";

export const dynamic = "force-dynamic";

export default async function SetupComparisonPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const principal = await requireActiveProject();
    const comparison = await serverApiClient()
        .getSetupComparison(principal.teamId, principal.projectId, id)
        .catch((err: unknown) => {
            if (err instanceof FlashEvalsApiError && err.status === 404)
                notFound();
            throw err;
        });
    const modelIds = [
        ...new Set([
            ...comparison.members.flatMap((m) => m.stepModels ?? []),
            ...(comparison.ranking?.rows ?? []).flatMap((row) =>
                row.kind === "pipeline" ? [] : [row.name],
            ),
        ]),
    ];
    const info = modelIds.length > 0 ? await modelInfoFor(modelIds) : {};
    const active =
        comparison.status === "pending" || comparison.status === "running";
    const rules = comparison.dataPolicy
        ? describeDataRules(comparison.dataPolicy)
        : "";
    return (
        <Page>
            <AutoRefresh active={active} />
            <PageHeader
                title="Compare setups"
                description={`Every setup on ${comparison.datasetName ?? "the dataset"}, against the model you use today.`}
                breadcrumbs={[
                    { label: "Runs", href: "/runs" },
                    { label: "Comparison" },
                ]}
                meta={
                    <span className="flex flex-wrap items-center gap-2 text-copy-14 text-muted-foreground">
                        <RunStatusBadge
                            status={comparison.status}
                            stopReason={comparison.stopReason}
                        />
                        <span>
                            Spent <Num>{fmtCost(comparison.spentUsd)}</Num>
                            {comparison.maxCostUsd !== undefined ? (
                                <>
                                    {" of the "}
                                    <Num>{fmtCost(comparison.maxCostUsd)}</Num>
                                    {" limit"}
                                </>
                            ) : (
                                ", no spend limit"
                            )}
                        </span>
                        {rules && <span>{`Data rules: ${rules}`}</span>}
                    </span>
                }
                action={
                    active && !comparison.cancelRequested ? (
                        <CancelComparisonButton setupComparisonId={id} />
                    ) : undefined
                }
            />
            {active && comparison.cancelRequested && (
                <p role="status" className="text-copy-14 text-muted-foreground">
                    Cancel requested. Calls already sent are finishing.
                </p>
            )}
            {comparison.ranking ? (
                <SetupRanking
                    ranking={comparison.ranking}
                    modelInfo={info}
                    status={comparison.status}
                />
            ) : (
                <p role="status" className="text-copy-14 text-muted-foreground">
                    The ranking appears once the eval run has a Task Map to
                    score every setup with.
                </p>
            )}
            <section
                aria-labelledby="comparison-runs"
                className="flex flex-col gap-4"
            >
                <SectionTitle
                    id="comparison-runs"
                    description="The comparison runs as one eval run and one run per pipeline. They share the spend limit; pipeline answers are scored once the eval run finishes."
                >
                    Runs
                </SectionTitle>
                <ComparisonMembers
                    members={comparison.members}
                    modelName={(modelId) => info[modelId]?.label ?? modelId}
                />
            </section>
        </Page>
    );
}
