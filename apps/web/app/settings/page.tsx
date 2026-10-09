import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { serverApiClient } from "@/server/api/client";
import { mosaicTenancyMode } from "@/server/auth/session";
import { requireActiveProject } from "@/server/projects/activeProject";
import { ProviderKeysForm } from "./keys-form";
import { LlmRoutingForm } from "./llm-routing-form";
import { ProjectNameForm } from "./project-name-form";
import { TeamCard } from "./team-card";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
    const active = await requireActiveProject();
    const [keys, probeState, routingState] = await Promise.all([
        serverApiClient().listProviderKeys(active.teamId),
        loadRouteProbes(active.teamId, active.projectId),
        loadLlmRouting(active.teamId, active.projectId),
    ]);
    const { probes, probeNotice } = probeState;
    const routing = routingState;
    return (
        <Page>
            <PageHeader
                title="Settings"
                description="Manage stored credentials and explicit workflow routes. Credentials make providers available; routes choose how future workflow calls execute."
            />
            <div className="flex max-w-3xl flex-col gap-10">
                <ProjectNameForm
                    projectId={active.projectId}
                    workspaceId={active.workspaceId}
                    name={
                        active.projects.find(
                            (project) => project.id === active.projectId,
                        )?.name ?? ""
                    }
                />
                <ProviderKeysForm
                    keys={keys}
                    probes={probes}
                    projectId={active.projectId}
                    probeNotice={probeNotice}
                />
                <LlmRoutingForm
                    projectId={active.projectId}
                    keys={keys}
                    routes={routing.routes}
                    projectDefault={routing.projectDefault}
                    notice={routing.notice}
                />
                {mosaicTenancyMode() === "isolated" ? <TeamCard /> : null}
            </div>
        </Page>
    );
}

async function loadLlmRouting(teamId: string, projectId: string) {
    try {
        const [routes, projectDefault] = await Promise.all([
            serverApiClient().listWorkflowLlmRoutes(teamId, projectId),
            serverApiClient().getWorkflowLlmProjectDefault(teamId, projectId),
        ]);
        return {
            routes,
            projectDefault: projectDefault.default,
            notice: undefined,
        };
    } catch {
        return {
            routes: [],
            projectDefault: undefined,
            notice: "LLM routing is temporarily unavailable. Stored credentials can still be managed safely.",
        };
    }
}

async function loadRouteProbes(teamId: string, projectId: string) {
    try {
        return {
            probes: await serverApiClient().listSttRouteProbes(
                teamId,
                projectId,
            ),
            probeNotice: undefined,
        };
    } catch {
        return {
            probes: [],
            probeNotice:
                "Route verification is temporarily unavailable. Provider keys can still be managed.",
        };
    }
}
