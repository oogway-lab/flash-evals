"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil } from "lucide-react";
import type { IActionState } from "@/app/actions";
import { updateDatasetNameAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Hint } from "@/components/ui/hint";

const initialState: IActionState = {};

function SaveNameButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" size="sm" loading={pending} loadingText="Saving…">
            Save
        </Button>
    );
}

export function DatasetName({
    datasetId,
    name,
    editable = true,
}: {
    datasetId: string;
    name: string;
    editable?: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(name);
    const [state, formAction] = useActionState(
        updateDatasetNameAction,
        initialState,
    );
    const nameError = state.fieldErrors?.name?.[0];
    const editButtonRef = useRef<HTMLButtonElement>(null);
    const returnFocus = useRef(false);

    function closeEditor() {
        returnFocus.current = true;
        setEditing(false);
    }

    // Key on resetKey (fresh per successful save), not ok: ok stays true after
    // the first save, so the editor would never close on later saves.
    useEffect(() => {
        if (state.ok) closeEditor();
    }, [state.ok, state.resetKey]);

    // Put focus back on the pencil after saving or cancelling.
    useEffect(() => {
        if (editing || !returnFocus.current) return;
        returnFocus.current = false;
        editButtonRef.current?.focus();
    }, [editing]);

    useEffect(() => {
        if (!editing) setDraft(name);
    }, [editing, name]);

    if (!editing) {
        return (
            <div className="group flex items-center gap-2">
                <h1 className="text-heading-24 text-on-surface">{name}</h1>
                {editable && (
                    <Hint content="Edit name">
                        <Button
                            ref={editButtonRef}
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-on-surface"
                            onClick={() => setEditing(true)}
                            aria-label="Edit dataset name"
                        >
                            <Pencil className="size-4" aria-hidden="true" />
                        </Button>
                    </Hint>
                )}
            </div>
        );
    }

    const errorId = nameError ? `dataset-name-${datasetId}-error` : undefined;
    return (
        <form action={formAction} className="flex max-w-xl flex-col gap-2">
            {/* The page heading stays in the outline while editing. */}
            <h1 className="sr-only">{name}</h1>
            <input type="hidden" name="datasetId" value={datasetId} />
            {/* One 40px row, the same height as the heading row it replaces. */}
            <div className="flex items-center gap-2">
                <Input
                    name="name"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        // Enter submits the form; Escape cancels.
                        if (event.key === "Escape") {
                            event.preventDefault();
                            setDraft(name);
                            closeEditor();
                        }
                    }}
                    aria-label="Dataset name"
                    aria-describedby={errorId}
                    invalid={Boolean(nameError)}
                    className="min-w-0 flex-1 sm:w-80 sm:flex-none"
                    autoFocus
                />
                <SaveNameButton />
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                        setDraft(name);
                        closeEditor();
                    }}
                >
                    Cancel
                </Button>
            </div>
            {nameError && (
                <p
                    id={errorId}
                    role="alert"
                    className="text-copy-14 text-error"
                >
                    {nameError}
                </p>
            )}
            {state.formError && (
                <p role="alert" className="text-copy-14 text-error">
                    {state.formError}
                </p>
            )}
        </form>
    );
}
