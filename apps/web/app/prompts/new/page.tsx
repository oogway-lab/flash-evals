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

export default async function NewPromptPage({
    searchParams,
}: {
    searchParams: Promise<{ kind?: string; workflowNodeKey?: string }>;
}) {
    const { kind, workflowNodeKey } = await searchParams;
    const p = await requirePagePrincipal();
    const setup = await serverApiClient().getNewPromptWorkbench(
        p.teamId,
        p.projectId,
    );

    return (
        <Page>
            <PageHeader
                title="New prompt"
                description="Author a prompt, generate its output schema, test it, then save a runnable version."
                breadcrumbs={[
                    { label: "Prompts", href: "/prompts" },
                    { label: "New prompt" },
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
                initialKind={kind === "judge" ? "judge" : "eval"}
                workflowNodeKey={workflowNodeKey}
            />
        </Page>
    );
}
