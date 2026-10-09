"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { CopyButton } from "@/components/ui/copy-button";

export function JsonBlock({
    data,
    className,
    collapsible = false,
    defaultOpen = true,
}: {
    data: unknown;
    className?: string;
    collapsible?: boolean;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    const text = JSON.stringify(data, null, 2);

    return (
        <div className={cn("relative rounded-sm bg-surface", className)}>
            <div className="flex items-center justify-between px-3 py-1">
                {collapsible ? (
                    <button
                        type="button"
                        onClick={() => setOpen(!open)}
                        className="flex items-center gap-1 text-label-12 text-muted-foreground hover:text-on-surface"
                    >
                        {open ? (
                            <ChevronDown className="size-3.5" />
                        ) : (
                            <ChevronRight className="size-3.5" />
                        )}
                        JSON
                    </button>
                ) : (
                    <span className="text-label-12 text-muted-foreground">
                        JSON
                    </span>
                )}
                <CopyButton value={text} label="Copy JSON" />
            </div>
            {(!collapsible || open) && (
                <pre className="max-h-80 overflow-auto px-3 pb-3 text-mono-13 text-on-surface">
                    {text}
                </pre>
            )}
        </div>
    );
}
