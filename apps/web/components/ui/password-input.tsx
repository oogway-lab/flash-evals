"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input, type InputProps } from "@/components/ui/input";

/**
 * A password field with a show/hide toggle inside its right edge. `noun`
 * names the secret for the toggle's label: "Show key" / "Hide key".
 */
export const PasswordInput = React.forwardRef<
    HTMLInputElement,
    Omit<InputProps, "type"> & { noun?: string }
>(function PasswordInput({ className, noun = "password", id, ...props }, ref) {
    const [visible, setVisible] = React.useState(false);
    const label = `${visible ? "Hide" : "Show"} ${noun}`;
    return (
        <div data-slot="password-input" className="relative">
            <Input
                ref={ref}
                id={id}
                type={visible ? "text" : "password"}
                className={cn("pr-10", className)}
                {...props}
            />
            <Hint content={label}>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={label}
                    aria-pressed={visible}
                    aria-controls={id}
                    onClick={() => setVisible((v) => !v)}
                    className="absolute inset-y-0 right-0 text-muted-foreground hover:text-on-surface"
                >
                    {visible ? (
                        <EyeOff className="size-4" aria-hidden="true" />
                    ) : (
                        <Eye className="size-4" aria-hidden="true" />
                    )}
                </Button>
            </Hint>
        </div>
    );
});
