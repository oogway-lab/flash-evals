"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type {
    IProviderKeyMetadata,
    ISttRouteProbeModel,
    ProviderKeyProvider,
    SttRouteProbeStatus,
} from "@mosaic/api-contract";
import { KeepFieldsOnReset } from "@/components/ui/keep-fields-on-reset";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useActionToast } from "@/components/layout/use-action-toast";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
    clearProviderKeyAction,
    createSttRouteProbeAction,
    setProviderKeyAction,
    type ISttRouteProbeActionState,
} from "@/app/actions/settings";
import type { IProviderKeyActionState } from "@/app/actions/settings";
import { SectionTitle } from "@/components/layout/section-title";
import { KeyStoredBadge, ProbeBadge } from "@/components/ui/status-badge";
import { ClampedText } from "@/components/ui/clamped-text";

const PROVIDERS: Array<{
    id: ProviderKeyProvider;
    label: string;
    helper: string;
    baseUrl: boolean;
}> = [
    {
        id: "openai",
        label: "OpenAI",
        helper: "Used for OpenAI models and compatible transcription.",
        baseUrl: false,
    },
    {
        id: "gateway",
        label: "Vercel AI Gateway",
        helper: "Used for models routed through Vercel AI Gateway.",
        baseUrl: false,
    },
    {
        id: "soniox",
        label: "Soniox",
        helper: "Used for Soniox speech-to-text models.",
        baseUrl: false,
    },
    {
        id: "gemini",
        label: "Gemini",
        helper: "Used for direct Gemini audio-understanding transcription.",
        baseUrl: false,
    },
    {
        id: "openrouter",
        label: "OpenRouter",
        helper: "Used for models routed through OpenRouter.",
        baseUrl: true,
    },
    {
        id: "bifrost",
        label: "Bifrost",
        helper: "Used for your OpenAI-compatible Bifrost endpoint.",
        baseUrl: true,
    },
];

export function ProviderKeysForm({
    keys,
    probes = [],
    projectId = "",
    probeNotice,
}: {
    keys: IProviderKeyMetadata[];
    probes?: ISttRouteProbeModel[];
    projectId?: string;
    probeNotice?: string;
}) {
    const stored = new Map(keys.map((key) => [key.provider, key]));
    return (
        <section
            aria-labelledby="provider-keys-heading"
            className="flex flex-col gap-4"
        >
            <SectionTitle
                id="provider-keys-heading"
                description="Keys are encrypted before storage. Existing secrets are never displayed."
            >
                Provider keys
            </SectionTitle>
            {probeNotice && (
                <p role="status" className="text-copy-14 text-muted-foreground">
                    {probeNotice}
                </p>
            )}
            {PROVIDERS.map((provider) => (
                <ProviderKeyCard
                    key={provider.id}
                    provider={provider}
                    stored={stored.get(provider.id)}
                    probes={probes.filter(
                        (probe) =>
                            probe.providerId ===
                            (provider.id === "gateway"
                                ? "vercel-gateway"
                                : provider.id),
                    )}
                    projectId={projectId}
                />
            ))}
        </section>
    );
}

function KeyForm({
    provider,
    stored,
    resetKey,
    action,
    onCancel,
}: {
    provider: (typeof PROVIDERS)[number];
    stored?: IProviderKeyMetadata;
    resetKey?: number;
    action: (formData: FormData) => void;
    onCancel?: () => void;
}) {
    const keyId = `${provider.id}-key`;
    const baseUrlId = `${provider.id}-base-url`;
    return (
        <form key={resetKey} action={action} className="flex flex-col gap-4">
            <KeepFieldsOnReset />
            <input type="hidden" name="provider" value={provider.id} />
            <div className="flex flex-col gap-2">
                <Label htmlFor={keyId}>API key</Label>
                <PasswordInput
                    id={keyId}
                    name="key"
                    noun="key"
                    autoComplete="off"
                    required
                    // Opened on request via "Replace key".
                    autoFocus={Boolean(onCancel)}
                    aria-describedby={`${keyId}-help`}
                />
                <p
                    id={`${keyId}-help`}
                    className="text-copy-14 text-muted-foreground"
                >
                    {stored
                        ? "Enter a new key to replace the current team key."
                        : "Keys are encrypted before storage and never shown again."}
                </p>
            </div>
            {provider.baseUrl && (
                <div className="flex flex-col gap-2">
                    <Label htmlFor={baseUrlId}>
                        Base URL
                        {provider.id === "bifrost" ? " (required)" : ""}
                    </Label>
                    <Input
                        id={baseUrlId}
                        name="baseUrl"
                        type="url"
                        defaultValue={stored?.baseUrl ?? ""}
                        placeholder="https://example.com/v1"
                        required={provider.id === "bifrost"}
                    />
                    <p className="text-copy-14 text-muted-foreground">
                        Optional for OpenRouter. Bifrost requires the public
                        HTTPS URL of its OpenAI-compatible endpoint.
                    </p>
                </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
                <SubmitButton label="Save key" pendingLabel="Saving…" />
                {onCancel ? (
                    <Button type="button" variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                ) : null}
            </div>
        </form>
    );
}

function ProviderKeyCard({
    provider,
    stored,
    probes,
    projectId,
}: {
    provider: (typeof PROVIDERS)[number];
    stored?: IProviderKeyMetadata;
    probes: ISttRouteProbeModel[];
    projectId: string;
}) {
    const [saveState, saveAction] = useActionState(setProviderKeyAction, {});
    const [clearState, setClearState] = useState<IProviderKeyActionState>({});
    // Saves and clears toast; only failures stay inline.
    useActionToast(saveState, (s) => (s.error ? undefined : s.message));
    useActionToast(clearState, (s) => (s.error ? undefined : s.message));
    const error = saveState.error || clearState.error;
    // With a key stored, the form stays behind "Replace key" until asked
    // for, and folds away again after a successful save.
    const [replacing, setReplacing] = useState(false);
    const replaceRef = useRef<HTMLButtonElement>(null);
    const restoreFocus = useRef(false);
    useEffect(() => {
        if (saveState.ok) setReplacing(false);
    }, [saveState]);
    useEffect(() => {
        if (replacing || !restoreFocus.current) return;
        restoreFocus.current = false;
        replaceRef.current?.focus();
    }, [replacing]);
    function cancelReplace() {
        restoreFocus.current = true;
        setReplacing(false);
    }
    const showForm = !stored || replacing;
    return (
        <Card>
            <CardHeader>
                <CardTitle>{provider.label}</CardTitle>
                <CardDescription>{provider.helper}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {stored ? (
                    <p className="flex flex-wrap items-center gap-2 text-copy-14 text-muted-foreground">
                        <KeyStoredBadge stored />
                        <span className="text-mono-13 text-on-surface">
                            {stored.hint}
                        </span>
                    </p>
                ) : (
                    <div className="flex flex-col items-start gap-2">
                        <KeyStoredBadge stored={false} />
                        <p className="text-copy-14 text-muted-foreground">
                            No team key stored. New explicit workflow routes are
                            unavailable; legacy non-workflow calls may still use
                            a deployment credential.
                        </p>
                    </div>
                )}
                {showForm ? (
                    <KeyForm
                        provider={provider}
                        stored={stored}
                        resetKey={saveState.resetKey}
                        action={saveAction}
                        onCancel={stored ? cancelReplace : undefined}
                    />
                ) : (
                    <Button
                        ref={replaceRef}
                        type="button"
                        variant="secondary"
                        className="w-full sm:w-auto"
                        onClick={() => setReplacing(true)}
                    >
                        Replace key
                    </Button>
                )}
                {stored && (
                    <ConfirmDialog
                        trigger={
                            <Button
                                type="button"
                                variant="secondary"
                                className="w-full sm:w-auto"
                            >
                                Clear stored key
                            </Button>
                        }
                        title={`Clear the stored ${provider.label} key?`}
                        description="Workflow routes that use this provider stop working until a new key is saved."
                        confirmLabel="Clear key"
                        pendingLabel="Clearing…"
                        onConfirm={async () => {
                            const formData = new FormData();
                            formData.set("provider", provider.id);
                            const result = await clearProviderKeyAction(
                                {},
                                formData,
                            );
                            setClearState(result);
                            return result.error;
                        }}
                    />
                )}
                {stored && probes.length > 0 && (
                    <div className="flex flex-col gap-3 border-t border-border pt-4">
                        <div className="flex flex-col gap-1">
                            <p className="text-label-14 text-on-surface">
                                Speech-to-text routes
                            </p>
                            <p className="text-copy-14 text-muted-foreground">
                                Verify a route with the bundled sample before
                                enabling it for runs.
                            </p>
                        </div>
                        {probes.map((probe) => (
                            <RouteProbe
                                key={probe.modelId}
                                probe={probe}
                                projectId={projectId}
                            />
                        ))}
                    </div>
                )}
                {error && (
                    <p role="alert" className="text-copy-14 text-error">
                        {error}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

function RouteProbe({
    probe,
    projectId,
}: {
    probe: ISttRouteProbeModel;
    projectId: string;
}) {
    const [state, action] = useActionState(createSttRouteProbeAction, {});
    const result = state.result;
    const failed = routeProbeFailed(probe, state.error, result?.error);
    const message = routeProbeMessage(probe, state.error, result);
    const verified = routeVerified(probe, result?.status);
    return (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <p className="flex flex-wrap items-center gap-2 text-label-14 text-on-surface">
                        {probe.label}
                        <ProbeBadge failed={failed} verified={verified} />
                    </p>
                    <p className="text-mono-13 text-muted-foreground">
                        {probe.routeId}
                    </p>
                </div>
                <form action={action}>
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="modelId" value={probe.modelId} />
                    <SubmitButton
                        label={verified ? "Verify again" : "Verify route"}
                        pendingLabel="Verifying…"
                        variant="secondary"
                        ariaLabel={
                            verified
                                ? `Verify ${probe.label} route again`
                                : `Verify ${probe.label} route`
                        }
                    />
                </form>
            </div>
            {message && (
                <p
                    role={failed ? "alert" : "status"}
                    aria-live="polite"
                    className={
                        failed
                            ? "text-copy-14 text-error"
                            : "text-copy-14 text-muted-foreground"
                    }
                >
                    {message}
                </p>
            )}
            {result?.transcript && !failed ? (
                <ProbeTranscript text={result.transcript} />
            ) : null}
        </div>
    );
}

// What the route heard in the bundled sample: labelled and clamped rather
// than run into the status sentence.
function ProbeTranscript({ text }: { text: string }) {
    return (
        <Card variant="inset" className="flex flex-col gap-1 p-3">
            <p className="text-label-12 text-muted-foreground">
                Sample transcript
            </p>
            <ClampedText lines={3} className="text-copy-14 text-on-surface">
                {text}
            </ClampedText>
        </Card>
    );
}

function routeProbeFailed(
    probe: ISttRouteProbeModel,
    actionError: string | undefined,
    resultError: string | undefined,
): boolean {
    return Boolean(
        actionError ||
        resultError ||
        (probe.probe && probe.probe.status !== "available"),
    );
}

function routeProbeMessage(
    probe: ISttRouteProbeModel,
    actionError: string | undefined,
    result: ISttRouteProbeActionState["result"],
): string | undefined {
    if (actionError) return actionError;
    if (result?.error) return result.error;
    if (result?.transcript) return "Route verified with the bundled sample.";
    if (probe.probe?.reason) return probe.probe.reason;
    return probe.availabilityStatus === "available"
        ? "Route verified."
        : probe.unavailableReason;
}

function routeVerified(
    probe: ISttRouteProbeModel,
    resultStatus: SttRouteProbeStatus | undefined,
): boolean {
    return (
        resultStatus === "available" ||
        (resultStatus === undefined && probe.availabilityStatus === "available")
    );
}

function SubmitButton({
    label,
    pendingLabel,
    variant = "default",
    ariaLabel,
}: {
    label: string;
    pendingLabel: string;
    variant?: "default" | "secondary";
    ariaLabel?: string;
}) {
    const { pending } = useFormStatus();
    return (
        <Button
            type="submit"
            variant={variant}
            loading={pending}
            loadingText={pendingLabel}
            className="w-full sm:w-auto"
            aria-label={ariaLabel}
        >
            {label}
        </Button>
    );
}
