"use client";

import {
    Suspense,
    use,
    useActionState,
    useEffect,
    useId,
    useRef,
    useState,
    useTransition,
} from "react";
import { ArrowRight, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { IProject, IWorkspace } from "@mosaic/api-contract";
import {
    activateProjectAction,
    createProjectAction,
    createWorkspaceAction,
    updateWorkspaceAction,
} from "@/app/actions/projects";
import { KeepFieldsOnReset } from "@/components/ui/keep-fields-on-reset";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Num } from "@/components/ui/num";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { MISSING_VALUE } from "@/lib/format";

export function WorkspaceBrowser({
    workspaces,
    projectCounts,
    selectedWorkspaceId,
}: {
    workspaces: IWorkspace[];
    /** Project count per workspace id; `undefined` when it failed to load. */
    projectCounts: Promise<Record<string, number | undefined>>;
    selectedWorkspaceId?: string;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [state, createWorkspace, creating] = useActionState(
        createWorkspaceAction,
        {},
    );

    // Keyed on the state object, not `created`: `created` stays true after the
    // first one, so a later creation would never close the dialog.
    useEffect(() => {
        if (!state.created) return;
        setOpen(false);
        router.refresh();
    }, [router, state]);

    return (
        <Page>
            <PageHeader
                title="Workspaces"
                description="Choose a workspace to see its projects, or create a new shared space for your team."
                action={
                    <Dialog open={open} onOpenChange={setOpen}>
                        <DialogTrigger render={<Button type="button" />}>
                            New workspace
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Create workspace</DialogTitle>
                            </DialogHeader>
                            <form
                                action={createWorkspace}
                                className="flex flex-col gap-4"
                            >
                                <KeepFieldsOnReset />
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="workspace-name">
                                        Workspace name
                                    </Label>
                                    <Input
                                        id="workspace-name"
                                        name="name"
                                        autoFocus
                                        required
                                    />
                                </div>
                                {state.error ? (
                                    <p
                                        role="alert"
                                        className="text-copy-14 text-error"
                                    >
                                        {state.error}
                                    </p>
                                ) : null}
                                <Button
                                    type="submit"
                                    loading={creating}
                                    loadingText="Creating…"
                                >
                                    Create workspace
                                </Button>
                            </form>
                        </DialogContent>
                    </Dialog>
                }
            />
            {workspaces.length ? (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead align="numeric">Projects</TableHead>
                            <TableHead>
                                <span className="sr-only">Actions</span>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {workspaces.map((workspace) => (
                            <WorkspaceRow
                                key={workspace.id}
                                workspace={workspace}
                                projectCounts={projectCounts}
                                selected={workspace.id === selectedWorkspaceId}
                            />
                        ))}
                    </TableBody>
                </Table>
            ) : (
                <EmptyState
                    title="No workspaces yet"
                    description="Create a shared workspace to begin organizing your team’s projects."
                />
            )}
        </Page>
    );
}

export function WorkspaceDetail({
    workspace,
    projects,
}: {
    workspace: IWorkspace;
    projects: IProject[];
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [state, createProject, creating] = useActionState(
        createProjectAction,
        {},
    );
    const [pending, startTransition] = useTransition();
    const [openingProjectId, setOpeningProjectId] = useState<string>();

    // Keyed on the state object, not `created`: `created` stays true after the
    // first one, so a later creation would never close the dialog.
    useEffect(() => {
        if (!state.created) return;
        setOpen(false);
        router.refresh();
    }, [router, state]);

    return (
        <Page>
            <PageHeader
                title={workspace.name}
                titleContent={
                    <>
                        <h1 className="sr-only">{workspace.name}</h1>
                        <WorkspaceName workspace={workspace} />
                    </>
                }
                breadcrumbs={[{ label: "Workspaces", href: "/workspaces" }]}
                description="Choose a project to open its evaluation workspace."
                action={
                    <Dialog open={open} onOpenChange={setOpen}>
                        <DialogTrigger render={<Button type="button" />}>
                            New project
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Create project</DialogTitle>
                            </DialogHeader>
                            <form
                                action={createProject}
                                className="flex flex-col gap-4"
                            >
                                <KeepFieldsOnReset />
                                <input
                                    type="hidden"
                                    name="workspaceId"
                                    value={workspace.id}
                                />
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="project-name">
                                        Project name
                                    </Label>
                                    <Input
                                        id="project-name"
                                        name="name"
                                        autoFocus
                                        required
                                    />
                                </div>
                                {state.error ? (
                                    <p
                                        role="alert"
                                        className="text-copy-14 text-error"
                                    >
                                        {state.error}
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
                }
            />
            {projects.length ? (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Project</TableHead>
                            <TableHead>
                                <span className="sr-only">Actions</span>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {projects.map((project) => (
                            <TableRow key={project.id}>
                                <TableCell className="text-label-14 text-on-surface">
                                    {project.name}
                                </TableCell>
                                <TableCell className="py-1 text-right align-middle">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        aria-label={`Open project ${project.name}`}
                                        disabled={pending}
                                        loading={
                                            pending &&
                                            openingProjectId === project.id
                                        }
                                        loadingText="Opening project…"
                                        onClick={() => {
                                            setOpeningProjectId(project.id);
                                            startTransition(async () => {
                                                const result =
                                                    await activateProjectAction(
                                                        workspace.id,
                                                        project.id,
                                                    );
                                                if (!result.ok) {
                                                    toast.error(
                                                        result.formError ??
                                                            "Couldn’t open the project.",
                                                    );
                                                    return;
                                                }
                                                router.push("/");
                                                router.refresh();
                                            });
                                        }}
                                    >
                                        Open
                                        <ArrowRight aria-hidden="true" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            ) : (
                <EmptyState
                    title="No projects in this workspace"
                    description="Create a project to start adding datasets, prompts, and evaluation runs."
                />
            )}
        </Page>
    );
}

function WorkspaceProjectCount({
    workspaceId,
    projectCounts,
}: {
    workspaceId: string;
    projectCounts: Promise<Record<string, number | undefined>>;
}) {
    const projectCount = use(projectCounts)[workspaceId];
    // A failed lookup reads as "not available" instead of a misleading 0.
    return <Num>{projectCount ?? MISSING_VALUE}</Num>;
}

function WorkspaceRow({
    workspace,
    projectCounts,
    selected,
}: {
    workspace: IWorkspace;
    projectCounts: Promise<Record<string, number | undefined>>;
    selected: boolean;
}) {
    const [renameOpen, setRenameOpen] = useState(false);

    return (
        <TableRow>
            <TableCell>
                <div className="flex flex-wrap items-baseline gap-x-2">
                    <Link
                        href={`/workspaces/${workspace.id}`}
                        className="rounded-sm text-label-14 text-on-surface hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                        {workspace.name}
                    </Link>
                    {selected ? (
                        <span className="text-copy-14 text-muted-foreground">
                            Current
                        </span>
                    ) : null}
                </div>
            </TableCell>
            <TableCell align="numeric" className="text-muted-foreground">
                <Suspense fallback={<Skeleton className="ml-auto h-5 w-6" />}>
                    <WorkspaceProjectCount
                        workspaceId={workspace.id}
                        projectCounts={projectCounts}
                    />
                </Suspense>
            </TableCell>
            <TableCell className="py-1 align-middle">
                <div className="flex items-center justify-end gap-2">
                    <Link
                        href={`/workspaces/${workspace.id}`}
                        className={buttonVariants({
                            variant: "secondary",
                            size: "sm",
                        })}
                        aria-label={`Open workspace ${workspace.name}`}
                    >
                        Open
                        <ArrowRight aria-hidden="true" />
                    </Link>
                    <RowActionsMenu name={workspace.name}>
                        <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                            Rename
                        </DropdownMenuItem>
                    </RowActionsMenu>
                    <RenameWorkspaceDialog
                        workspace={workspace}
                        open={renameOpen}
                        onOpenChange={setRenameOpen}
                    />
                </div>
            </TableCell>
        </TableRow>
    );
}

function RenameWorkspaceDialog({
    workspace,
    open,
    onOpenChange,
}: {
    workspace: IWorkspace;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const router = useRouter();
    const [state, rename, saving] = useActionState(updateWorkspaceAction, {});

    // Keyed on the state object, not `updated`: `updated` stays true after the
    // first rename, so a second rename would never close the dialog.
    useEffect(() => {
        if (!state.updated) return;
        onOpenChange(false);
        router.refresh();
    }, [onOpenChange, router, state]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Rename workspace</DialogTitle>
                </DialogHeader>
                <form action={rename} className="flex flex-col gap-4">
                    <input
                        type="hidden"
                        name="workspaceId"
                        value={workspace.id}
                    />
                    <div className="flex flex-col gap-2">
                        <Label htmlFor={`workspace-rename-${workspace.id}`}>
                            Workspace name
                        </Label>
                        <Input
                            id={`workspace-rename-${workspace.id}`}
                            name="name"
                            defaultValue={workspace.name}
                            maxLength={120}
                            autoFocus
                            required
                            aria-invalid={state.error ? true : undefined}
                        />
                    </div>
                    {state.error ? (
                        <p role="alert" className="text-copy-14 text-error">
                            {state.error}
                        </p>
                    ) : null}
                    <Button
                        type="submit"
                        loading={saving}
                        loadingText="Saving…"
                    >
                        Save workspace
                    </Button>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function WorkspaceName({ workspace }: { workspace: IWorkspace }) {
    const router = useRouter();
    const [editing, setEditing] = useState(false);
    const [state, rename, saving] = useActionState(updateWorkspaceAction, {});
    const errorId = useId();
    const nameButtonRef = useRef<HTMLButtonElement>(null);
    const returnFocus = useRef(false);
    function closeEditor() {
        returnFocus.current = true;
        setEditing(false);
    }
    // Keyed on the state object, not `updated`: `updated` stays true after the
    // first rename, so a second rename would never close the editor.
    useEffect(() => {
        if (state.updated) {
            closeEditor();
            router.refresh();
        }
    }, [router, state]);
    useEffect(() => {
        if (editing || !returnFocus.current) return;
        returnFocus.current = false;
        nameButtonRef.current?.focus();
    }, [editing]);
    if (!editing)
        return (
            <button
                ref={nameButtonRef}
                type="button"
                onClick={() => setEditing(true)}
                aria-label={`Rename workspace ${workspace.name}`}
                className="group flex min-h-11 items-center gap-2 text-left text-heading-24 text-on-surface hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
                {workspace.name}
                <Pencil
                    className="size-4 text-muted-foreground group-hover:text-on-surface"
                    aria-hidden="true"
                />
            </button>
        );
    return (
        <form
            action={rename}
            className="flex max-w-md flex-wrap items-center gap-2"
        >
            <KeepFieldsOnReset />
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <Input
                aria-label="Workspace name"
                name="name"
                defaultValue={workspace.name}
                autoFocus
                className="min-w-0 flex-1"
                maxLength={120}
                required
                aria-invalid={state.error ? true : undefined}
                aria-describedby={state.error ? errorId : undefined}
                onKeyDown={(event) => {
                    // Enter submits the form; Escape cancels.
                    if (event.key === "Escape") {
                        event.preventDefault();
                        closeEditor();
                    }
                }}
            />
            <Button
                type="submit"
                size="sm"
                loading={saving}
                loadingText="Saving…"
            >
                Save
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={closeEditor}
            >
                Cancel
            </Button>
            {state.error ? (
                <p
                    id={errorId}
                    role="alert"
                    className="basis-full text-copy-14 text-error"
                >
                    {state.error}
                </p>
            ) : null}
        </form>
    );
}
