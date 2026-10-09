import { notFound } from "next/navigation";
import { MosaicApiError } from "@mosaic/api-contract";
import { requireActiveProject as requirePagePrincipal } from "@/server/projects/activeProject";
import {
    generateSchemaFromPromptAction,
    optimizePromptAction,
    saveRunnablePromptAction,
    testJudgeDraftAction,
    testPromptDraftAction,
} from "@/app/actions";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { PromptWorkbench } from "@/components/prompts/prompt-workbench";
import { serverApiClient } from "@/server/api/client";

export const dynamic = "force-dynamic";

export default async function EditPromptPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const p = await requirePagePrincipal();
    const setup = await serverApiClient()
        .getEditPromptWorkbench(p.teamId, p.projectId, id)
        .catch((err: unknown) => {
            if (err instanceof MosaicApiError && err.status === 404) notFound();
            throw err;
        });
    const prompt = setup.initialPrompt;
    if (!prompt) notFound();

    return (
        <Page>
            <PageHeader
                title="Edit prompt"
                description="Seeded from the latest version. Saving appends a new immutable version."
                breadcrumbs={[
                    { label: "Prompts", href: "/prompts" },
                    { label: prompt.name },
                ]}
            />

            <PromptWorkbench
                saveAction={saveRunnablePromptAction}
                optimizeAction={optimizePromptAction}
                testRunAction={testPromptDraftAction}
                judgeTestAction={testJudgeDraftAction}
                generateSchemaAction={generateSchemaFromPromptAction}
                tagSuggestions={setup.tagSuggestions}
                availableModels={setup.availableModels}
                modelsDegraded={setup.modelsDegraded}
                initialPrompt={prompt}
            />
        </Page>
    );
}
