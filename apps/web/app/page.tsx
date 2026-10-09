import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { UserFacingError } from "@/server/lib/errors";
import { requireActiveProject } from "@/server/projects/activeProject";
import { DashboardContent } from "./dashboard/dashboard-content";
import { DashboardSkeleton } from "./dashboard/dashboard-skeleton";

export const dynamic = "force-dynamic";

export const metadata = { title: "Dashboard" };

/**
 * The dashboard for the active project. A user with no workspace or project
 * yet has nothing to show here, so they go to the workspace browser to
 * create or pick one (`requireActiveProject` throws a `UserFacingError` in
 * exactly those cases).
 */
export default async function HomePage() {
    let active: Awaited<ReturnType<typeof requireActiveProject>>;
    try {
        active = await requireActiveProject();
    } catch (error) {
        if (error instanceof UserFacingError) redirect("/workspaces");
        throw error;
    }
    const project = active.projects.find(
        (candidate) => candidate.id === active.projectId,
    );

    return (
        <Page>
            <PageHeader
                title="Dashboard"
                description={project?.name}
                action={
                    <Link href="/runs/new" className={buttonVariants()}>
                        New run
                    </Link>
                }
            />
            <Suspense fallback={<DashboardSkeleton />}>
                <DashboardContent
                    teamId={active.teamId}
                    projectId={active.projectId}
                />
            </Suspense>
        </Page>
    );
}
