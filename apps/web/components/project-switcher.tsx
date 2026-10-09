"use client";

import {
    useActionState,
    useEffect,
    useRef,
    useState,
    useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronsUpDown } from "lucide-react";
import type { IProject, IWorkspace } from "@mosaic/api-contract";
import {
    createProjectAction,
    switchProjectAction,
    switchWorkspaceAction,
} from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The header's "where am I" control: shows `Workspace / Project` and opens a
 * menu to switch either, create a project, or browse all workspaces.
 * Switching sends you to the dashboard of the new project, because a detail
 * page of the old project would no longer exist.
 */
export function ProjectSwitcher({
    projects,
    projectId,
    workspaces,
    workspaceId,
}: {
    projects: IProject[];
    projectId: string;
    workspaces: IWorkspace[];
    workspaceId: string;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const switchInFlight = useRef(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [createState, createAction, creating] = useActionState(
        createProjectAction,
        {},
    );

    // Keyed on the state object, not `created`: `created` stays true after the
    // first project, so a second creation would never close the dialog.
    useEffect(() => {
        if (!createState.created) return;
        setCreateOpen(false);
        router.push("/");
        router.refresh();
    }, [createState, router]);

    const workspace = workspaces.find(
        (candidate) => candidate.id === workspaceId,
    );
    const project = projects.find((candidate) => candidate.id === projectId);

    function switchTo(
        action: () => ReturnType<typeof switchWorkspaceAction>,
        failure: string,
    ) {
        // Guard synchronously as well as through `pending`: a second input can
        // arrive before React has committed the transition's pending state.
        if (switchInFlight.current || pending) return;
        switchInFlight.current = true;
        startTransition(async () => {
            try {
                const result = await action();
                if (!result.ok) {
                    toast.error(result.formError ?? failure);
                    return;
                }
                router.push("/");
                router.refresh();
            } finally {
                switchInFlight.current = false;
            }
        });
    }

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger
                    render={
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            aria-busy={pending || undefined}
                            aria-label={`Switch project. Current: ${workspace?.name ?? "workspace"}, ${project?.name ?? "project"}`}
                            className="min-w-0 max-w-[55vw] text-label-14 sm:max-w-sm"
                        />
                    }
                >
                    <span className="hidden truncate text-muted-foreground sm:inline">
                        {workspace?.name}
                    </span>
                    <span
                        className="hidden text-muted-foreground sm:inline"
                        aria-hidden="true"
                    >
                        /
                    </span>
                    <span className="truncate">{project?.name}</span>
                    <ChevronsUpDown
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                    />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuGroup>
                        <DropdownMenuLabel>Workspace</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                            value={workspaceId}
                            onValueChange={(next) => {
                                if (next === workspaceId) return;
                                switchTo(
                                    () => switchWorkspaceAction(next),
                                    "Couldn’t switch workspace.",
                                );
                            }}
                        >
                            {workspaces.map((candidate) => (
                                <DropdownMenuRadioItem
                                    key={candidate.id}
                                    value={candidate.id}
                                    disabled={pending}
                                >
                                    <span className="truncate">
                                        {candidate.name}
                                    </span>
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuLabel>Project</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                            value={projectId}
                            onValueChange={(next) => {
                                if (next === projectId) return;
                                switchTo(
                                    () => switchProjectAction(next),
                                    "Couldn’t switch project.",
                                );
                            }}
                        >
                            {projects.map((candidate) => (
                                <DropdownMenuRadioItem
                                    key={candidate.id}
                                    value={candidate.id}
                                    disabled={pending}
                                >
                                    <span className="truncate">
                                        {candidate.name}
                                    </span>
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        disabled={pending}
                        onClick={() => setCreateOpen(true)}
                    >
                        New project
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        disabled={pending}
                        render={<Link href="/workspaces" />}
                    >
                        All workspaces
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create project</DialogTitle>
                    </DialogHeader>
                    <form action={createAction} className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="project-name">Project name</Label>
                            <Input
                                id="project-name"
                                name="name"
                                autoComplete="off"
                                required
                                autoFocus
                            />
                        </div>
                        <input
                            type="hidden"
                            name="workspaceId"
                            value={workspaceId}
                        />
                        {createState.error ? (
                            <p role="alert" className="text-copy-14 text-error">
                                {createState.error}
                            </p>
                        ) : null}
                        <Button
                            type="submit"
                            loading={creating}
                            loadingText="Creating…"
                        >
                            Create project
                        </Button>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}
