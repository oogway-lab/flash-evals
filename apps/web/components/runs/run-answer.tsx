"use client";

import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { HintText } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Num } from "@/components/ui/num";
import { BenchmarkVerdictBadge } from "@/components/ui/status-badge";
import { fmtPercent, formatCostColumn } from "@/lib/format";
import { monthlySaving, type IRunAnswer } from "./run-results";

const DEFAULT_CALLS_PER_MONTH = 100_000;

function fmtMoney(value: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
    }).format(value);
}

/** "$0.0017 vs $0.0359 per call", both at one precision. */
function perCall(pick: number, reference: number): string {
    const format = formatCostColumn([pick, reference]);
    return `${format(pick)} vs ${format(reference)} per call`;
}

function Tile({
    label,
    children,
    className,
}: {
    label: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={className}>
            <dt className="text-label-12 text-muted-foreground">{label}</dt>
            <dd className="flex min-w-0 flex-col gap-1 pt-1">{children}</dd>
        </div>
    );
}

function SavingTile({ answer }: { answer: IRunAnswer }) {
    const inputId = useId();
    const [calls, setCalls] = useState(DEFAULT_CALLS_PER_MONTH);
    const saving = monthlySaving(answer.reference, answer.pick, calls);
    if (saving === undefined || !answer.pick || !answer.reference)
        return undefined;
    return (
        <Tile
            label={
                <HintText
                    hint={`(${answer.reference.name}'s cost per call minus ${answer.pick.name}'s) times the calls per month, using the average costs in this run. A projection, not a quote.`}
                >
                    If you switched (projection)
                </HintText>
            }
            className="col-span-2"
        >
            <span className="text-heading-24 text-on-surface">
                <Num>
                    {saving >= 0
                        ? `${fmtMoney(saving)} a month saved`
                        : `${fmtMoney(-saving)} a month more`}
                </Num>
            </span>
            <span className="flex flex-wrap items-center gap-2 text-copy-14 text-muted-foreground">
                <label htmlFor={inputId}>at</label>
                <Input
                    id={inputId}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1000}
                    value={calls}
                    onChange={(event) =>
                        setCalls(Math.max(0, Number(event.target.value) || 0))
                    }
                    className="h-8 w-32 tabular-nums"
                    aria-label="Calls per month"
                />
                <span>calls per month</span>
            </span>
        </Tile>
    );
}

/**
 * The answer at the top of a run: one plain sentence, the reasons behind it,
 * and tiles for the model it names, its cost against today's model and what
 * switching would save at a call volume the reader chooses.
 */
export function RunAnswer({ answer }: { answer: IRunAnswer }) {
    const { pick, reference } = answer;
    const showCost =
        pick !== undefined &&
        reference !== undefined &&
        !pick.isReference &&
        pick.relativeCost !== undefined;
    return (
        <Card
            role="region"
            aria-label="The answer"
            className="grid gap-6 p-4 sm:p-6 lg:grid-cols-2"
        >
            <div className="flex min-w-0 flex-col gap-3">
                {answer.sample && (
                    <span>
                        <Badge variant="warning">{answer.sample.label}</Badge>
                    </span>
                )}
                <p className="text-heading-20 text-on-surface">
                    {answer.sentence}
                </p>
                {answer.sample && (
                    <p className="text-copy-14 text-muted-foreground">
                        {answer.sample.detail}
                    </p>
                )}
                {answer.reasons.length > 0 && (
                    <ul className="flex list-disc flex-col gap-1 pl-4 text-copy-14 text-muted-foreground">
                        {answer.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                        ))}
                    </ul>
                )}
            </div>
            {pick && (
                <dl className="grid grid-cols-2 content-start gap-4">
                    <Tile label={answer.pickLabel}>
                        <span className="text-heading-20 text-on-surface">
                            {pick.name}
                        </span>
                        <span className="flex flex-wrap items-center gap-2 text-copy-14 text-muted-foreground">
                            {answer.verdict && (
                                <BenchmarkVerdictBadge
                                    verdict={answer.verdict}
                                />
                            )}
                            {answer.pickDetail}
                        </span>
                    </Tile>
                    {showCost && (
                        <Tile label={`Cost against ${reference.name}`}>
                            <span className="text-heading-24 text-on-surface">
                                <Num>{fmtPercent(pick.relativeCost)}</Num>
                            </span>
                            {pick.costPerCall !== undefined &&
                                reference.costPerCall !== undefined && (
                                    <span className="text-copy-14 text-muted-foreground">
                                        <Num>
                                            {perCall(
                                                pick.costPerCall,
                                                reference.costPerCall,
                                            )}
                                        </Num>
                                    </span>
                                )}
                        </Tile>
                    )}
                    <SavingTile answer={answer} />
                </dl>
            )}
        </Card>
    );
}
