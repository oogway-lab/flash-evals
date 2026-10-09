"use client";

import { useActionState, useState } from "react";
import { KeepFieldsOnReset } from "@/components/ui/keep-fields-on-reset";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/layout/section-title";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TransientStatus } from "@/components/ui/transient-status";
import {
    updateProjectAction,
    type IUpdateProjectState,
} from "@/app/actions/projects";

export function ProjectNameForm({
    projectId,
    workspaceId,
    name,
}: {
    projectId: string;
    workspaceId: string;
    name: string;
}) {
    const [state, action, pending] = useActionState<
        IUpdateProjectState,
        FormData
    >(updateProjectAction, {});
    // Hides "Project title updated." once the title is edited again.
    const [editedAfter, setEditedAfter] = useState<unknown>();
    return (
        <section
            aria-labelledby="project-details-heading"
            className="flex flex-col gap-4"
        >
            <SectionTitle
                id="project-details-heading"
                description="Rename this project without changing its datasets, workflows, runs, or links."
            >
                Project details
            </SectionTitle>
            <form
                action={action}
                onChange={() => setEditedAfter(state)}
                className="flex flex-col gap-4"
            >
                <KeepFieldsOnReset />
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <div className="flex flex-col gap-2">
                    <Label htmlFor="project-name">Project title</Label>
                    <Input
                        id="project-name"
                        name="name"
                        defaultValue={name}
                        maxLength={120}
                        required
                    />
                </div>
                {state.error && (
                    <p role="alert" className="text-copy-14 text-error">
                        {state.error}
                    </p>
                )}
                <TransientStatus
                    token={state.updated ? state : undefined}
                    dismissed={editedAfter === state}
                >
                    Project title updated.
                </TransientStatus>
                <Button
                    type="submit"
                    className="self-start"
                    loading={pending}
                    loadingText="Saving…"
                >
                    Save title
                </Button>
            </form>
        </section>
    );
}
