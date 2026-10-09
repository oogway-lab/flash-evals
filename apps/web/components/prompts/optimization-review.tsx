"use client";

import { Check, X } from "lucide-react";
import { ExternalLink } from "@/components/ui/external-link";
import type { IPromptOptimizerGuidanceSource } from "@/server/db/jsonTypes";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/layout/section-title";
import { Button } from "@/components/ui/button";
import { CopyablePre } from "./copyable-pre";

export interface IOptimizationReviewProps {
    originalPrompt: string;
    proposedPrompt: string;
    rationale: string;
    fitTags: string[];
    structuredOutputNotes: string[];
    guidanceSource?: IPromptOptimizerGuidanceSource;
    optimizerModelId?: string;
    targetModelId?: string;
    onAccept: () => void;
    onDiscard: () => void;
}

export function OptimizationReview({
    originalPrompt,
    proposedPrompt,
    rationale,
    fitTags,
    structuredOutputNotes,
    guidanceSource,
    optimizerModelId,
    targetModelId,
    onAccept,
    onDiscard,
}: IOptimizationReviewProps) {
    return (
        <Card variant="inset" className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <SectionTitle
                    as="h3"
                    description="Review the proposed prompt before replacing your draft."
                >
                    Optimization review
                </SectionTitle>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={onAccept}>
                        <Check className="size-4" />
                        Use prompt
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={onDiscard}
                    >
                        <X className="size-4" />
                        Discard
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <div>
                    <p className="pb-2 text-label-14 text-muted-foreground">
                        Original
                    </p>
                    <CopyablePre
                        text={originalPrompt}
                        label="Copy original prompt"
                        className="bg-background"
                    />
                </div>
                <div>
                    <p className="pb-2 text-label-14 text-muted-foreground">
                        Proposed
                    </p>
                    <CopyablePre
                        text={proposedPrompt}
                        label="Copy proposed prompt"
                        className="bg-background"
                    />
                </div>
            </div>

            <Alert>
                <AlertDescription>{rationale}</AlertDescription>
            </Alert>

            {(fitTags.length > 0 || structuredOutputNotes.length > 0) && (
                <div className="grid gap-4 lg:grid-cols-2">
                    {fitTags.length > 0 && (
                        <div>
                            <p className="pb-2 text-label-14 text-muted-foreground">
                                Fit tags
                            </p>
                            <p className="text-copy-14 text-on-surface">
                                {fitTags.join(", ")}
                            </p>
                        </div>
                    )}
                    {structuredOutputNotes.length > 0 && (
                        <div>
                            <p className="pb-2 text-label-14 text-muted-foreground">
                                Structured output notes
                            </p>
                            <ul className="flex flex-col gap-1 text-copy-14 text-muted-foreground">
                                {structuredOutputNotes.map((note, index) => (
                                    <li key={`${note}-${index}`}>{note}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            {(guidanceSource || optimizerModelId || targetModelId) && (
                <p className="flex flex-wrap items-center gap-1 text-copy-14 text-muted-foreground">
                    {optimizerModelId && (
                        <>
                            Optimizer:
                            <span className="text-mono-13">
                                {optimizerModelId}
                            </span>
                        </>
                    )}
                    {targetModelId && (
                        <>
                            Target:
                            <span className="text-mono-13">
                                {targetModelId}
                            </span>
                        </>
                    )}
                    {guidanceSource && (
                        <>
                            Guidance:
                            {isExternalGuidanceUrl(guidanceSource.url) ? (
                                <ExternalLink href={guidanceSource.url}>
                                    {guidanceSource.title}
                                </ExternalLink>
                            ) : (
                                <span>{guidanceSource.title}</span>
                            )}
                            <span className="text-mono-13">
                                retrieved {guidanceSource.retrievedAt}
                            </span>
                        </>
                    )}
                </p>
            )}
        </Card>
    );
}

function isExternalGuidanceUrl(url: string): boolean {
    return url.startsWith("https://") || url.startsWith("http://");
}
