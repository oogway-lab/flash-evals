"use client";

import type {
    IRunAudioTranscriptSummary,
    IRunConfigSnapshot,
} from "@mosaic/api-contract";
import { Card } from "@/components/ui/card";
import { Num } from "@/components/ui/num";
import { SectionTitle } from "@/components/layout/section-title";
import { TranscriptStatusBadge } from "@/components/ui/status-badge";
import { JsonBlock } from "@/components/ui/json-block";
import { fmtDate } from "@/lib/format";
import {
    sttVariantDisplaysForTranscript,
    type ISttVariantDisplay,
} from "./stt-variant-display";
import { Metric, MetricList } from "@/components/ui/metric";

export function RunTranscriptPanel({
    transcripts,
    configSnapshot = {},
}: {
    transcripts: IRunAudioTranscriptSummary[];
    configSnapshot?: IRunConfigSnapshot;
}) {
    if (transcripts.length === 0) return null;
    const cards = transcripts.flatMap<{
        transcript: IRunAudioTranscriptSummary;
        display?: ISttVariantDisplay;
    }>((transcript) => {
        const displays = sttVariantDisplaysForTranscript(
            configSnapshot,
            transcript,
        );
        return displays.length > 0
            ? displays.map((display) => ({ transcript, display }))
            : [{ transcript, display: undefined }];
    });

    return (
        <div className="flex flex-col gap-6">
            {cards.map(({ transcript, display }) => (
                <Card
                    key={`${transcript.id}:${display?.variantKey ?? "legacy"}`}
                    variant="inset"
                    className="flex flex-col gap-4 p-4"
                >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex flex-col gap-1">
                            <SectionTitle as="h3">
                                {display?.label ?? displayModel(transcript)}
                            </SectionTitle>
                            <p className="text-mono-13 text-muted-foreground">
                                {transcript.providerId} / {transcript.routeId}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-copy-14 text-muted-foreground">
                            <TranscriptStatusBadge status={transcript.status} />
                            {transcript.detectedLanguage && (
                                <span>{transcript.detectedLanguage}</span>
                            )}
                            {transcript.segments.length > 0 && (
                                <span>
                                    <Num>{transcript.segments.length}</Num>{" "}
                                    segments
                                </span>
                            )}
                            {transcript.speakers.length > 0 && (
                                <span>
                                    <Num>{transcript.speakers.length}</Num>{" "}
                                    speakers
                                </span>
                            )}
                        </div>
                    </div>

                    {transcript.error && (
                        <p className="text-copy-14 text-error">
                            {transcript.error}
                        </p>
                    )}

                    {transcript.warnings.length > 0 && (
                        <ul className="flex flex-col gap-1 text-copy-14 text-muted-foreground">
                            {transcript.warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                            ))}
                        </ul>
                    )}

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
                        <div className="flex flex-col gap-2">
                            <h4 className="text-label-12 text-muted-foreground">
                                Transcript
                            </h4>
                            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-sm bg-background p-3 font-sans text-copy-14 text-on-surface">
                                {transcript.transcript}
                            </pre>
                        </div>
                        <MetricList className="content-start">
                            <Metric
                                plain
                                label="Language"
                                value={transcript.language || "auto"}
                            />
                            <Metric
                                plain
                                label="Config"
                                value={configSummary(transcript.configJson)}
                            />
                            <Metric
                                plain
                                label="Created"
                                value={fmtDate(transcript.createdAt)}
                            />
                        </MetricList>
                    </div>

                    {transcript.variants.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <h4 className="text-label-12 text-muted-foreground">
                                Variants
                            </h4>
                            <div className="flex flex-col gap-3">
                                {transcript.variants.map((variant) => (
                                    <div
                                        key={variant.id}
                                        className="flex flex-col gap-2 rounded-sm bg-background p-3"
                                    >
                                        <div className="flex flex-wrap items-center gap-2 text-copy-14 text-muted-foreground">
                                            <span className="text-label-12 text-on-surface">
                                                {variant.variantKind}
                                            </span>
                                            <span>{variant.targetScript}</span>
                                            <span className="text-mono-13">
                                                {variant.modelId}
                                            </span>
                                        </div>
                                        <pre className="whitespace-pre-wrap font-sans text-copy-14 text-on-surface">
                                            {variant.transcript}
                                        </pre>
                                        {variant.error && (
                                            <p className="text-copy-14 text-error">
                                                {variant.error}
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {(transcript.segments.length > 0 ||
                        hasConfig(transcript.configJson) ||
                        transcript.providerMetadata !== null) && (
                        <div className="grid gap-4 lg:grid-cols-2">
                            {hasConfig(transcript.configJson) && (
                                <div className="flex flex-col gap-2">
                                    <h4 className="text-label-12 text-muted-foreground">
                                        STT config
                                    </h4>
                                    <JsonBlock
                                        data={transcript.configJson}
                                        collapsible
                                    />
                                </div>
                            )}
                            {transcript.segments.length > 0 && (
                                <div className="flex flex-col gap-2">
                                    <h4 className="text-label-12 text-muted-foreground">
                                        Segments
                                    </h4>
                                    <JsonBlock
                                        data={transcript.segments}
                                        collapsible
                                    />
                                </div>
                            )}
                            {transcript.providerMetadata !== null && (
                                <div className="flex flex-col gap-2">
                                    <h4 className="text-label-12 text-muted-foreground">
                                        Provider metadata
                                    </h4>
                                    <JsonBlock
                                        data={transcript.providerMetadata}
                                        collapsible
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </Card>
            ))}
        </div>
    );
}

function displayModel(transcript: IRunAudioTranscriptSummary): string {
    return transcript.canonicalModelId || transcript.sttModelId;
}

function configSummary(config: Record<string, unknown>): string {
    const keys = Object.keys(config);
    return keys.length === 0 ? "default" : keys.join(", ");
}

function hasConfig(config: Record<string, unknown>): boolean {
    return Object.keys(config).length > 0;
}
