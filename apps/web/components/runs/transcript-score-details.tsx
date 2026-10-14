import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SectionTitle } from "@/components/layout/section-title";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { MISSING_VALUE, fmtScore } from "@/lib/format";
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

/**
 * The answer to "how did this result score", shown before any evidence:
 * one large value per scorer that ran on the result.
 */
export function ScoreVerdict({
    metric,
    judge,
    digits,
}: {
    metric: ITranscriptScorePresentation | undefined;
    judge: ITranscriptScorePresentation | undefined;
    digits?: number;
}) {
    const judgeModel = toTranscriptJudgeMetricDetails(
        judge?.detailsJson,
    )?.modelId;
    const verdicts = [
        metric && { label: "Accuracy", score: metric.score },
        judge && {
            label: "Judge score",
            score: judge.score,
            note: judgeModel,
        },
    ].filter((verdict) => !!verdict);
    if (!verdicts.length) return null;
    return (
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
            {verdicts.map((verdict) => (
                <div key={verdict.label} className="flex flex-col gap-1">
                    <dt className="text-label-12 text-muted-foreground">
                        {verdict.label}
                    </dt>
                    <dd className="flex flex-wrap items-baseline gap-x-3">
                        <span className="text-stat-32">
                            {fmtScore(verdict.score, digits)}
                        </span>
                        {verdict.note ? (
                            <span className="text-mono-13 text-muted-foreground">
                                {verdict.note}
                            </span>
                        ) : null}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

export function TranscriptMetricBreakdown({
    score,
}: {
    score: ITranscriptScorePresentation | undefined;
}) {
    // No metric scorer ran on this result: nothing to explain.
    if (!score) return null;
    const details = toTranscriptMetricDetails(score.detailsJson);
    if (!details) {
        return (
            <EvidenceMessage
                title="Mechanical metrics unavailable"
                message={
                    score.error ??
                    score.rationale ??
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
            <SectionTitle as="h3">Mechanical metrics</SectionTitle>
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
    // No judge ran on this result: nothing to explain.
    if (!score) return null;
    if (score.status === "error") {
        return (
            <EvidenceMessage
                title="Transcript judge failed"
                message={
                    score.error ?? "The evaluator did not return a result."
                }
            />
        );
    }
    const details = toTranscriptJudgeMetricDetails(score.detailsJson);
    if (!details) {
        return (
            <EvidenceMessage
                title="Transcript judge unavailable"
                message={
                    score.rationale ??
                    "No transcript judge result was recorded."
                }
            />
        );
    }
    const criteria = details.criteria ?? [];
    const lowest = lowestCriterion(criteria);
    return (
        <section className="flex flex-col gap-3" aria-label="Transcript judge">
            <SectionTitle as="h3">Judge criteria</SectionTitle>
            {criteria.length ? (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="px-0">Criterion</TableHead>
                            <TableHead align="numeric" className="px-0">
                                Score
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {criteria.map((criterion) => (
                            <TableRow
                                key={criterion.name}
                                className="hover:bg-transparent"
                            >
                                <TableCell className="px-0">
                                    <div className="flex flex-col gap-1">
                                        <p className="flex flex-wrap items-baseline gap-x-2 text-label-14">
                                            {criterion.name}
                                            {criterion === lowest ? (
                                                <span className="text-label-12 text-muted-foreground">
                                                    Lowest
                                                </span>
                                            ) : null}
                                        </p>
                                        <p className="text-copy-14 text-muted-foreground">
                                            {criterion.reasoning}
                                        </p>
                                    </div>
                                </TableCell>
                                <TableCell
                                    align="numeric"
                                    className="px-0 pl-3 text-label-14"
                                >
                                    {fmtScore(criterion.score)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            ) : score.rationale ? (
                <p className="text-copy-14 text-muted-foreground">
                    {score.rationale}
                </p>
            ) : null}
            {details.error ? (
                <EvidenceMessage
                    title="Judge detail error"
                    message={details.error}
                />
            ) : null}
            <Collapsible>
                <CollapsibleTrigger>Rubric</CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                    <p className="whitespace-pre-wrap text-copy-14 text-muted-foreground">
                        {details.rubricPrompt}
                    </p>
                </CollapsibleContent>
            </Collapsible>
        </section>
    );
}

/** The single weakest criterion, when one clearly stands out. */
function lowestCriterion<T extends { score: number }>(
    criteria: readonly T[],
): T | undefined {
    if (criteria.length < 2) return undefined;
    const min = Math.min(...criteria.map((criterion) => criterion.score));
    const lowest = criteria.filter((criterion) => criterion.score === min);
    return lowest.length === 1 ? lowest[0] : undefined;
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
