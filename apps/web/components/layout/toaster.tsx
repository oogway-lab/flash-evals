"use client";

import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Toaster } from "sonner";

// Every toast type shares the neutral surface; only the icon carries color.
export function AppToaster() {
    return (
        <Toaster
            position="bottom-right"
            theme="system"
            closeButton
            icons={{
                success: (
                    <CircleCheck
                        aria-hidden="true"
                        className="size-4 text-eval-success"
                    />
                ),
                error: (
                    <CircleAlert
                        aria-hidden="true"
                        className="size-4 text-eval-danger"
                    />
                ),
                warning: (
                    <TriangleAlert
                        aria-hidden="true"
                        className="size-4 text-eval-warning"
                    />
                ),
            }}
            toastOptions={{
                classNames: {
                    toast: "border border-border bg-neutral text-on-surface",
                    title: "text-label-14 text-on-surface",
                    description: "text-copy-14 text-muted-foreground",
                },
            }}
        />
    );
}
