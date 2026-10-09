"use client";

import { useActionState } from "react";
import type { IActionState } from "@/app/actions/types";
import { useActionToast } from "@/components/layout/use-action-toast";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { KeepFieldsOnReset } from "@/components/ui/keep-fields-on-reset";
import { SubmitButton } from "@/components/ui/submit-button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RelativeTime } from "@/components/ui/relative-time";

export interface IRunNoteView {
    body: string;
    updatedAt: Date | string;
    updatedBy: string | null;
}

/**
 * Editing the run note sits behind a disclosure: the note's first line is
 * already the page title, so the form only needs to be there on demand. The
 * content stays mounted while closed so an unsaved draft survives.
 */
export function RunNotes({
    runId,
    note,
    saveAction,
}: {
    runId: string;
    note?: IRunNoteView;
    saveAction: (
        state: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
}) {
    const [state, formAction] = useActionState(saveAction, {});
    useActionToast(state, "Run notes saved.");
    return (
        <Collapsible className="flex flex-col gap-3">
            <CollapsibleTrigger className="w-fit">
                {note ? "Edit notes" : "Add notes"}
            </CollapsibleTrigger>
            <CollapsibleContent keepMounted>
                <form action={formAction} className="flex flex-col gap-3">
                    <KeepFieldsOnReset />
                    <input type="hidden" name="runId" value={runId} />
                    <Label htmlFor="run-note">Notes for this run</Label>
                    <Textarea
                        id="run-note"
                        name="body"
                        defaultValue={note?.body ?? ""}
                        placeholder="The first line becomes the run name. Add observations, questions, or follow-up decisions."
                        className="min-h-20"
                    />
                    {state.formError && (
                        <p role="alert" className="text-copy-14 text-error">
                            {state.formError}
                        </p>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-copy-14 text-muted-foreground">
                            {note ? (
                                <>
                                    Last saved{" "}
                                    <RelativeTime value={note.updatedAt} />
                                </>
                            ) : (
                                "No run notes saved yet."
                            )}
                        </p>
                        <SubmitButton size="sm" loadingText="Saving notes…">
                            Save notes
                        </SubmitButton>
                    </div>
                </form>
            </CollapsibleContent>
        </Collapsible>
    );
}
