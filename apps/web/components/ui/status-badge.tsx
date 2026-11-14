import { AlertTriangle, Check, CircleAlert, CircleDashed } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReviewVerdict } from "@/components/runs/types";
import type {
    BenchmarkModelVerdict,
    BenchmarkTaskVerdict,
    IModelComparison,
} from "@flash-evals/api-contract";
import { Hint } from "@/components/ui/hint";
import { MISSING_VALUE } from "@/lib/format";
import {
    CELL_STATUS_LABELS as cellLabels,
    PROMPT_STATUS_LABELS as promptLabels,
    RUN_STATUS_LABELS as runLabels,
    humanize,
    type CellStatus,
    type PromptVersionStatus,
    type RunStatus,
} from "@/lib/labels";

// The one module that maps a status to a label and a Badge variant. Every
// status badge carries its text, so state is never conveyed by color alone.

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

const runVariants: Record<RunStatus, BadgeVariant> = {
    pending: "outline",
    running: "default",
    completed: "success",
    partial: "warning",
    failed: "danger",
    cancelled: "outline",
};

const cellVariants: Record<CellStatus, BadgeVariant> = {
    pending: "outline",
    running: "default",
    succeeded: "success",
    failed: "danger",
    cached: "outline",
    skipped: "outline",
};

/** Pending or running: the cell has no output, metrics or scores yet. */
export function isCellInFlight(status: CellStatus) {
    return status === "pending" || status === "running";
}

// A pulsing dot marks live work so "running" isn't conveyed by color alone.
export function RunningDot() {
    return (
        <span
            aria-hidden="true"
            data-slot="status-running-dot"
            className="size-1.5 shrink-0 rounded-full bg-current motion-safe:animate-pulse"
        />
    );
}

/** A status: label text, a variant, and an accessible "<kind> status: <label>". */
export function StatusBadge({
    kind,
    label,
    variant,
    running = false,
}: {
    kind: string;
    label: string;
    variant: BadgeVariant;
    running?: boolean;
}) {
    return (
        <Badge
            variant={variant}
            aria-label={`${kind} status: ${label}`}
            className="gap-2"
        >
            {running && <RunningDot />}
            {label}
        </Badge>
    );
}

export function RunStatusBadge({
    status,
    stopReason,
}: {
    status: RunStatus;
    /** A cancelled run that stopped at its spend limit says so. */
    stopReason?: string;
}) {
    const label =
        status === "cancelled" && stopReason === "spend_cap"
            ? "Stopped at spend limit"
            : runLabels[status];
    return (
        <StatusBadge
            kind="Run"
            label={label}
            variant={runVariants[status]}
            running={status === "running"}
        />
    );
}

export function CellStatusBadge({ status }: { status: CellStatus }) {
    return (
        <StatusBadge
            kind="Cell"
            label={cellLabels[status]}
            variant={cellVariants[status]}
            running={status === "running"}
        />
    );
}

/**
 * Whether a saved prompt version can be used in runs. A runnable version
 * saved without a model check says so instead of looking checked.
 */
export function PromptStatusBadge({
    status,
    modelCheck,
}: {
    status: PromptVersionStatus;
    modelCheck?: "checked" | "not_checked";
}) {
    const unchecked = status === "runnable" && modelCheck === "not_checked";
    return (
        <StatusBadge
            kind="Prompt"
            label={
                unchecked
                    ? "Runnable, not checked on a model"
                    : promptLabels[status]
            }
            variant={
                status === "runnable" && !unchecked ? "success" : "warning"
            }
        />
    );
}

/** Audio transcript status; the API sends a plain string. */
export function TranscriptStatusBadge({ status }: { status: string }) {
    const variant: BadgeVariant =
        status === "completed" || status === "succeeded"
            ? "success"
            : status === "failed"
              ? "danger"
              : "outline";
    return (
        <StatusBadge
            kind="Transcript"
            label={humanize(status)}
            variant={variant}
            running={status === "running"}
        />
    );
}

export type BranchStatus =
    "pending" | "running" | "completed" | "failed" | "stopped";

const branchStatuses: Record<
    BranchStatus,
    { label: string; variant: BadgeVariant }
> = {
    pending: { label: "Pending branch", variant: "outline" },
    running: { label: "Running branch", variant: "default" },
    completed: { label: "Completed branch", variant: "success" },
    failed: { label: "Failed branch", variant: "danger" },
    // The run ended (cancelled or failed) before every step in the branch ran.
    stopped: { label: "Stopped branch", variant: "outline" },
};

/** One STT workflow branch (a root STT node and everything downstream of it). */
export function BranchStatusBadge({ status }: { status: BranchStatus }) {
    const { label, variant } = branchStatuses[status];
    return (
        <Badge variant={variant} className="gap-2">
            {status === "running" && <RunningDot />}
            {label}
        </Badge>
    );
}

/** Whether a provider API key is stored for the project. */
export function KeyStoredBadge({ stored }: { stored: boolean }) {
    return stored ? (
        <Badge variant="success">Stored</Badge>
    ) : (
        <Badge variant="outline">Not stored</Badge>
    );
}

/** Result of testing a stored provider key. */
export function ProbeBadge({
    failed,
    verified,
}: {
    failed: boolean;
    verified: boolean;
}) {
    if (failed) return <Badge variant="danger">Failed</Badge>;
    if (verified) return <Badge variant="success">Verified</Badge>;
    return <Badge variant="outline">Not verified</Badge>;
}

/**
 * Placeholder for a score that does not exist yet. It keeps the score
 * column's width and says so to assistive tech.
 */
export function PendingScore() {
    return (
        <span className="inline-block min-w-28">
            <Skeleton className="h-5 w-12" />
            <span className="sr-only">Score pending</span>
        </span>
    );
}

export type ImportRowStatus = "importable" | "warning" | "failing";

const importRowVariants: Record<ImportRowStatus, BadgeVariant> = {
    importable: "success",
    warning: "warning",
    failing: "danger",
};

/** One previewed row of a golden-answer import. */
export function ImportRowStatusBadge({ status }: { status: string }) {
    const known = status in importRowVariants;
    return (
        <StatusBadge
            kind="Import row"
            label={humanize(status)}
            variant={
                known ? importRowVariants[status as ImportRowStatus] : "danger"
            }
        />
    );
}

/** The aggregate counts above an import preview. */
export function ImportCountBadge({
    status,
    count,
}: {
    status: ImportRowStatus;
    count: number;
}) {
    const label = {
        importable: "importable",
        warning: "warnings",
        failing: "failing",
    }[status];
    return (
        <Badge variant={importRowVariants[status]}>
            <span className="tabular-nums">{count}</span>&nbsp;{label}
        </Badge>
    );
}

/** Overall outcome of a prompt test run (all samples). */
export function PromptTestStatusBadge({
    status,
}: {
    status: "success" | "partial" | "failed";
}) {
    const label = { success: "Success", partial: "Partial", failed: "Failed" }[
        status
    ];
    const variant: BadgeVariant = {
        success: "success",
        partial: "warning",
        failed: "danger",
    }[status] as BadgeVariant;
    return <StatusBadge kind="Test" label={label} variant={variant} />;
}

/** Outcome of one sample in a prompt test run; the API sends a plain string. */
export function PromptTestResultBadge({ status }: { status: string }) {
    const label =
        status === "success"
            ? "Success"
            : status === "failed_validation"
              ? "Failed validation"
              : status === "timeout"
                ? "Timeout"
                : status === "cancelled"
                  ? "Cancelled"
                  : "Provider error";
    const variant: BadgeVariant =
        status === "success"
            ? "success"
            : status === "failed_validation" || status === "timeout"
              ? "warning"
              : "danger";
    return <StatusBadge kind="Sample" label={label} variant={variant} />;
}

const verdictLabels: Record<ReviewVerdict, string> = {
    unreviewed: "Unreviewed",
    approved: "Approved",
    needs_review: "Needs review",
    issue: "Issue",
};

const verdictVariants: Record<ReviewVerdict, BadgeVariant> = {
    unreviewed: "outline",
    approved: "success",
    needs_review: "warning",
    issue: "danger",
};

const verdictIcons: Record<ReviewVerdict, typeof Check> = {
    unreviewed: CircleDashed,
    approved: Check,
    needs_review: AlertTriangle,
    issue: CircleAlert,
};

/** A reviewer's verdict on a run cell. The icon backs up the text and color. */
export function ReviewVerdictBadge({
    verdict,
}: {
    verdict: ReviewVerdict | undefined;
}) {
    const value = verdict ?? "unreviewed";
    const Icon = verdictIcons[value];
    return (
        <Badge
            variant={verdictVariants[value]}
            aria-label={`Review: ${verdictLabels[value]}`}
            className="gap-1"
        >
            <Icon className="size-3.5" aria-hidden="true" />
            {verdictLabels[value]}
        </Badge>
    );
}

function sttGateStatus(gate: IModelComparison["sttShipGate"]): {
    label: string;
    variant: BadgeVariant;
} {
    if (!gate) return { label: MISSING_VALUE, variant: "outline" };
    if (gate.status === "pass") return { label: "Pass", variant: "success" };
    if (gate.status === "fail") return { label: "Fail", variant: "danger" };
    return { label: "Needs data", variant: "outline" };
}

/** The STT ship gate for one model; the summary, when present, is a hint. */
export function SttGateBadge({
    gate,
}: {
    gate: IModelComparison["sttShipGate"];
}) {
    const status = sttGateStatus(gate);
    const summary = gate?.summary;
    if (!summary) return <Badge variant={status.variant}>{status.label}</Badge>;
    return (
        <Hint content={summary}>
            <Badge
                variant={status.variant}
                tabIndex={0}
                className="cursor-help focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
                {status.label}
                <span className="sr-only">: {summary}</span>
            </Badge>
        </Hint>
    );
}

/** Whether a workflow LLM route is the project default or disabled. */
export function RouteStateBadge({ state }: { state: "default" | "disabled" }) {
    return state === "default" ? (
        <Badge>Default</Badge>
    ) : (
        <Badge variant="outline">Disabled</Badge>
    );
}

const benchmarkVerdicts: Record<
    BenchmarkModelVerdict,
    { label: string; variant: BadgeVariant }
> = {
    pass: { label: "Pass", variant: "success" },
    conditional: { label: "Conditional", variant: "warning" },
    fail: { label: "Fail", variant: "danger" },
    inconclusive: { label: "Inconclusive", variant: "outline" },
};

/** Whether a candidate can replace the benchmark model. */
export function BenchmarkVerdictBadge({
    verdict,
}: {
    verdict: BenchmarkModelVerdict;
}) {
    const { label, variant } = benchmarkVerdicts[verdict];
    return (
        <StatusBadge kind="Benchmark verdict" label={label} variant={variant} />
    );
}

/**
 * The reference model's place in the verdict column: it is what the others
 * are measured against, so it has no pass or fail of its own.
 */
export function BenchmarkReferenceBadge() {
    return (
        <StatusBadge kind="Benchmark verdict" label="Reference" variant="ref" />
    );
}

const benchmarkTaskVerdicts: Record<
    BenchmarkTaskVerdict,
    { label: string; variant: BadgeVariant }
> = {
    pass: { label: "Pass", variant: "success" },
    uncertain: { label: "Uncertain", variant: "warning" },
    fail: { label: "Fail", variant: "danger" },
    insufficient: { label: "Too few items", variant: "outline" },
    reference: { label: "Reference", variant: "ref" },
};

/** One task's result against its target in a benchmark comparison. */
export function BenchmarkTaskVerdictBadge({
    verdict,
}: {
    verdict: BenchmarkTaskVerdict;
}) {
    const { label, variant } = benchmarkTaskVerdicts[verdict];
    return <StatusBadge kind="Task verdict" label={label} variant={variant} />;
}
