"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Check, CircleAlert } from "lucide-react";
import {
    MISSING_VALUE,
    fmtCost,
    fmtLatency,
    fmtTokens,
    sumTokens,
} from "@/lib/format";
import { Num } from "@/components/ui/num";
import { Card } from "@/components/ui/card";
import { RelativeTime } from "@/components/ui/relative-time";
import { SectionTitle } from "@/components/layout/section-title";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetBody,
} from "@/components/ui/sheet";
import { KeepFieldsOnReset } from "@/components/ui/keep-fields-on-reset";
import { JsonBlock } from "@/components/ui/json-block";
import {
    CellStatusBadge,
    ReviewVerdictBadge,
} from "@/components/ui/status-badge";
import { ScorePill } from "@/components/ui/score-pill";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImagePreview } from "@/components/runs/image-preview";
import {
    type DrawerPayload,
    type ReviewVerdict,
    type TranscriptJudgeMetricDetails,
    type TranscriptMetricDetails,
    formatTranscriptReferenceKind,
    toJudgeCriteria,
    toJudgeDetails,
    toTranscriptJudgeMetricDetails,
    toTranscriptMetricDetails,
    type SaveCellAnnotationAction,
} from "@/components/runs/types";
import { Metric, MetricList } from "@/components/ui/metric";

export function CellDrawer({
    open,
    onClose,
    data: dataProp,
    modelDisplayName: modelDisplayNameProp,
    saveCellAnnotationAction,
    onPrevious,
    onNext,
}: {
    open: boolean;
    onClose: () => void;
    data: DrawerPayload | null;
    modelDisplayName?: string;
    saveCellAnnotationAction: SaveCellAnnotationAction;
    onPrevious?: () => void;
    onNext?: () => void;
}) {
    // The parent clears `data` as soon as the drawer closes. Keep rendering the
    // last payload so the sheet can finish its exit animation before Radix
    // unmounts the content.
    const [retained, setRetained] = useState({
        data: dataProp,
        modelDisplayName: modelDisplayNameProp,
    });
    if (
        dataProp &&
        (dataProp !== retained.data ||
            modelDisplayNameProp !== retained.modelDisplayName)
    ) {
        setRetained({ data: dataProp, modelDisplayName: modelDisplayNameProp });
    }
    const [saveError, setSaveError] = useState<{
        cellId: string;
        message: string;
    }>();
    const data = dataProp ?? retained.data;
    const modelDisplayName = dataProp
        ? modelDisplayNameProp
        : retained.modelDisplayName;
    if (!data) return null;

    const judge = data.scores.find((s) => s.scorerType === "judge");
    const transcriptMetric = data.scores.find(
        (s) =>
            s.scorerType === "transcript_metric" &&
            !toTranscriptJudgeMetricDetails(s.detailsJson),
    );
    const transcriptJudgeMetric = data.scores.find(
        (s) =>
            s.scorerType === "transcript_judge" ||
            (s.scorerType === "transcript_metric" &&
                Boolean(toTranscriptJudgeMetricDetails(s.detailsJson))),
    );
    const judgeDetails = toJudgeDetails(judge?.detailsJson);
    const judgeCriteria = toJudgeCriteria(judge?.detailsJson);
    const transcriptMetricDetails = toTranscriptMetricDetails(
        transcriptMetric?.detailsJson,
    );
    const transcriptJudgeDetails = toTranscriptJudgeMetricDetails(
        transcriptJudgeMetric?.detailsJson,
    );
    const total = sumTokens(data.cell.promptTokens, data.cell.completionTokens);
    const save = async (formData: FormData) => {
        const result = await saveCellAnnotationAction(formData);
        if (result.ok) toast.success("Feedback saved.");
        setSaveError(
            result.ok
                ? undefined
                : {
                      cellId: data.cell.id,
                      message:
                          result.formError ?? "Couldn’t save the feedback.",
                  },
        );
        return result;
    };
    // On failure stay on this cell so the reviewer sees the error.
    const saveAndNext = async (formData: FormData) => {
        const result = await save(formData);
        if (result.ok) onNext?.();
    };
    const visibleSaveError =
        saveError?.cellId === data.cell.id ? saveError.message : undefined;

    return (
        <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
            <SheetContent side="right" className="max-w-2xl">
                <SheetHeader>
                    <SheetTitle>
                        {modelDisplayName ?? data.model.modelId}
                        {data.model.isReference && " (reference)"}
                    </SheetTitle>
                    <div className="flex flex-wrap items-center gap-2 text-copy-14 text-muted-foreground">
                        <CellStatusBadge status={data.cell.status} />
                        <ReviewVerdictBadge
                            verdict={data.cell.annotation?.verdict}
                        />
                        <Num>{fmtLatency(data.cell.latencyMs)}</Num>
                        <Num>{fmtCost(data.cell.costUsd)}</Num>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={onPrevious}
                            disabled={!onPrevious}
                        >
                            Previous
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={onNext}
                            disabled={!onNext}
                        >
                            Next
                        </Button>
                    </div>
                </SheetHeader>
                <SheetBody className="flex flex-col gap-6">
                    <section className="flex flex-col gap-3">
                        <SectionTitle as="h3">Reviewer feedback</SectionTitle>
                        <form
                            key={`${data.cell.id}:${
                                data.cell.annotation?.updatedAt ?? "new"
                            }`}
                            action={async (formData) => {
                                await save(formData);
                            }}
                            className="flex flex-col gap-3 rounded-sm bg-surface p-3"
                        >
                            <KeepFieldsOnReset />
                            <input
                                type="hidden"
                                name="runCellId"
                                value={data.cell.id}
                            />
                            <div className="flex flex-col gap-2">
                                <Label>Review status</Label>
                                <VerdictToggle
                                    defaultVerdict={
                                        data.cell.annotation?.verdict
                                    }
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor={`comment-${data.cell.id}`}>
                                    Comment
                                </Label>
                                <Textarea
                                    id={`comment-${data.cell.id}`}
                                    name="comment"
                                    defaultValue={
                                        data.cell.annotation?.comment ?? ""
                                    }
                                    placeholder="Add reviewer notes, concerns, or follow-up decisions for this output."
                                />
                            </div>
                            {visibleSaveError && (
                                <p
                                    role="alert"
                                    className="text-copy-14 text-error"
                                >
                                    {visibleSaveError}
                                </p>
                            )}
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-copy-14 text-muted-foreground">
                                    {data.cell.annotation ? (
                                        <>
                                            Last saved{" "}
                                            <RelativeTime
                                                value={
                                                    data.cell.annotation
                                                        .updatedAt
                                                }
                                            />
                                        </>
                                    ) : (
                                        "No feedback saved yet."
                                    )}
                                </p>
                                <SubmitButton
                                    size="sm"
                                    intent="save"
                                    loadingText="Saving feedback…"
                                >
                                    Save feedback
                                </SubmitButton>
                                {onNext && (
                                    <SaveAndNextButton
                                        formAction={saveAndNext}
                                    />
                                )}
                            </div>
                        </form>
                    </section>

                    <section className="flex flex-col gap-3">
                        <SectionTitle as="h3">Input</SectionTitle>
                        {data.item.storageKey && isAudioInput(data.item) && (
                            <audio
                                controls
                                src={`/api/images/${data.item.storageKey}`}
                                className="w-full max-w-xs"
                            >
                                Audio unavailable. Re-upload the dataset audio
                                or restore the upload file.
                            </audio>
                        )}
                        {data.item.storageKey && !isAudioInput(data.item) && (
                            <ImagePreview
                                storageKey={data.item.storageKey}
                                alt="Dataset item image"
                                fallback="Image unavailable. Re-upload the dataset image or restore the upload file."
                                className="max-w-xs"
                            />
                        )}
                        {data.item.inputText && (
                            <p className="text-copy-14 text-on-surface">
                                {data.item.inputText}
                            </p>
                        )}
                        {!data.item.storageKey && !data.item.inputText && (
                            <p className="text-copy-14 text-muted-foreground">
                                ({data.item.type})
                            </p>
                        )}
                    </section>

                    <section className="flex flex-col gap-3">
                        <SectionTitle as="h3">Usage</SectionTitle>
                        <MetricList className="sm:grid-cols-2">
                            <Metric
                                label="Prompt tokens"
                                value={fmtTokens(data.cell.promptTokens)}
                            />
                            <Metric
                                label="Completion tokens"
                                value={fmtTokens(data.cell.completionTokens)}
                            />
                            <Metric
                                label="Total tokens"
                                value={fmtTokens(total)}
                            />
                            <Metric
                                label="Latency / cost"
                                value={`${fmtLatency(data.cell.latencyMs)} · ${fmtCost(data.cell.costUsd)}`}
                            />
                        </MetricList>
                    </section>

                    <section className="flex flex-col gap-3">
                        <SectionTitle as="h3">Scores</SectionTitle>
                        <div className="flex flex-wrap gap-2">
                            <ScorePill score={judge?.score} label="judge" />
                            {transcriptMetric && (
                                <ScorePill
                                    score={transcriptMetric.score}
                                    label="transcript"
                                />
                            )}
                            {transcriptJudgeMetric && (
                                <ScorePill
                                    score={transcriptJudgeMetric.score}
                                    label="transcript judge"
                                />
                            )}
                        </div>
                    </section>

                    {transcriptMetricDetails && (
                        <TranscriptMetricSection
                            details={transcriptMetricDetails}
                        />
                    )}

                    {transcriptJudgeDetails && (
                        <TranscriptJudgeSection
                            details={transcriptJudgeDetails}
                        />
                    )}

                    {data.cell.error ? (
                        <section className="flex flex-col gap-3">
                            <SectionTitle as="h3" className="text-error">
                                Error
                            </SectionTitle>
                            <p className="text-copy-14">{data.cell.error}</p>
                        </section>
                    ) : (
                        <section className="flex flex-col gap-3">
                            <SectionTitle as="h3">Model output</SectionTitle>
                            <JsonBlock
                                data={data.cell.outputJson}
                                collapsible
                            />
                        </section>
                    )}

                    {judgeCriteria ? (
                        <section className="flex flex-col gap-3">
                            <SectionTitle as="h3">
                                Judge by criterion
                            </SectionTitle>
                            <ul className="flex flex-col gap-2">
                                {judgeCriteria.map((c, i) => (
                                    <li key={`${c.name}-${i}`}>
                                        <Card
                                            variant="inset"
                                            className="flex flex-col gap-1 p-3"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-label-12 text-on-surface">
                                                    {c.name}
                                                </span>
                                                <ScorePill
                                                    score={c.score}
                                                    label="judge"
                                                />
                                            </div>
                                            {c.reasoning && (
                                                <p className="text-copy-14 text-muted-foreground">
                                                    {c.reasoning}
                                                </p>
                                            )}
                                        </Card>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ) : judgeDetails && judgeDetails.fields.length > 0 ? (
                        <section className="flex flex-col gap-3">
                            <SectionTitle as="h3">Judge by field</SectionTitle>
                            <ul className="flex flex-col gap-2">
                                {judgeDetails.fields.map((f) => (
                                    <li key={f.field}>
                                        <Card
                                            variant="inset"
                                            className="flex flex-col gap-1 p-3"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-label-12 text-on-surface">
                                                    {f.field}
                                                </span>
                                                <ScorePill
                                                    score={f.score}
                                                    label="judge"
                                                />
                                            </div>
                                            {f.rationale && (
                                                <div className="text-copy-14 text-muted-foreground">
                                                    <JudgeRationale
                                                        text={f.rationale}
                                                    />
                                                </div>
                                            )}
                                        </Card>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ) : (
                        judge?.rationale && (
                            <section className="flex flex-col gap-3">
                                <SectionTitle as="h3">
                                    Judge rationale
                                </SectionTitle>
                                <Card
                                    variant="inset"
                                    className="p-3 text-copy-14 text-on-surface"
                                >
                                    <JudgeRationale text={judge.rationale} />
                                </Card>
                            </section>
                        )
                    )}
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}

function TranscriptMetricSection({
    details,
}: {
    details: TranscriptMetricDetails;
}) {
    return (
        <section className="flex flex-col gap-3">
            <SectionTitle as="h3">Transcript metrics</SectionTitle>
            <MetricList className="sm:grid-cols-2">
                <Metric label="WER" value={formatRate(details.wer)} />
                <Metric label="CER" value={formatRate(details.cer)} />
                {details.fillerStrippedWer !== undefined && (
                    <Metric
                        label="Filler-stripped WER"
                        value={formatRate(details.fillerStrippedWer)}
                    />
                )}
                <Metric
                    label="Word edits"
                    value={formatEditCounts(details.wordCounts)}
                />
                <Metric label="Reference" value={referenceSummary(details)} />
                {sttLayerSummary(details) && (
                    <Metric
                        mono
                        label="STT layer"
                        value={sttLayerSummary(details)}
                    />
                )}
                {details.domainTermRecall && (
                    <Metric
                        label="Domain terms"
                        value={formatCountedRate(
                            details.domainTermRecall.matched,
                            details.domainTermRecall.expected,
                            details.domainTermRecall.recall,
                        )}
                    />
                )}
                {details.numericAccuracy && (
                    <Metric
                        label="Numbers"
                        value={formatCountedRate(
                            details.numericAccuracy.matched,
                            details.numericAccuracy.expected,
                            details.numericAccuracy.accuracy,
                        )}
                    />
                )}
                {details.hardFailures && details.hardFailures.length > 0 && (
                    <Metric
                        label="Hard failures"
                        value={details.hardFailures.join(", ")}
                    />
                )}
                {details.diarization && (
                    <DiarizationMetricBoxes details={details.diarization} />
                )}
            </MetricList>
        </section>
    );
}

function DiarizationMetricBoxes({
    details,
}: {
    details: NonNullable<TranscriptMetricDetails["diarization"]>;
}) {
    return (
        <>
            <Metric label="DER" value={formatNullableRate(details.der)} />
            <Metric
                label="FA"
                value={formatNullableRate(details.falseAlarmRate ?? null)}
            />
            <Metric
                label="Miss"
                value={formatNullableRate(details.missedDetectionRate ?? null)}
            />
            <Metric
                label="Confusion"
                value={formatNullableRate(details.speakerConfusionRate ?? null)}
            />
            <Metric label="cpWER" value={formatNullableRate(details.cpWer)} />
            <Metric
                label="Concat WER"
                value={formatNullableRate(details.concatenatedWer)}
            />
            <Metric
                label="Speakers"
                value={`Delta ${details.speakerCountDelta}`}
            />
            {details.perSpeakerWer && (
                <Metric
                    label="Per speaker WER"
                    value={formatPerSpeakerWer(details.perSpeakerWer)}
                />
            )}
        </>
    );
}

function TranscriptJudgeSection({
    details,
}: {
    details: TranscriptJudgeMetricDetails;
}) {
    return (
        <section className="flex flex-col gap-3">
            <SectionTitle as="h3">Transcript judge</SectionTitle>
            <MetricList className="sm:grid-cols-2">
                <Metric mono label="Model" value={details.modelId} />
                <Metric
                    label="Reference"
                    value={formatTranscriptReferenceKind(details.referenceKind)}
                />
            </MetricList>
            {details.error ? (
                <p className="text-copy-14 text-error">{details.error}</p>
            ) : details.criteria && details.criteria.length > 0 ? (
                <TranscriptJudgeCriteria criteria={details.criteria} />
            ) : (
                <p className="text-copy-14 text-muted-foreground">
                    No criterion breakdown returned.
                </p>
            )}
        </section>
    );
}

function TranscriptJudgeCriteria({
    criteria,
}: {
    criteria: NonNullable<TranscriptJudgeMetricDetails["criteria"]>;
}) {
    return (
        <ul className="flex flex-col gap-2">
            {criteria.map((criterion, index) => (
                <li key={`${criterion.name}-${index}`}>
                    <Card variant="inset" className="flex flex-col gap-1 p-3">
                        <div className="flex items-center gap-2">
                            <span className="text-label-12 text-on-surface">
                                {criterion.name}
                            </span>
                            <ScorePill score={criterion.score} label="judge" />
                        </div>
                        <p className="text-copy-14 text-muted-foreground">
                            {criterion.reasoning}
                        </p>
                    </Card>
                </li>
            ))}
        </ul>
    );
}

function referenceSummary(details: TranscriptMetricDetails): string {
    return [
        details.referenceField,
        formatTranscriptReferenceKind(details.referenceKind),
    ]
        .filter(Boolean)
        .join(" / ");
}

function sttLayerSummary(details: TranscriptMetricDetails): string {
    return [details.sttModelId, details.transcriptVariant, details.routeId]
        .filter(Boolean)
        .join(" / ");
}

function formatRate(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function formatNullableRate(value: number | null): string {
    return value === null ? MISSING_VALUE : formatRate(value);
}

function formatCountedRate(
    matched: number,
    expected: number,
    rate: number,
): string {
    return `${matched}/${expected} (${formatRate(rate)})`;
}

function formatPerSpeakerWer(values: Record<string, number>): string {
    return Object.entries(values)
        .map(([speaker, value]) => `${speaker}: ${formatRate(value)}`)
        .join(", ");
}

function formatEditCounts(counts: {
    substitutions: number;
    deletions: number;
    insertions: number;
    referenceLength: number;
}): string {
    return `S${counts.substitutions} D${counts.deletions} I${counts.insertions} / ${counts.referenceLength}`;
}

// Two-option review toggle (Approved / Issue). "needs_review"/"unreviewed" are
// kept as graceful display states but are no longer selectable. A hidden input
// carries the chosen verdict so the existing form action keeps working.
function VerdictToggle({
    defaultVerdict,
}: {
    defaultVerdict: ReviewVerdict | undefined;
}) {
    const [verdict, setVerdict] = useState<ReviewVerdict>(
        defaultVerdict ?? "unreviewed",
    );
    const options: {
        value: ReviewVerdict;
        label: string;
        icon: typeof Check;
    }[] = [
        { value: "approved", label: "Approved", icon: Check },
        { value: "issue", label: "Issue", icon: CircleAlert },
    ];

    return (
        <div className="flex flex-col gap-2">
            <input type="hidden" name="verdict" value={verdict} />
            <div
                role="radiogroup"
                aria-label="Review status"
                className="flex gap-2"
            >
                {options.map((option) => {
                    const Icon = option.icon;
                    const selected = verdict === option.value;
                    return (
                        <Button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            variant={selected ? "default" : "secondary"}
                            size="sm"
                            onClick={() => setVerdict(option.value)}
                        >
                            <Icon className="size-4" aria-hidden="true" />
                            {option.label}
                        </Button>
                    );
                })}
            </div>
            {(verdict === "needs_review" || verdict === "unreviewed") && (
                <p className="text-copy-14 text-muted-foreground">
                    {verdict === "needs_review"
                        ? "Previously marked needs review. Choose Approved or Issue to update."
                        : "Not reviewed yet. Choose Approved or Issue."}
                </p>
            )}
        </div>
    );
}

// Judges often pack numbered criteria ("1) … 2) … 3) …") into one string with
// no line breaks. Render those as a list; otherwise preserve any newlines.
function splitNumberedRationale(text: string): string[] | undefined {
    const matches = [...text.matchAll(/(?:^|\s)(\d+)\)\s/g)];
    if (matches.length < 2) return undefined;
    const items: string[] = [];
    for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index ?? 0;
        const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
        const segment = text
            .slice(start, end)
            .replace(/^\s*\d+\)\s*/, "")
            .trim();
        if (segment) items.push(segment);
    }
    return items.length >= 2 ? items : undefined;
}

function JudgeRationale({ text }: { text: string }) {
    const items = splitNumberedRationale(text);
    if (items) {
        return (
            <ol className="list-decimal space-y-2 pl-6">
                {items.map((item, i) => (
                    <li key={i}>{item}</li>
                ))}
            </ol>
        );
    }
    return <p className="whitespace-pre-wrap">{text}</p>;
}

function isAudioInput(item: {
    type: string;
    mimeType?: string | null;
}): boolean {
    return (
        item.type === "audio" || item.mimeType?.startsWith("audio/") === true
    );
}

// "Save feedback" submits intent=save; this button's function formAction
// can't carry an intent, so any other pending submission is this one.
function SaveAndNextButton({
    formAction,
}: {
    formAction: (formData: FormData) => Promise<void>;
}) {
    const { pending, data } = useFormStatus();
    return (
        <Button
            type="submit"
            size="sm"
            variant="secondary"
            formAction={formAction}
            disabled={pending}
            loading={pending && data?.get("intent") !== "save"}
            loadingText="Saving feedback…"
        >
            Save and next
        </Button>
    );
}
