"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { IActionState } from "@/app/actions";

import { useFieldErrorId } from "@/components/ui/field-error-context";

const initialState: IActionState = {};

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" loading={pending} loadingText="Adding…">
            Add item
        </Button>
    );
}

export function TextAddForm({
    datasetId,
    action,
}: {
    datasetId: string;
    action: (prev: IActionState, formData: FormData) => Promise<IActionState>;
}) {
    const [state, formAction] = useActionState(action, initialState);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        if (state.ok && state.resetKey) formRef.current?.reset();
    }, [state.ok, state.resetKey]);

    return (
        <form ref={formRef} action={formAction} className="space-y-4">
            <input type="hidden" name="datasetId" value={datasetId} />
            <div className="flex flex-col gap-2">
                <Label htmlFor="text-add-input">Input text</Label>
                <Textarea
                    id="text-add-input"
                    name="inputText"
                    rows={3}
                    className="font-sans"
                />
            </div>
            {state.formError && (
                <p role="alert" className="text-copy-14 text-error">
                    {state.formError}
                </p>
            )}
            <SubmitButton />
        </form>
    );
}

export function TextInputField() {
    const errorId = useFieldErrorId("inputText");
    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor="inputText">Input text</Label>
            <Textarea
                id="inputText"
                aria-invalid={errorId ? true : undefined}
                aria-describedby={errorId}
                name="inputText"
                rows={3}
                className="font-sans"
            />
        </div>
    );
}
