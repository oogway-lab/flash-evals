"use client";

import type { IWorkflowRunCellLlmExecution } from "@mosaic/api-contract";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/layout/section-title";
import { cn } from "@/lib/cn";
import { formatCostColumn } from "@/lib/format";
import { CopyButton } from "@/components/ui/copy-button";
import { HintText } from "@/components/ui/hint";
import {
    MOSAIC_REUSE_LABELS,
    RETRY_OWNER_LABELS,
    humanize,
    labelFor,
} from "@/lib/labels";

export function LlmRouteSummary({
    execution,
}: {
    execution: IWorkflowRunCellLlmExecution | undefined;
}) {
    if (!execution) return null;
    if (execution.availability === "legacy_unavailable")
        return (
            <p className="text-label-12 text-muted-foreground">
                Route unavailable
            </p>
        );
    const transport = execution.resolved.route.transportConfig.transport;
    const actualProvider =
        execution.availability === "complete" && "identity" in execution.actual
            ? execution.actual.identity?.upstreamProvider
            : undefined;
    return (
        <div className="flex min-w-32 flex-col gap-1 text-label-12">
            <p className="text-mono-13">
                {transport} · {execution.resolved.route.modelId}
            </p>
            <p className="text-muted-foreground">
                {execution.availability === "complete"
                    ? actualProvider
                        ? `Actual ${actualProvider}`
                        : actualStatusLabel(execution.actual.status)
                    : "Actual unavailable"}
            </p>
        </div>
    );
}

// eslint-disable-next-line complexity -- provenance sections are independently optional by result state.
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
    const transport = route.transportConfig;
    const fallbackObserved =
        execution.availability === "complete" &&
        fallbackWasObserved(execution.attempts);
    const fallbackEvidenceUnavailable =
        execution.availability === "complete" &&
        (execution.actual.status === "unresolved" ||
            execution.actual.status === "unavailable" ||
            execution.actual.status === "legacy_unresolved" ||
            execution.actual.evidenceCompleteness !== "complete");
    let fallbackLabel = "Execution evidence unavailable";
    if (fallbackObserved) fallbackLabel = "Fallback observed";
    else if (fallbackEvidenceUnavailable)
        fallbackLabel = "Fallback evidence unavailable";
    else if (execution.availability === "complete")
        fallbackLabel = "No fallback observed";
    // The current and origin cost share one unit and precision.
    const fmtExecutionCost = formatCostColumn(
        execution.availability === "complete"
            ? [execution.currentCost.usd, execution.originCost?.usd]
            : [],
    );
    return (
        <section
            aria-label="LLM routing provenance"
            className="flex flex-col gap-4"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionTitle as="h3">LLM routing provenance</SectionTitle>
                <Badge variant={fallbackObserved ? "warning" : "outline"}>
                    {fallbackLabel}
                </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
                <ProvenanceFact
                    mono
                    label="Requested"
                    value={selectionLabel(execution.requested)}
                />
                <ProvenanceFact
                    mono
                    label="Resolved"
                    value={[
                        transport.transport,
                        route.modelId,
                        transportPolicyLabel(transport),
                        `route v${execution.resolved.routeVersion}`,
                    ]
                        .filter(Boolean)
                        .join(" · ")}
                />
                <ProvenanceFact
                    mono
                    label="Actual"
                    value={
                        execution.availability === "complete"
                            ? actualIdentityLabel(execution.actual)
                            : "Unavailable"
                    }
                />
            </div>
            <Card variant="inset" className="flex flex-col gap-3 p-4">
                <p className="text-label-12">Captured settings</p>
                <div className="grid gap-3 sm:grid-cols-2">
                    <ProvenanceFact
                        label="Generation"
                        value={generationLabel(route)}
                    />
                    <ProvenanceFact
                        label="Retry and timeout"
                        value={`${labelFor(RETRY_OWNER_LABELS, route.retry.owner)} · ${route.retry.timeoutMs.toLocaleString()} ms${
                            route.retry.owner === "mosaic"
                                ? ` · ${route.retry.maxAttempts} attempt${
                                      route.retry.maxAttempts === 1 ? "" : "s"
                                  }`
                                : ""
                        }`}
                    />
                    <ProvenanceFact
                        label="Flash Evals reuse"
                        value={labelFor(
                            MOSAIC_REUSE_LABELS,
                            route.cache.mosaicReuse,
                        )}
                    />
                    <ProvenanceFact
                        label="Provider caching"
                        value={humanize(route.cache.providerCaching)}
                    />
                    <ProvenanceFact
                        mono
                        label="Credential"
                        value={`${execution.resolved.credential.hint ?? execution.resolved.credential.providerKeyId} · rotation ${execution.resolved.credential.rotationVersion}`}
                        copyValue={execution.resolved.credential.providerKeyId}
                    />
                    <ProvenanceFact
                        mono
                        label="Capability"
                        value={execution.resolved.capability.capabilityDigest}
                        copyValue={
                            execution.resolved.capability.capabilityDigest
                        }
                    />
                </div>
            </Card>
            {execution.availability === "complete" ? (
                <>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <ProvenanceFact
                            label="Cache result"
                            value={cacheLabel(execution.cache)}
                        />
                        <CacheSourceFacts cache={execution.cache} />
                        <ProvenanceFact
                            label="Current cost"
                            value={costLabel(
                                execution.currentCost,
                                fmtExecutionCost,
                            )}
                        />
                        {execution.originCost ? (
                            <ProvenanceFact
                                label="Origin cost"
                                value={costLabel(
                                    execution.originCost,
                                    fmtExecutionCost,
                                )}
                            />
                        ) : null}
                        {execution.currentLatencyMs !== undefined ? (
                            <ProvenanceFact
                                label="Current latency"
                                value={`${execution.currentLatencyMs.toLocaleString()} ms`}
                            />
                        ) : null}
                        {execution.originLatencyMs !== undefined ? (
                            <ProvenanceFact
                                label="Origin latency"
                                value={`${execution.originLatencyMs.toLocaleString()} ms`}
                            />
                        ) : null}
                        {"generationId" in execution.actual &&
                        execution.actual.generationId ? (
                            <ProvenanceFact
                                mono
                                label="Generation ID"
                                value={execution.actual.generationId}
                                copyValue={execution.actual.generationId}
                            />
                        ) : null}
                    </div>
                    <UsageFacts usage={execution.usage} />
                    {execution.attempts.length ? (
                        <div className="flex flex-col gap-2">
                            <p className="text-label-12">Attempts</p>
                            <ol className="flex flex-col gap-2">
                                {execution.attempts.map((attempt) => (
                                    <li
                                        key={`${attempt.owner}-${attempt.sequence}`}
                                    >
                                        <Card
                                            variant="inset"
                                            className="flex flex-col gap-1 px-3 py-2 text-copy-14"
                                        >
                                            <span>
                                                <span className="text-mono-13">
                                                    {attempt.sequence}.{" "}
                                                    {attempt.owner}
                                                </span>{" "}
                                                · {attempt.outcome}
                                                {attempt.errorClass
                                                    ? ` · ${attempt.errorClass}`
                                                    : ""}
                                            </span>
                                            <p className="text-mono-13 text-muted-foreground">
                                                Requested{" "}
                                                {routeIdentityLabel(
                                                    attempt.requested,
                                                )}
                                                {attempt.actual
                                                    ? ` → Actual ${actualIdentityLabel(
                                                          attempt.actual,
                                                      )}`
                                                    : ""}
                                            </p>
                                        </Card>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    ) : null}
                </>
            ) : (
                <p className="text-copy-14 text-muted-foreground">
                    The immutable route is available, but actual route, cache,
                    usage, and cost evidence has not been recorded.
                </p>
            )}
        </section>
    );
}

function ProvenanceFact({
    label,
    value,
    copyValue,
    mono = false,
}: {
    label: string;
    value: string;
    /** Identifiers and routes are mono; settings, counts and costs are not. */
    mono?: boolean;
    /** Truncate to one line, show the full value on hover, and copy this. */
    copyValue?: string;
}) {
    if (copyValue === undefined) {
        return (
            <div className="flex flex-col gap-1">
                <p className="text-label-12 text-muted-foreground">{label}</p>
                <p
                    className={cn(
                        "wrap-break-word tabular-nums",
                        mono ? "text-mono-13" : "text-copy-14",
                    )}
                >
                    {value}
                </p>
            </div>
        );
    }
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <p className="text-label-12 text-muted-foreground">{label}</p>
            <div className="flex min-w-0 items-center gap-1">
                <HintText
                    hint={<span className="break-all">{value}</span>}
                    className="block min-w-0 truncate text-mono-13"
                >
                    {value}
                </HintText>
                <CopyButton value={copyValue} what={label} />
            </div>
        </div>
    );
}

function UsageFacts({
    usage,
}: {
    usage: Extract<
        IWorkflowRunCellLlmExecution,
        { availability: "complete" }
    >["usage"];
}) {
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {reported.map(([label, value]) => (
                <ProvenanceFact
                    key={label}
                    label={label}
                    value={value!.toLocaleString()}
                />
            ))}
        </div>
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
    const values = [`max ${route.generation.maxOutputTokens}`];
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

type CompleteCache = Extract<
    IWorkflowRunCellLlmExecution,
    { availability: "complete" }
>["cache"];

// The run and cell a Flash Evals reuse came from, as copyable IDs.
function CacheSourceFacts({ cache }: { cache: CompleteCache }) {
    if (cache.status !== "mosaic_reuse") return null;
    return (
        <>
            {cache.sourceRunId ? (
                <ProvenanceFact
                    mono
                    label="Source run"
                    value={cache.sourceRunId}
                    copyValue={cache.sourceRunId}
                />
            ) : null}
            {cache.sourceCellId ? (
                <ProvenanceFact
                    mono
                    label="Source cell"
                    value={cache.sourceCellId}
                    copyValue={cache.sourceCellId}
                />
            ) : null}
        </>
    );
}

function cacheLabel(
    cache: Extract<
        IWorkflowRunCellLlmExecution,
        { availability: "complete" }
    >["cache"],
): string {
    if (cache.status === "mosaic_reuse") return "Flash Evals reuse";
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
