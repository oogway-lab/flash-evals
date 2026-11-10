import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { requireActiveProject as requirePagePrincipal } from "@/server/projects/activeProject";
import { serverApiClient } from "@/server/api/client";
import {
    createRunAction,
    generateJudgeForRunAction,
    proposeBenchmarkTaskMapAction,
} from "@/app/actions";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { NewRunForm } from "@/components/runs/new-run-form";
import { BifrostModelListNotice } from "@/components/runs/bifrost-model-list-notice";

export const dynamic = "force-dynamic";

export default async function NewRunPage({
    searchParams,
}: {
    searchParams: Promise<{
        datasetId?: string;
        promptVersionId?: string;
        models?: string;
        sourceRunId?: string;
    }>;
}) {
    const {
        datasetId,
        promptVersionId,
        models: modelsParam,
        sourceRunId,
    } = await searchParams;
    const defaultModels = modelsParam
        ? modelsParam
              .split(",")
              .map((m) => m.trim())
              .filter(Boolean)
        : undefined;
    const p = await requirePagePrincipal();
    const client = serverApiClient();
    const [setup, sourceRun] = await Promise.all([
        client.getRunSetup(p.teamId, p.projectId),
        sourceRunId
            ? client.getRunDetail(p.teamId, p.projectId, sourceRunId)
            : undefined,
    ]);

    return (
        <Page>
            <PageHeader
                title="New run"
                description="Pair a dataset with a prompt and models, then launch evaluation. Checking whether a cheaper model or a pipeline can replace the one you use? Compare setups is quicker."
                breadcrumbs={[
                    { label: "Runs", href: "/runs" },
                    { label: "New run" },
                ]}
                action={
                    <Link
                        href="/runs/compare"
                        className={buttonVariants({ variant: "secondary" })}
                    >
                        Compare setups
                    </Link>
                }
            />

            <BifrostModelListNotice error={setup.bifrostModelListError} />
            <NewRunForm
                datasets={setup.datasets}
                bundles={setup.bundles}
                versionOptions={setup.versionOptions}
                availableModels={setup.availableModels}
                modelsDegraded={setup.modelsDegraded}
                savedKeyProviders={setup.savedKeyProviders}
                sttModels={setup.sttModels}
                defaultDatasetId={datasetId}
                defaultPromptVersionId={promptVersionId}
                defaultModels={defaultModels}
                sourceRunId={sourceRunId}
                initialRunConfig={sourceRun?.run.configSnapshot}
                hasPrompt={setup.hasPrompt}
                judgePrompts={setup.judgePrompts}
                createRunAction={createRunAction}
                generateJudgeAction={generateJudgeForRunAction}
                proposeTaskMapAction={proposeBenchmarkTaskMapAction}
            />
        </Page>
    );
}
