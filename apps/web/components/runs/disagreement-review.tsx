"use client";

import { useEffect, useState, useTransition } from "react";
import { Check } from "lucide-react";
import type {
    IRunDisagreement,
    IRunDisagreementsResponse,
} from "@flash-evals/api-contract";
import type { IDecideResult, IDisagreementsResult } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";

export interface IDisagreementTarget {
    runModelId: string;
    taskKey: string;
    modelName: string;
    taskName: string;
}

export type LoadDisagreements = (input: {
    runId: string;
    runModelId: string;
    taskKey: string;
}) => Promise<IDisagreementsResult>;

export type DecideDisagreement = (input: {
    runId: string;
    cellId: string;
    taskKey: string;
    path: string;
    choice: "candidate" | "benchmark";
}) => Promise<IDecideResult>;

/** "$.customer_details.type" -> "customer_details.type" */
export function fieldName(path: string): string {
    return path.startsWith("$.") ? path.slice(2) : path;
}

/** A field value in plain text: lists joined, empty shown as "(none)". */
export function showValue(value: unknown): string {
    if (value === undefined || value === null || value === "") return "(none)";
    if (Array.isArray(value))
        return value.length === 0 ? "(none)" : value.map(showValue).join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

/**
 * For two lists, what only one side has (case and spacing ignored), so a
 * reviewer doesn't have to compare long lists by eye. Undefined otherwise.
 */
export function listDifference(
    candidate: unknown,
    benchmark: unknown,
): { onlyCandidate: string[]; onlyBenchmark: string[] } | undefined {
    if (!Array.isArray(candidate) || !Array.isArray(benchmark))
        return undefined;
    const key = (value: unknown) => showValue(value).trim().toLowerCase();
    const theirs = new Set(benchmark.map(key));
    const ours = new Set(candidate.map(key));
    return {
        onlyCandidate: candidate
            .filter((value) => !theirs.has(key(value)))
            .map(showValue),
        onlyBenchmark: benchmark
            .filter((value) => !ours.has(key(value)))
            .map(showValue),
    };
}

/** The latest decision on one field, as the panel shows it. */
function decisionFor(item: IRunDisagreement, path: string) {
    return item.decisions.find((decision) => decision.path === path);
}

/**
 * The transcripts behind one task-grid cell: where the model and its
 * yardstick differ, side by side, with a button to record who was right.
 * The chosen answer becomes the transcript's stored answer in the dataset.
 */
export function DisagreementReview({
    runId,
    target,
    referenceName,
    onClose,
    loadAction,
    decideAction,
}: {
    runId: string;
    target: IDisagreementTarget | undefined;
    /** The reference model's readable name, for "Sonnet said". */
    referenceName: string | undefined;
    onClose: () => void;
    loadAction: LoadDisagreements;
    decideAction: DecideDisagreement;
}) {
    const [result, setResult] = useState<IDisagreementsResult>();
    useEffect(() => {
        if (!target) return;
        let current = true;
        setResult(undefined);
        void loadAction({
            runId,
            runModelId: target.runModelId,
            taskKey: target.taskKey,
        }).then((next) => {
            if (current) setResult(next);
        });
        return () => {
            current = false;
        };
    }, [runId, target, loadAction]);

    return (
        <Sheet
            open={target !== undefined}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <SheetContent className="max-w-3xl">
                <SheetHeader>
                    <SheetTitle>
                        {target
                            ? `${target.modelName} × ${target.taskName}`
                            : "Disagreements"}
                    </SheetTitle>
                    {result?.ok && (
                        <Summary
                            data={result.data}
                            modelName={target?.modelName ?? ""}
                            referenceName={referenceName}
                        />
                    )}
                </SheetHeader>
                <SheetBody className="flex flex-col gap-4">
                    {!result && (
                        <p
                            role="status"
                            className="flex items-center gap-2 text-copy-14 text-muted-foreground"
                        >
                            <Spinner className="size-4" /> Loading the
                            transcripts…
                        </p>
                    )}
                    {result && !result.ok && (
                        <p role="alert" className="text-copy-14 text-error">
                            {result.error}
                        </p>
                    )}
                    {result?.ok &&
                        result.data.disagreements.map((item, index) => (
                            <DisagreementCard
                                key={item.cellId}
                                runId={runId}
                                data={result.data}
                                item={item}
                                index={index}
                                modelName={target?.modelName ?? "The model"}
                                yardstickName={yardstickName(
                                    result.data,
                                    referenceName,
                                )}
                                decideAction={decideAction}
                            />
                        ))}
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}

export function yardstickName(
    data: Pick<IRunDisagreementsResponse, "yardstick" | "referenceModelId">,
    referenceName: string | undefined,
): string {
    return data.yardstick === "labels"
        ? "The stored answer"
        : (referenceName ?? data.referenceModelId ?? "The reference model");
}

function Summary({
    data,
    modelName,
    referenceName,
}: {
    data: IRunDisagreementsResponse;
    modelName: string;
    referenceName: string | undefined;
}) {
    const against =
        data.yardstick === "labels"
            ? "the stored answers"
            : `${referenceName ?? "the reference model"}'s answers`;
    const differ = data.disagreements.length;
    return (
        <div className="flex flex-col gap-1 text-copy-14 text-muted-foreground">
            <p>
                {data.method === "rubric"
                    ? differ === 0
                        ? `${modelName} scored at least as well as ${referenceName ?? "today's model"} on every criterion, on all ${data.compared} transcripts.`
                        : `On ${differ} of ${data.compared} transcripts, ${modelName} scored below ${referenceName ?? "today's model"} on at least one criterion (or, without its score, 2 or lower), or the judge failed.`
                    : data.method === "rules"
                      ? differ === 0
                          ? `${modelName} passed every check on all ${data.compared} transcripts.`
                          : `${modelName} broke at least one check on ${differ} of ${data.compared} transcripts.`
                      : differ === 0
                        ? `${modelName} matches ${against} on all ${data.compared} transcripts.`
                        : data.method === "head_to_head"
                          ? `The judge preferred ${against} on ${differ} of ${data.compared} transcripts.`
                          : `${differ} of ${data.compared} transcripts differ from ${against}.`}
            </p>
            {data.method === "agreement" && differ > 0 && (
                <p>
                    Choosing who was right saves that answer as the
                    transcript&apos;s stored answer in the dataset, with a
                    record of the change. Later runs are scored against it; this
                    run&apos;s numbers stay as they are.
                </p>
            )}
        </div>
    );
}

function DisagreementCard({
    runId,
    data,
    item,
    index,
    modelName,
    yardstickName: otherName,
    decideAction,
}: {
    runId: string;
    data: IRunDisagreementsResponse;
    item: IRunDisagreement;
    index: number;
    modelName: string;
    yardstickName: string;
    decideAction: DecideDisagreement;
}) {
    const title = item.itemName ?? `Transcript ${index + 1}`;
    return (
        <article
            aria-label={title}
            className="flex flex-col gap-3 rounded-sm border border-border p-4"
        >
            <h3 className="text-label-14 text-on-surface">{title}</h3>
            {item.failed && (
                <p className="text-copy-14 text-muted-foreground">
                    {modelName} gave no usable answer
                    {item.error ? `: ${item.error}` : ""}. It counts as a miss.
                </p>
            )}
            {item.fields.map((field) => (
                <FieldDecision
                    key={field.path}
                    runId={runId}
                    taskKey={data.taskKey}
                    cellId={item.cellId}
                    field={field}
                    initial={decisionFor(item, field.path)}
                    modelName={modelName}
                    otherName={otherName}
                    decideAction={decideAction}
                />
            ))}
            {item.brokenRules && item.brokenRules.length > 0 && (
                <BrokenRules rules={item.brokenRules} />
            )}
            {item.criterionScores && (
                <RubricScores
                    scores={item.criterionScores}
                    error={item.error}
                    modelName={modelName}
                    otherName={otherName}
                />
            )}
            {(data.method === "head_to_head" || data.method === "rubric") &&
                !item.failed && (
                    <JudgedAnswers
                        item={item}
                        modelName={modelName}
                        otherName={otherName}
                    />
                )}
            {item.inputText && (
                <details className="text-copy-14">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Show the transcript
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface p-3 text-copy-13">
                        {item.inputText}
                    </pre>
                </details>
            )}
        </article>
    );
}

function RubricScores({
    scores,
    error,
    modelName,
    otherName,
}: {
    scores: NonNullable<IRunDisagreement["criterionScores"]>;
    error: string | undefined;
    modelName: string;
    otherName: string;
}) {
    if (error)
        return (
            <p className="text-copy-14 text-muted-foreground">
                The judge could not score this answer: {error}
            </p>
        );
    return (
        <ul className="flex flex-col gap-2 text-copy-14">
            {scores.map((criterion) => {
                const below =
                    criterion.score !== undefined &&
                    criterion.referenceScore !== undefined &&
                    criterion.score < criterion.referenceScore;
                return (
                    <li key={criterion.key} className="flex flex-col gap-1">
                        <span
                            className={
                                below ? "text-eval-danger" : "text-on-surface"
                            }
                        >
                            {criterion.name}: {modelName}{" "}
                            {criterion.score ?? "–"}
                            {criterion.referenceScore !== undefined &&
                                `, ${otherName} ${criterion.referenceScore}`}{" "}
                            (out of 5)
                        </span>
                        {criterion.reasoning && (
                            <span className="text-muted-foreground">
                                Judge: {criterion.reasoning}
                            </span>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

function BrokenRules({
    rules,
}: {
    rules: NonNullable<IRunDisagreement["brokenRules"]>;
}) {
    return (
        <ul className="flex flex-col gap-2 text-copy-14">
            {rules.map((rule) => (
                <li key={rule.key} className="flex flex-col gap-1">
                    <span className="text-on-surface">{rule.name}</span>
                    {rule.offending.length > 0 && (
                        <span className="text-mono-13 text-muted-foreground">
                            Found: {rule.offending.join(" · ")}
                        </span>
                    )}
                </li>
            ))}
        </ul>
    );
}

function FieldDecision({
    runId,
    taskKey,
    cellId,
    field,
    initial,
    modelName,
    otherName,
    decideAction,
}: {
    runId: string;
    taskKey: string;
    cellId: string;
    field: IRunDisagreement["fields"][number];
    initial: IRunDisagreement["decisions"][number] | undefined;
    modelName: string;
    otherName: string;
    decideAction: DecideDisagreement;
}) {
    const [choice, setChoice] = useState(initial?.choice);
    const [error, setError] = useState<string>();
    const [pending, startTransition] = useTransition();
    const decide = (next: "candidate" | "benchmark") =>
        startTransition(async () => {
            setError(undefined);
            const result = await decideAction({
                runId,
                cellId,
                taskKey,
                path: field.path,
                choice: next,
            });
            if (result.ok) setChoice(next);
            else setError(result.error);
        });
    return (
        <div className="flex flex-col gap-2">
            <span className="text-label-12 text-muted-foreground">
                {fieldName(field.path)}
            </span>
            <dl className="grid gap-2 sm:grid-cols-2">
                <Said
                    who={`${modelName} said`}
                    value={field.candidate}
                    chosen={choice === "candidate"}
                />
                <Said
                    who={`${otherName} said`}
                    value={field.benchmark}
                    chosen={choice === "benchmark"}
                />
            </dl>
            <ListDifference
                field={field}
                modelName={modelName}
                otherName={otherName}
            />
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant={choice === "candidate" ? "default" : "secondary"}
                    disabled={pending}
                    aria-pressed={choice === "candidate"}
                    onClick={() => decide("candidate")}
                >
                    {modelName} is right
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={choice === "benchmark" ? "default" : "secondary"}
                    disabled={pending}
                    aria-pressed={choice === "benchmark"}
                    onClick={() => decide("benchmark")}
                >
                    {otherName} is right
                </Button>
                <span
                    role="status"
                    className="text-label-12 text-muted-foreground"
                >
                    {pending
                        ? "Saving…"
                        : choice
                          ? "Saved as the stored answer."
                          : ""}
                </span>
            </div>
            {error && (
                <p role="alert" className="text-copy-14 text-error">
                    {error}
                </p>
            )}
        </div>
    );
}

function ListDifference({
    field,
    modelName,
    otherName,
}: {
    field: IRunDisagreement["fields"][number];
    modelName: string;
    otherName: string;
}) {
    const diff = listDifference(field.candidate, field.benchmark);
    if (!diff) return null;
    const lines = [
        ...(diff.onlyCandidate.length > 0
            ? [`Only ${modelName}: ${diff.onlyCandidate.join(", ")}`]
            : []),
        ...(diff.onlyBenchmark.length > 0
            ? [
                  `Only ${otherName.replace(/^The /, "the ")}: ${diff.onlyBenchmark.join(", ")}`,
              ]
            : []),
    ];
    if (lines.length === 0) return null;
    return (
        <ul className="flex flex-col text-copy-14 text-on-surface">
            {lines.map((line) => (
                <li key={line}>{line}</li>
            ))}
        </ul>
    );
}

function Said({
    who,
    value,
    chosen,
}: {
    who: string;
    value: unknown;
    chosen: boolean;
}) {
    return (
        <div className="flex flex-col gap-1 rounded-sm bg-surface p-3">
            <dt className="flex items-center gap-2 text-label-12 text-muted-foreground">
                {who}
                {chosen && (
                    <Badge variant="success" className="gap-1">
                        <Check className="size-3" aria-hidden="true" />
                        Right
                    </Badge>
                )}
            </dt>
            <dd className="m-0 break-words text-copy-14 text-on-surface">
                {showValue(value)}
            </dd>
        </div>
    );
}

function JudgedAnswers({
    item,
    modelName,
    otherName,
}: {
    item: IRunDisagreement;
    modelName: string;
    otherName: string;
}) {
    const paths = Object.keys(item.candidateAnswer ?? {});
    return (
        <div className="flex flex-col gap-2">
            {item.rationale && (
                <div className="flex flex-col gap-1">
                    {item.candidateLetter && (
                        <span className="text-label-12 text-muted-foreground">
                            {`In the judge's notes, A is ${
                                item.candidateLetter === "A"
                                    ? modelName
                                    : otherName.replace(/^The /, "the ")
                            } and B is ${
                                item.candidateLetter === "A"
                                    ? otherName.replace(/^The /, "the ")
                                    : modelName
                            }.`}
                        </span>
                    )}
                    <p className="text-copy-14 text-on-surface">
                        <span className="text-label-12 text-muted-foreground">
                            Judge:{" "}
                        </span>
                        {item.rationale}
                    </p>
                </div>
            )}
            <details className="text-copy-14">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Compare the two answers
                </summary>
                <div className="mt-2 flex flex-col gap-3">
                    {paths.map((path) => (
                        <div key={path} className="flex flex-col gap-1">
                            <span className="text-label-12 text-muted-foreground">
                                {fieldName(path)}
                            </span>
                            <dl className="grid gap-2 sm:grid-cols-2">
                                <Said
                                    who={`${modelName} said`}
                                    value={item.candidateAnswer?.[path]}
                                    chosen={false}
                                />
                                <Said
                                    who={`${otherName} said`}
                                    value={item.benchmarkAnswer?.[path]}
                                    chosen={false}
                                />
                            </dl>
                        </div>
                    ))}
                </div>
            </details>
            <p className="text-label-12 text-muted-foreground">
                Judged write-ups can&apos;t be saved as stored answers here.
            </p>
        </div>
    );
}
