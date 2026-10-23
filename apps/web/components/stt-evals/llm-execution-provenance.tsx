"use client";

import type { ReactNode } from "react";
import type { IWorkflowRunCellLlmExecution } from "@flash-evals/api-contract";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SectionTitle } from "@/components/layout/section-title";
import { cn } from "@/lib/cn";
import {
    MISSING_VALUE,
    fmtCost,
    fmtLatency,
    fmtTokens,
    formatCostColumn,
} from "@/lib/format";
import { CopyButton } from "@/components/ui/copy-button";
import { HintText } from "@/components/ui/hint";
import { Metric, MetricList } from "@/components/ui/metric";
import {
    FLASH_EVALS_REUSE_LABELS,
    RETRY_OWNER_LABELS,
    TRANSPORT_LABELS,
    humanize,
    labelFor,
} from "@/lib/labels";

type CompleteExecution = Extract<
    IWorkflowRunCellLlmExecution,
    { availability: "complete" }
>;

/**
 * The few execution facts a reader needs next to a result: the model that
 * answered, where it ran, and what it cost. The full route lives in
 * `LlmExecutionDetails`.
 */
export function LlmExecutionSummary({
    execution,
}: {
    execution: IWorkflowRunCellLlmExecution | undefined;
}) {
    if (execution?.availability !== "complete") return null;
    const identity =
        execution.actual.status === "resolved"
            ? execution.actual.identity
            : undefined;
    const modelId = identity?.modelId ?? execution.resolved.route.modelId;
    const transport =
        identity?.transport ??
        execution.resolved.route.transportConfig.transport;
    const ranOn = [
        labelFor(TRANSPORT_LABELS, transport),
        identity?.upstreamProvider,
    ]
        .filter(Boolean)
        .join(" · ");
    const { inputTokens, outputTokens } = execution.usage;
    return (
        <section aria-label="Execution summary" className="flex flex-col gap-3">
            {fallbackWasObserved(execution.attempts) ? (
                <div>
                    <Badge variant="warning">Fallback observed</Badge>
                </div>
            ) : null}
            <MetricList className="grid-cols-2 gap-4 sm:grid-cols-3">
                <Metric
                    plain
                    mono
                    label="Model"
                    value={modelId}
                    className="col-span-2 sm:col-span-1"
                />
                <Metric plain label="Ran on" value={ranOn} />
                <Metric
                    plain
                    label="Cost"
                    value={fmtCost(execution.currentCost.usd)}
                />
                <Metric
                    plain
                    label="Latency"
                    value={fmtLatency(execution.currentLatencyMs)}
                />
                <Metric
                    plain
                    label="Tokens"
                    value={
                        inputTokens === undefined && outputTokens === undefined
                            ? MISSING_VALUE
                            : `${fmtTokens(inputTokens)} in · ${fmtTokens(outputTokens)} out`
                    }
                />
            </MetricList>
        </section>
    );
}

/** The full routing audit trail: route, usage, captured settings, IDs. */
export function LlmExecutionDetails({
    execution,
}: {
    execution: IWorkflowRunCellLlmExecution | undefined;
}) {
    if (!execution) return null;
    if (execution.availability === "legacy_unavailable")
        return (
            <Card
                variant="inset"
                className="flex flex-col gap-1 p-4"
                role="region"
                aria-label="LLM routing provenance"
            >
                <SectionTitle as="h3">
                    Legacy routing evidence unavailable
                </SectionTitle>
                <p className="text-copy-14 text-muted-foreground">
                    This historical result predates captured LLM routing
                    provenance. Flash Evals does not derive it from current
                    settings.
                </p>
            </Card>
        );

    const route = execution.resolved.route;
    const complete = execution.availability === "complete" ? execution : null;
    return (
        <div
            role="region"
            aria-label="LLM routing provenance"
            className="flex flex-col gap-8"
        >
            <section aria-label="Route" className="flex flex-col gap-2">
                <SectionTitle
                    as="h3"
                    actions={
                        <Badge
                            variant={
                                complete &&
                                fallbackWasObserved(complete.attempts)
                                    ? "warning"
                                    : "outline"
                            }
                        >
                            {fallbackLabel(execution)}
                        </Badge>
                    }
                >
                    Route
                </SectionTitle>
                <DetailList>
                    <DetailRow mono label="Requested">
                        {selectionLabel(execution.requested)}
                    </DetailRow>
                    <DetailRow mono label="Resolved">
                        {[
                            route.transportConfig.transport,
                            route.modelId,
                            transportPolicyLabel(route.transportConfig),
                            `route v${execution.resolved.routeVersion}`,
                        ]
                            .filter(Boolean)
                            .join(" · ")}
                    </DetailRow>
                    <DetailRow mono label="Actual">
                        {complete
                            ? actualIdentityLabel(complete.actual)
                            : "Unavailable"}
                    </DetailRow>
                </DetailList>
            </section>
            {complete ? (
                <UsageSection execution={complete} />
            ) : (
                <p className="text-copy-14 text-muted-foreground">
                    The immutable route is available, but actual route, cache,
                    usage, and cost evidence has not been recorded.
                </p>
            )}
            <section
                aria-label="Captured settings"
                className="flex flex-col gap-2"
            >
                <SectionTitle as="h3">Captured settings</SectionTitle>
                <DetailList>
                    <DetailRow label="Generation">
                        {generationLabel(route)}
                    </DetailRow>
                    <DetailRow label="Retry and timeout">
                        {`${labelFor(RETRY_OWNER_LABELS, route.retry.owner)} · ${route.retry.timeoutMs.toLocaleString()} ms${
                            route.retry.owner === "flash-evals"
                                ? ` · ${route.retry.maxAttempts} attempt${
                                      route.retry.maxAttempts === 1 ? "" : "s"
                                  }`
                                : ""
                        }`}
                    </DetailRow>
                    <DetailRow label="Flash Evals reuse">
                        {labelFor(FLASH_EVALS_REUSE_LABELS, route.cache.flashEvalsReuse)}
                    </DetailRow>
                    <DetailRow label="Provider caching">
                        {humanize(route.cache.providerCaching)}
                    </DetailRow>
                </DetailList>
            </section>
            {complete && attemptsWorthShowing(complete.attempts) ? (
                <Attempts attempts={complete.attempts} />
            ) : null}
            <Collapsible>
                <CollapsibleTrigger>Identifiers</CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                    <DetailList>
                        {complete &&
                        "generationId" in complete.actual &&
                        complete.actual.generationId ? (
                            <CopyableRow
                                label="Generation ID"
                                value={complete.actual.generationId}
                            />
                        ) : null}
                        <CopyableRow
                            label="Credential"
                            value={`${execution.resolved.credential.hint ?? execution.resolved.credential.providerKeyId} · rotation ${execution.resolved.credential.rotationVersion}`}
                            copyValue={
                                execution.resolved.credential.providerKeyId
                            }
                        />
                        <CopyableRow
                            label="Capability"
                            value={
                                execution.resolved.capability.capabilityDigest
                            }
                        />
                    </DetailList>
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}

function UsageSection({ execution }: { execution: CompleteExecution }) {
    // The current and origin cost share one unit and precision.
    const fmtExecutionCost = formatCostColumn([
        execution.currentCost.usd,
        execution.originCost?.usd,
    ]);
    const cache = execution.cache;
    return (
        <section aria-label="Usage" className="flex flex-col gap-2">
            <SectionTitle as="h3">Usage</SectionTitle>
            <UsageFacts usage={execution.usage} />
            <DetailList>
                <DetailRow label="Current cost">
                    {costLabel(execution.currentCost, fmtExecutionCost)}
                </DetailRow>
                {execution.originCost ? (
                    <DetailRow label="Origin cost">
                        {costLabel(execution.originCost, fmtExecutionCost)}
                    </DetailRow>
                ) : null}
                {execution.currentLatencyMs !== undefined ? (
                    <DetailRow label="Current latency">
                        {`${execution.currentLatencyMs.toLocaleString()} ms`}
                    </DetailRow>
                ) : null}
                {execution.originLatencyMs !== undefined ? (
                    <DetailRow label="Origin latency">
                        {`${execution.originLatencyMs.toLocaleString()} ms`}
                    </DetailRow>
                ) : null}
                <DetailRow label="Cache result">{cacheLabel(cache)}</DetailRow>
                {cache.status === "flash_evals_reuse" && cache.sourceRunId ? (
                    <CopyableRow label="Source run" value={cache.sourceRunId} />
                ) : null}
                {cache.status === "flash_evals_reuse" && cache.sourceCellId ? (
                    <CopyableRow
                        label="Source cell"
                        value={cache.sourceCellId}
                    />
                ) : null}
            </DetailList>
        </section>
    );
}

function Attempts({ attempts }: { attempts: CompleteExecution["attempts"] }) {
    return (
        <section aria-label="Attempts" className="flex flex-col gap-2">
            <SectionTitle as="h3">Attempts</SectionTitle>
            <ol className="flex flex-col">
                {attempts.map((attempt) => (
                    <li
                        key={`${attempt.owner}-${attempt.sequence}`}
                        className="flex flex-col gap-1 border-b border-border py-2 text-copy-14 last:border-0"
                    >
                        <span>
                            <span className="text-mono-13">
                                {attempt.sequence}. {attempt.owner}
                            </span>{" "}
                            · {attempt.outcome}
                            {attempt.errorClass
                                ? ` · ${attempt.errorClass}`
                                : ""}
                        </span>
                        <p className="text-mono-13 text-muted-foreground">
                            Requested {routeIdentityLabel(attempt.requested)}
                            {attempt.actual
                                ? ` → Actual ${actualIdentityLabel(attempt.actual)}`
                                : ""}
                        </p>
                    </li>
                ))}
            </ol>
        </section>
    );
}

/** Label-value rows: labels in the first column, values in the other two. */
function DetailList({ children }: { children: ReactNode }) {
    return <dl className="grid grid-cols-3 text-copy-14">{children}</dl>;
}

function DetailRow({
    label,
    mono = false,
    children,
}: {
    label: string;
    /** Identifiers and routes are mono; settings, counts and costs are not. */
    mono?: boolean;
    children: ReactNode;
}) {
    return (
        <>
            <dt className="border-b border-border py-2 pr-3 text-label-12 text-muted-foreground">
                {label}
            </dt>
            <dd
                className={cn(
                    "col-span-2 min-w-0 border-b border-border py-2 wrap-break-word tabular-nums",
                    mono && "text-mono-13",
                )}
            >
                {children}
            </dd>
        </>
    );
}

/** One-line identifier with the full value on hover and a copy button. */
function CopyableRow({
    label,
    value,
    copyValue = value,
}: {
    label: string;
    value: string;
    copyValue?: string;
}) {
    return (
        <>
            <dt className="border-b border-border py-2 pr-3 text-label-12 text-muted-foreground">
                {label}
            </dt>
            <dd className="col-span-2 flex min-w-0 items-center gap-1 border-b border-border py-2">
                <HintText
                    hint={<span className="break-all">{value}</span>}
                    className="block min-w-0 truncate text-mono-13"
                >
                    {value}
                </HintText>
                <CopyButton value={copyValue} what={label} />
            </dd>
        </>
    );
}

function UsageFacts({ usage }: { usage: CompleteExecution["usage"] }) {
    const facts = [
        ["Input tokens", usage.inputTokens],
        ["Output tokens", usage.outputTokens],
        ["Reasoning tokens", usage.reasoningTokens],
        ["Cache read tokens", usage.cacheReadTokens],
        ["Cache write tokens", usage.cacheWriteTokens],
        ["Total tokens", usage.totalTokens],
    ] as const;
    const reported = facts.filter(([, value]) => value !== undefined);
    if (!reported.length) return null;
    return (
        <MetricList className="grid-cols-2 gap-4 pb-2 sm:grid-cols-4">
            {reported.map(([label, value]) => (
                <Metric
                    key={label}
                    plain
                    label={label}
                    value={value!.toLocaleString()}
                />
            ))}
        </MetricList>
    );
}

function fallbackLabel(
    execution: Exclude<
        IWorkflowRunCellLlmExecution,
        { availability: "legacy_unavailable" }
    >,
): string {
    if (execution.availability !== "complete")
        return "Execution evidence unavailable";
    if (fallbackWasObserved(execution.attempts)) return "Fallback observed";
    const evidenceMissing =
        execution.actual.status === "unresolved" ||
        execution.actual.status === "unavailable" ||
        execution.actual.status === "legacy_unresolved" ||
        execution.actual.evidenceCompleteness !== "complete";
    return evidenceMissing
        ? "Fallback evidence unavailable"
        : "No fallback observed";
}

/** A single successful attempt adds nothing the route doesn't already say. */
function attemptsWorthShowing(attempts: CompleteExecution["attempts"]) {
    return (
        attempts.length > 1 ||
        attempts.some((attempt) => attempt.outcome !== "succeeded")
    );
}

function selectionLabel(
    selection: Extract<
        IWorkflowRunCellLlmExecution,
        { availability: "complete" | "partial" }
    >["requested"],
): string {
    if (selection.mode === "simple") return `Simple · ${selection.transport}`;
    return selection.mode === "project_default"
        ? "Project default"
        : `Pinned route ${selection.routeVersionId}`;
}

function transportPolicyLabel(
    transport: Extract<
        IWorkflowRunCellLlmExecution,
        { availability: "complete" | "partial" }
    >["resolved"]["route"]["transportConfig"],
): string | undefined {
    if (transport.transport === "openrouter")
        return transport.upstreamPolicy.mode;
    if (transport.transport === "gateway") return "gateway auto";
    if (transport.transport === "bifrost") return "bifrost default";
    return undefined;
}

function actualIdentityLabel(
    actual: Extract<
        IWorkflowRunCellLlmExecution,
        { availability: "complete" }
    >["actual"],
): string {
    if (actual.status !== "resolved")
        return `${actualStatusLabel(actual.status)} · ${actual.evidenceCompleteness} evidence`;
    const identity = actual.identity;
    return (
        [identity?.transport, identity?.modelId, identity?.upstreamProvider]
            .filter(Boolean)
            .join(" · ") || "Resolved identity unavailable"
    );
}

function routeIdentityLabel(
    identity: Extract<
        IWorkflowRunCellLlmExecution,
        { availability: "complete" }
    >["attempts"][number]["requested"],
): string {
    return (
        [identity.transport, identity.modelId, identity.upstreamProvider]
            .filter(Boolean)
            .join(" · ") || "Unavailable"
    );
}

function fallbackWasObserved(
    attempts: Extract<
        IWorkflowRunCellLlmExecution,
        { availability: "complete" }
    >["attempts"],
): boolean {
    return attempts.some((attempt, index) => {
        const previous = attempts[index - 1];
        if (
            previous &&
            routeIdentitiesDiffer(previous.requested, attempt.requested)
        )
            return true;
        return (
            attempt.actual?.status === "resolved" &&
            attempt.actual.identity !== undefined &&
            routeIdentitiesDiffer(
                attempt.requested,
                attempt.actual.identity,
                true,
            )
        );
    });
}

function routeIdentitiesDiffer(
    requested: Extract<
        IWorkflowRunCellLlmExecution,
        { availability: "complete" }
    >["attempts"][number]["requested"],
    observed: Extract<
        IWorkflowRunCellLlmExecution,
        { availability: "complete" }
    >["attempts"][number]["requested"],
    compareRequestedFieldsOnly = false,
): boolean {
    const fields = ["transport", "modelId", "upstreamProvider"] as const;
    return fields.some(
        (field) =>
            (!compareRequestedFieldsOnly || requested[field] !== undefined) &&
            requested[field] !== observed[field],
    );
}

function actualStatusLabel(
    status: Extract<
        IWorkflowRunCellLlmExecution,
        { availability: "complete" }
    >["actual"]["status"],
): string {
    return humanize(status);
}

function generationLabel(
    route: Extract<
        IWorkflowRunCellLlmExecution,
        { availability: "complete" | "partial" }
    >["resolved"]["route"],
): string {
    const values = [
        `max ${route.generation.maxOutputTokens.toLocaleString()} output tokens`,
    ];
    if (route.generation.temperature !== undefined)
        values.push(`temperature ${route.generation.temperature}`);
    if (route.generation.topP !== undefined)
        values.push(`top-p ${route.generation.topP}`);
    if (route.generation.seed !== undefined)
        values.push(`seed ${route.generation.seed}`);
    if (route.generation.reasoningEffort)
        values.push(`reasoning ${route.generation.reasoningEffort}`);
    return values.join(" · ");
}

function cacheLabel(
    cache: Extract<
        IWorkflowRunCellLlmExecution,
        { availability: "complete" }
    >["cache"],
): string {
    if (cache.status === "flash_evals_reuse") return "Flash Evals reuse";
    if (cache.status === "provider_cache")
        return `Provider ${cache.kind} cache ${cache.hit ? "hit" : "miss"}`;
    if (cache.status === "miss")
        return "Live generation · Flash Evals reuse miss";
    return "Live generation · cache disabled";
}

function costLabel(
    cost: Extract<
        IWorkflowRunCellLlmExecution,
        { availability: "complete" }
    >["currentCost"],
    format: ReturnType<typeof formatCostColumn>,
): string {
    const sources = {
        provider_reported: "Provider reported",
        gateway_reported: "Gateway reported",
        catalog_estimate: "Catalog estimate",
        unavailable: "Unavailable",
    } as const;
    return cost.usd === undefined
        ? sources[cost.source]
        : `${format(cost.usd)} · ${sources[cost.source]}`;
}
