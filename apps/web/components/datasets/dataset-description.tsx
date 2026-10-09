"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { IActionState } from "@/app/actions";
import { updateDatasetDescriptionAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const initialState: IActionState = {};

function SaveButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" size="sm" loading={pending} loadingText="Saving…">
            Save
        </Button>
    );
}

export function DatasetDescription({
    datasetId,
    description,
    editable = true,
}: {
    datasetId: string;
    description: string | null;
    editable?: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(description ?? "");
    const [state, formAction] = useActionState(
        updateDatasetDescriptionAction,
        initialState,
    );

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

    // Put focus back on the edit button after saving or cancelling.
    useEffect(() => {
        if (editing || !returnFocus.current) return;
        returnFocus.current = false;
        editButtonRef.current?.focus();
    }, [editing]);

    useEffect(() => {
        // Only resync from the prop when not mid-edit, so a background
        // revalidation can't clobber the user's in-progress draft.
        if (!editing) setDraft(description ?? "");
    }, [description, editing]);

    if (!editing) {
        // When not editable (e.g. the dataset is archived), render read-only:
        // show the description text and omit the edit affordance entirely. Skip
        // the "Add description" prompt so an archived, undescribed dataset
        // doesn't show a dangling action.
        if (!editable) {
            return description ? (
                <p className="whitespace-pre-wrap text-copy-14 text-on-surface">
                    {description}
                </p>
            ) : null;
        }
        return (
            <div className="flex flex-col items-start gap-1">
                {description && (
                    <p className="whitespace-pre-wrap text-copy-14 text-on-surface">
                        {description}
                    </p>
                )}
                <Button
                    ref={editButtonRef}
                    type="button"
                    variant="link"
                    onClick={() => setEditing(true)}
                >
                    {description ? "Edit description" : "Add description"}
                </Button>
            </div>
        );
    }

    return (
        <form action={formAction} className="flex flex-col gap-2">
            <input type="hidden" name="datasetId" value={datasetId} />
            <Textarea
                name="description"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={4}
                placeholder="What is this dataset for?"
                aria-label="Dataset description"
                aria-describedby={`dataset-description-${datasetId}-hint`}
                autoFocus
                onKeyDown={(event) => {
                    // Enter adds a line; Cmd/Ctrl+Enter saves; Escape cancels.
                    if (event.key === "Escape") {
                        event.preventDefault();
                        setDraft(description ?? "");
                        closeEditor();
                    } else if (
                        event.key === "Enter" &&
                        (event.metaKey || event.ctrlKey)
                    ) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                    }
                }}
            />
            <p
                id={`dataset-description-${datasetId}-hint`}
                className="text-label-12 text-muted-foreground"
            >
                Press ⌘/Ctrl+Enter to save, Esc to cancel.
            </p>
            {state.formError && (
                <p role="alert" className="text-copy-14 text-error">
                    {state.formError}
                </p>
            )}
            <div className="flex gap-2">
                <SaveButton />
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                        setDraft(description ?? "");
                        closeEditor();
                    }}
                >
                    Cancel
                </Button>
            </div>
        </form>
    );
}
