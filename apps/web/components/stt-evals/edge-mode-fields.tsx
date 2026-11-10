"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";

const PASS = "pass";
const ORDER = "order";

/**
 * What a connection does: pass the source step's answer on (the default),
 * or only make the target wait for the source, so a run condition can check
 * the source while the target still reads the original input.
 */
export function EdgeModeFields({
    sourceLabel,
    targetLabel,
    orderOnly,
    canBeOrderOnly,
    onChange,
    onClose,
}: {
    sourceLabel: string;
    targetLabel: string;
    orderOnly: boolean;
    /** Only Prompt and LLM text steps can wait without reading the answer. */
    canBeOrderOnly: boolean;
    onChange: (orderOnly: boolean) => void;
    onClose: () => void;
}) {
    return (
        <Card role="region" aria-label="Connection">
            <CardHeader className="flex flex-row items-start justify-between gap-2">
                <CardTitle as="h2">
                    {sourceLabel} → {targetLabel}
                </CardTitle>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Close connection settings"
                    onClick={onClose}
                >
                    <X />
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                {canBeOrderOnly ? (
                    <RadioGroup
                        aria-label="What this connection passes"
                        value={orderOnly ? ORDER : PASS}
                        onValueChange={(value) => onChange(value === ORDER)}
                        className="sm:grid-cols-2"
                    >
                        <RadioCard
                            value={PASS}
                            title={`Pass ${sourceLabel}'s answer`}
                            description={`${targetLabel} reads ${sourceLabel}'s answer as its input.`}
                        />
                        <RadioCard
                            value={ORDER}
                            title={`Wait for ${sourceLabel} only`}
                            description={`${targetLabel} runs after ${sourceLabel}, so it can be gated by it, but reads the original input. Shown as a dashed line.`}
                        />
                    </RadioGroup>
                ) : (
                    <p className="text-copy-14 text-muted-foreground">
                        {targetLabel} reads {sourceLabel}&apos;s output. Only a
                        Prompt or LLM text step can wait for a step without
                        reading its answer.
                    </p>
                )}
                <p className="text-copy-14 text-muted-foreground">
                    Save the canvas to keep changes.
                </p>
            </CardContent>
        </Card>
    );
}
