"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { retryRunAction, type IActionState } from "@/app/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useActionToast } from "@/components/layout/use-action-toast";

export function RetryFailedCellsForm({ runId }: { runId: string }) {
    const [state, formAction] = useActionState<IActionState, FormData>(
        retryRunAction,
        {},
    );
    useActionToast(state, "Retry queued. Failed cells will run again.");
    return (
        <form
            action={formAction}
            className="flex flex-col gap-2 sm:items-start"
        >
            <input type="hidden" name="runId" value={runId} />
            <RetryButton />
            {state.formError && (
                <Alert variant="destructive" className="sm:max-w-xs">
                    {state.formError}
                </Alert>
            )}
        </form>
    );
}

function RetryButton() {
    const { pending } = useFormStatus();
    return (
        <Button
            type="submit"
            variant="secondary"
            loading={pending}
            loadingText="Retrying…"
        >
            Retry failed cells
        </Button>
    );
}
