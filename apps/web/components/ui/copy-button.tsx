"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";

const COPIED_MS = 2000;

// "Generation ID" → "generation ID": keeps acronyms intact.
function lowerFirst(text: string): string {
    return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Icon-only copy button with a tooltip. `what` names the thing copied, so
 * the label reads "Copy run ID"; `label` sets the whole label instead.
 * `hint` overrides the tooltip, e.g. to show the full value being copied.
 */
export function CopyButton({
    value,
    what,
    label = what ? `Copy ${lowerFirst(what)}` : "Copy",
    hint,
    className,
}: {
    value: string;
    what?: string;
    label?: string;
    hint?: React.ReactNode;
    className?: string;
}) {
    const [copied, setCopied] = React.useState(false);
    const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

    React.useEffect(() => () => clearTimeout(timer.current), []);

    async function copy() {
        if (!(await copyText(value))) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    }

    const Icon = copied ? Check : Copy;
    return (
        <>
            <Hint content={copied ? "Copied" : (hint ?? label)}>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-slot="copy-button"
                    aria-label={label}
                    onClick={() => void copy()}
                    className={cn("size-7 shrink-0 p-0", className)}
                >
                    <Icon aria-hidden="true" className="size-3.5" />
                </Button>
            </Hint>
            <span className="sr-only" role="status">
                {copied ? "Copied" : ""}
            </span>
        </>
    );
}
