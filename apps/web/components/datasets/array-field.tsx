"use client";

import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";

export function ArrayField({
    fieldName,
    label,
    values,
    required,
    error,
    errorId,
    onChange,
}: {
    fieldName: string;
    label: string;
    values: string[];
    required: boolean;
    error?: string;
    /** Id of the element showing `error`, linked from each input. */
    errorId?: string;
    onChange: (values: string[]) => void;
}) {
    const inputRefs = useRef<Array<HTMLInputElement | undefined>>([]);
    const addButtonRef = useRef<HTMLButtonElement>(null);

    function addRow() {
        const next = [...values, ""];
        onChange(next);
        window.setTimeout(() => inputRefs.current[next.length - 1]?.focus(), 0);
    }

    function removeRow(index: number) {
        if (required && values.length <= 1) return;
        const next = values.filter((_, i) => i !== index);
        onChange(next);
        window.setTimeout(() => {
            const targetIndex = Math.max(0, index - 1);
            if (next.length > 0) inputRefs.current[targetIndex]?.focus();
            else addButtonRef.current?.focus();
        }, 0);
    }

    return (
        <div className="space-y-2">
            {values.length === 0 ? (
                <EmptyState
                    variant="inline"
                    title={`No ${label.toLowerCase()} values`}
                    description="Use Add to create the first one."
                />
            ) : (
                values.map((value, index) => (
                    <div key={index} className="flex items-start gap-2">
                        <Input
                            ref={(node) => {
                                inputRefs.current[index] = node ?? undefined;
                            }}
                            value={value}
                            onChange={(event) => {
                                const next = [...values];
                                next[index] = event.target.value;
                                onChange(next);
                            }}
                            invalid={Boolean(error)}
                            aria-describedby={error ? errorId : undefined}
                            aria-label={`${label} item ${index + 1}`}
                        />
                        <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            disabled={required && values.length <= 1}
                            aria-label={`Remove ${fieldName} item ${index + 1}`}
                            onClick={() => removeRow(index)}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                ))
            )}
            <Button
                ref={addButtonRef}
                type="button"
                variant="secondary"
                size="sm"
                onClick={addRow}
            >
                <Plus className="h-4 w-4" />
                Add value
            </Button>
        </div>
    );
}
