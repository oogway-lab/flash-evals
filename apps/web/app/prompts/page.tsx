import Link from "next/link";
import { requireActiveProject as requirePagePrincipal } from "@/server/projects/activeProject";
import { serverApiClient } from "@/server/api/client";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { PromptsList } from "@/components/prompts/prompts-list";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
    const p = await requirePagePrincipal();
    const prompts = await serverApiClient().listPrompts(p.teamId, p.projectId);

    return (
        <Page>
            <PageHeader
                title="Prompts"
                description="Versioned prompts for model evaluation. Every result links to a specific prompt version."
                action={
                    <Link href="/prompts/new" className={buttonVariants()}>
                        New prompt
                    </Link>
                }
            />

            {prompts.length === 0 ? (
                <EmptyState
                    title="No prompts yet"
                    description="Use New prompt to create a versioned prompt for evaluation runs."
                />
            ) : (
                <PromptsList prompts={prompts} />
            )}
        </Page>
    );
}
