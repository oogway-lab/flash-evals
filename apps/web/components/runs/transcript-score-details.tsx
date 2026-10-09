import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/layout/section-title";
import { ScorePill } from "@/components/ui/score-pill";
import { MISSING_VALUE } from "@/lib/format";
import {
    type TranscriptMetricDetails,
    toTranscriptJudgeMetricDetails,
    toTranscriptMetricDetails,
} from "@/components/runs/types";
import { Metric, MetricList } from "@/components/ui/metric";

export interface ITranscriptScorePresentation {
    score: number | null;
    detailsJson?: unknown;
    rationale?: string | null;
    status?: "completed" | "skipped" | "error";
    error?: string;
}

export function TranscriptMetricBreakdown({
    score,
}: {
    score: ITranscriptScorePresentation | undefined;
}) {
    const details = toTranscriptMetricDetails(score?.detailsJson);
    if (!details) {
        return (
            <EvidenceMessage
                title="Mechanical metrics unavailable"
                message={
                    score?.error ??
                    score?.rationale ??
                    "No matching reference or metric result was recorded."
                }
            />
        );
    }
    return (
        <section
            className="flex flex-col gap-3"
            aria-label="Mechanical metrics"
        >
            <div className="flex flex-wrap items-center gap-3">
                <SectionTitle as="h3">Mechanical metrics</SectionTitle>
                <ScorePill label="Accuracy" score={score?.score} />
            </div>
            <MetricList className="gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                    label="WER"
                    value={formatTranscriptPercent(details.wer)}
                />
                <Metric
                    label="CER"
                    value={formatTranscriptPercent(details.cer)}
                />
                <Metric
                    label="Filler-stripped WER"
                    value={formatOptionalPercent(details.fillerStrippedWer)}
                />
                <Metric
                    label="DER"
                    value={formatOptionalPercent(details.diarization?.der)}
                />
                <Metric
                    label="Substitutions"
                    value={String(details.wordCounts.substitutions)}
                />
                <Metric
                    label="Deletions"
                    value={String(details.wordCounts.deletions)}
                />
                <Metric
                    label="Insertions"
                    value={String(details.wordCounts.insertions)}
                />
                <Metric
                    label="Reference words"
                    value={String(details.wordCounts.referenceLength)}
                />
                {details.characterCounts ? (
                    <>
                        <Metric
                            label="Character substitutions"
                            value={String(
                                details.characterCounts.substitutions,
                            )}
                        />
                        <Metric
                            label="Character deletions"
                            value={String(details.characterCounts.deletions)}
                        />
                        <Metric
                            label="Character insertions"
                            value={String(details.characterCounts.insertions)}
                        />
                        <Metric
                            label="Reference characters"
                            value={String(
                                details.characterCounts.referenceLength,
                            )}
                        />
                    </>
                ) : null}
                <Metric
                    label="Domain-term recall"
                    value={formatOptionalPercent(
                        details.domainTermRecall?.recall,
                    )}
                />
                <Metric
                    label="Numeric accuracy"
                    value={formatOptionalPercent(
                        details.numericAccuracy?.accuracy,
                    )}
                />
                <DiarizationMetricBoxes details={details.diarization} />
            </MetricList>
            <PerSpeakerWer values={details.diarization?.perSpeakerWer} />
            <MissedEvidence
                label="Missed domain terms"
                values={details.domainTermRecall?.missed}
            />
            <MissedEvidence
                label="Missed numbers"
                values={details.numericAccuracy?.missed}
            />
            <HardFailures failures={details.hardFailures} />
        </section>
    );
}

export function TranscriptJudgeBreakdown({
    score,
}: {
    score: ITranscriptScorePresentation | undefined;
}) {
    if (score?.status === "error") {
        return (
            <EvidenceMessage
                title="Transcript judge failed"
                message={
                    score.error ?? "The evaluator did not return a result."
                }
            />
        );
    }
    const details = toTranscriptJudgeMetricDetails(score?.detailsJson);
    if (!details) {
        return (
            <EvidenceMessage
                title="Transcript judge unavailable"
                message={
                    score?.rationale ??
                    "No transcript judge result was recorded."
                }
            />
        );
    }
    return (
        <section className="flex flex-col gap-3" aria-label="Transcript judge">
            <div className="flex flex-wrap items-center gap-3">
                <SectionTitle as="h3">Transcript judge</SectionTitle>
                <ScorePill score={score?.score} />
                <span className="text-mono-13 text-muted-foreground">
                    {details.modelId}
                </span>
            </div>
            <Card variant="inset" className="flex flex-col gap-1 p-3">
                <p className="text-label-12 text-muted-foreground">Rubric</p>
                <p className="whitespace-pre-wrap text-copy-14">
                    {details.rubricPrompt}
                </p>
            </Card>
            {details.criteria?.map((criterion) => (
                <Card
                    key={criterion.name}
                    variant="inset"
                    className="flex flex-col gap-1 p-3"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-label-12">{criterion.name}</p>
                        <ScorePill score={criterion.score} />
                    </div>
                    <p className="text-copy-14 text-muted-foreground">
                        {criterion.reasoning}
                    </p>
                </Card>
            ))}
            {details.error ? (
                <EvidenceMessage
                    title="Judge detail error"
                    message={details.error}
                />
            ) : null}
        </section>
    );
}

function DiarizationMetricBoxes({
    details,
}: {
    details: TranscriptMetricDetails["diarization"];
}) {
    if (!details) return null;
    return (
        <>
            <Metric
                label="False alarm rate"
                value={formatOptionalPercent(details.falseAlarmRate)}
            />
            <Metric
                label="Missed detection rate"
                value={formatOptionalPercent(details.missedDetectionRate)}
            />
            <Metric
                label="Speaker confusion"
                value={formatOptionalPercent(details.speakerConfusionRate)}
            />
            <Metric
                label="cpWER"
                value={formatOptionalPercent(details.cpWer)}
            />
            <Metric
                label="Concatenated WER"
                value={formatOptionalPercent(details.concatenatedWer)}
            />
            <Metric
                label="Diarization coverage"
                value={formatOptionalPercent(details.coverageRatio)}
            />
            <Metric
                label="Speaker count delta"
                value={String(details.speakerCountDelta)}
            />
        </>
    );
}

function PerSpeakerWer({ values }: { values?: Record<string, number> | null }) {
    if (!values) return null;
    return (
        <div className="flex flex-col gap-1">
            <p className="text-label-12">Per-speaker WER</p>
            <ul className="text-copy-14 text-muted-foreground">
                {Object.entries(values).map(([speaker, wer]) => (
                    <li key={speaker}>
                        {speaker}: {formatTranscriptPercent(wer)}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function MissedEvidence({
    label,
    values,
}: {
    label: string;
    values?: Array<string | number>;
}) {
    if (!values?.length) return null;
    return (
        <p className="text-copy-14 text-muted-foreground">
            {label}: {values.join(", ")}
        </p>
    );
}

function HardFailures({ failures }: { failures?: string[] }) {
    if (!failures?.length) return null;
    return (
        <div className="flex flex-col gap-2">
            <p className="text-label-12">Hard failures</p>
            <div className="flex flex-wrap gap-2">
                {failures.map((failure) => (
                    <Badge key={failure} variant="danger">
                        {failure}
                    </Badge>
                ))}
            </div>
        </div>
    );
}

function EvidenceMessage({
    title,
    message,
}: {
    title: string;
    message: string;
}) {
    return (
        <Card variant="inset" className="flex flex-col gap-1 p-3">
            <SectionTitle as="h3">{title}</SectionTitle>
            <p className="text-copy-14 text-muted-foreground">{message}</p>
        </Card>
    );
}

export function formatTranscriptPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function formatOptionalPercent(value: number | null | undefined): string {
    return value === null || value === undefined
        ? MISSING_VALUE
        : formatTranscriptPercent(value);
}
