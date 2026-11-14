"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** How much headroom the suggested limit leaves over the estimate. */
export const SPEND_LIMIT_HEADROOM = 1.5;

/**
 * The suggested spend limit for an estimate: 1.5 times it, rounded up to
 * the cent, or empty (no limit) when nothing could be priced.
 */
export function suggestedSpendLimit(estimateUsd: number | undefined): string {
    if (!estimateUsd || !Number.isFinite(estimateUsd) || estimateUsd <= 0)
        return "";
    return (Math.ceil(estimateUsd * SPEND_LIMIT_HEADROOM * 100) / 100).toFixed(
        2,
    );
}

/**
 * The run's spend limit in USD, submitted as `maxCostUsd`. With an estimate
 * it starts at 1.5 times the estimate and follows it until edited; without
 * one it starts empty, which means no limit.
 */
export function SpendLimitField({
    id = "maxCostUsd",
    estimateUsd,
    error,
}: {
    id?: string;
    /** Shown estimate for the run; omit for no suggested limit. */
    estimateUsd?: number;
    error?: string;
}) {
    const [edited, setEdited] = useState<string>();
    const value = edited ?? suggestedSpendLimit(estimateUsd);
    const hintId = `${id}-hint`;
    return (
        <div className="flex flex-col gap-2 sm:max-w-xs">
            <Label htmlFor={id}>Spend limit (USD)</Label>
            <Input
                id={id}
                name="maxCostUsd"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                placeholder="No limit"
                value={value}
                onChange={(event) => setEdited(event.target.value)}
                aria-describedby={hintId}
                aria-invalid={error ? true : undefined}
            />
            <p id={hintId} className="text-label-12 text-muted-foreground">
                {estimateUsd !== undefined && estimateUsd > 0
                    ? "The run stops starting new calls once model and judge costs reach this. Starts at 1.5 times the estimate. Leave empty for no limit."
                    : "The run stops starting new calls once model and judge costs reach this. Leave empty for no limit."}
            </p>
            {error && (
                <p role="alert" className="text-copy-14 text-error">
                    {error}
                </p>
            )}
        </div>
    );
}
