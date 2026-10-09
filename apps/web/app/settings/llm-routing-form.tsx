"use client";

import {
    useActionState,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useTransition,
} from "react";
import { useFormStatus } from "react-dom";
import type {
    IProviderKeyMetadata,
    IWorkflowLlmRouteCandidate,
    IWorkflowLlmProjectDefaultState,
    IWorkflowLlmRoute,
    WorkflowLlmGenerationControl,
    WorkflowLlmTransport,
} from "@mosaic/api-contract";
import { REASONING_EFFORT_LEVELS } from "@mosaic/llm-core";
import {
    clearWorkflowLlmDefaultAction,
    disableWorkflowLlmRouteAction,
    loadWorkflowLlmRouteCandidatesAction,
    saveWorkflowLlmRouteAction,
    setWorkflowLlmDefaultAction,
    type IWorkflowLlmRoutingActionState,
} from "@/app/actions/settings";
import { KeepFieldsOnReset } from "@/components/ui/keep-fields-on-reset";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useActionToast } from "@/components/layout/use-action-toast";
import { Spinner } from "@/components/ui/spinner";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    REASONING_EFFORT_LABELS,
    TRANSPORT_LABELS,
    UPSTREAM_MODE_LABELS,
    labelFor,
} from "@/lib/labels";
import { RouteStateBadge } from "@/components/ui/status-badge";
import { SectionTitle } from "@/components/layout/section-title";
import { cn } from "@/lib/cn";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";

const LLM_TRANSPORTS = (
    Object.entries(TRANSPORT_LABELS) as Array<[WorkflowLlmTransport, string]>
).map(([transport, label]) => [transport, label] as const);

export function LlmRoutingForm({
    projectId,
    keys,
    routes,
    projectDefault,
    notice,
}: {
    projectId: string;
    keys: IProviderKeyMetadata[];
    routes: IWorkflowLlmRoute[];
    projectDefault?: IWorkflowLlmProjectDefaultState;
    notice?: string;
}) {
    const activeRoutes = routes.filter(
        (route) => !route.disabledAt && route.latestVersion,
    );
    return (
        <section
            aria-labelledby="llm-routing-heading"
            className="flex flex-col gap-4"
        >
            <SectionTitle
                id="llm-routing-heading"
                description="Choose a configured provider and Flash Evals will load its current models automatically. Routes remain explicit, immutable execution settings for future workflow runs."
            >
                LLM routes
            </SectionTitle>
            {notice ? (
                <Alert>
                    <AlertTitle>Routing status</AlertTitle>
                    <AlertDescription>{notice}</AlertDescription>
                </Alert>
            ) : null}
            {!projectId ? (
                <Alert>
                    <AlertTitle>Create a project first</AlertTitle>
                    <AlertDescription>
                        LLM routes and defaults are project scoped.
                    </AlertDescription>
                </Alert>
            ) : (
                <>
                    <RouteBuilder
                        projectId={projectId}
                        keys={keys}
                        routes={activeRoutes}
                    />
                    <RouteList
                        projectId={projectId}
                        routes={routes}
                        projectDefault={projectDefault}
                    />
                </>
            )}
        </section>
    );
}

// eslint-disable-next-line complexity -- the form conditionally renders transport capability controls.
function RouteBuilder({
    projectId,
    keys,
    routes,
}: {
    projectId: string;
    keys: IProviderKeyMetadata[];
    routes: IWorkflowLlmRoute[];
}) {
    const configuredTransports = useMemo(
        () =>
            LLM_TRANSPORTS.filter(([transport]) =>
                keyForTransport(keys, transport),
            ),
        [keys],
    );
    const [transport, setTransport] = useState<WorkflowLlmTransport>(
        configuredTransports[0]?.[0] ?? "openai",
    );
    const [candidates, setCandidates] = useState<IWorkflowLlmRouteCandidate[]>(
        [],
    );
    const [modelId, setModelId] = useState("");
    const [candidateError, setCandidateError] = useState<string>();
    const [isLoadingCandidates, startCandidateTransition] = useTransition();
    const requestId = useRef(0);
    const candidateErrorRef = useRef<HTMLDivElement>(null);
    const [routeId, setRouteId] = useState("new");
    const [state, action] = useActionState(saveWorkflowLlmRouteAction, {});
    const loadCandidates = useCallback(() => {
        const currentRequest = ++requestId.current;
        setCandidateError(undefined);
        startCandidateTransition(async () => {
            const response = await loadWorkflowLlmRouteCandidatesAction(
                projectId,
                transport,
            );
            if (currentRequest !== requestId.current) return;
            if (response.error || !response.result) {
                setCandidates([]);
                setCandidateError(
                    response.error ??
                        "Models are temporarily unavailable. Try again.",
                );
                return;
            }
            const next = response.result.candidates;
            setCandidates(next);
            setModelId((current) =>
                next.some((candidate) => candidate.modelId === current)
                    ? current
                    : (next[0]?.modelId ?? ""),
            );
        });
    }, [projectId, transport]);
    useEffect(() => {
        if (
            configuredTransports.length > 0 &&
            !configuredTransports.some(([value]) => value === transport)
        ) {
            setTransport(configuredTransports[0]![0]);
        }
    }, [configuredTransports, transport]);
    useEffect(() => {
        if (configuredTransports.some(([value]) => value === transport)) {
            loadCandidates();
        }
    }, [loadCandidates, transport, configuredTransports]);
    useEffect(() => {
        if (candidateError && !isLoadingCandidates) {
            candidateErrorRef.current?.focus();
        }
    }, [candidateError, isLoadingCandidates]);
    const effectiveModelId = candidates.some(
        (candidate) => candidate.modelId === modelId,
    )
        ? modelId
        : (candidates[0]?.modelId ?? "");
    const candidate = candidates.find(
        (item) => item.modelId === effectiveModelId,
    );
    const existingRoute = routes.find((route) => route.id === routeId);
    const controls = new Set(candidate?.support.supportedGenerationControls);
    const routeName = existingRoute?.name ?? "";
    const editableRoutes = routes.filter((route) =>
        configuredTransports.some(
            ([value]) =>
                value === route.latestVersion?.config.transportConfig.transport,
        ),
    );
    const canCreate =
        Boolean(candidate) && !isLoadingCandidates && !candidateError;
    return (
        <Card>
            <CardHeader>
                <CardTitle>Create a route</CardTitle>
                <CardDescription>
                    Select a configured provider. Flash Evals checks the
                    provider&apos;s current model listing automatically when you
                    choose and save the route.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {configuredTransports.length === 0 ? (
                    <div className="flex flex-col items-start gap-4">
                        <Alert>
                            <AlertTitle>No LLM provider credential</AlertTitle>
                            <AlertDescription>
                                <a
                                    href="#provider-keys-heading"
                                    className="text-accent-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                >
                                    Add a provider credential
                                </a>{" "}
                                before creating a route. Existing saved routes
                                remain visible below.
                            </AlertDescription>
                        </Alert>
                        <Button type="button" disabled>
                            Create route
                        </Button>
                    </div>
                ) : (
                    <form action={action} className="flex flex-col gap-4">
                        <KeepFieldsOnReset />
                        <input
                            type="hidden"
                            name="projectId"
                            value={projectId}
                        />
                        <input
                            type="hidden"
                            name="transport"
                            value={transport}
                        />
                        <input
                            type="hidden"
                            name="modelId"
                            value={effectiveModelId}
                        />
                        <input
                            type="hidden"
                            name="routeId"
                            value={routeId === "new" ? "" : routeId}
                        />
                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Route version" id="llm-route-target">
                                <Select
                                    value={routeId}
                                    onValueChange={setRouteId}
                                >
                                    <SelectTrigger id="llm-route-target">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            <SelectItem value="new">
                                                New named route
                                            </SelectItem>
                                            {editableRoutes.map((route) => (
                                                <SelectItem
                                                    key={route.id}
                                                    value={route.id}
                                                >
                                                    New {route.name} version
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Route name" id="llm-route-name">
                                <Input
                                    key={`${routeId}:${routeName}`}
                                    id="llm-route-name"
                                    name="name"
                                    defaultValue={routeName}
                                    required
                                />
                            </Field>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Provider" id="llm-provider">
                                <Select
                                    value={transport}
                                    onValueChange={(value) =>
                                        setTransport(
                                            value as WorkflowLlmTransport,
                                        )
                                    }
                                >
                                    <SelectTrigger id="llm-provider">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {configuredTransports.map(
                                                ([value, label]) => (
                                                    <SelectItem
                                                        key={value}
                                                        value={value}
                                                    >
                                                        {label}
                                                    </SelectItem>
                                                ),
                                            )}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Model" id="llm-model">
                                <Select
                                    value={effectiveModelId}
                                    onValueChange={setModelId}
                                    disabled={
                                        isLoadingCandidates ||
                                        candidates.length === 0
                                    }
                                >
                                    <SelectTrigger id="llm-model">
                                        <SelectValue
                                            placeholder={
                                                isLoadingCandidates ? (
                                                    <span className="flex items-center gap-2">
                                                        <Spinner size="sm" />
                                                        Loading models…
                                                    </span>
                                                ) : (
                                                    "Choose a model"
                                                )
                                            }
                                        >
                                            {candidate?.label}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {candidates.map((item) => (
                                                <SelectItem
                                                    key={item.modelId}
                                                    value={item.modelId}
                                                >
                                                    {item.label} ·{" "}
                                                    <span className="text-mono-13">
                                                        {item.modelId}
                                                    </span>
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                        </div>
                        <div aria-live="polite" aria-atomic="true">
                            {isLoadingCandidates ? (
                                // Visible cue is the spinner in the Model
                                // trigger; a visible line here pushed the
                                // generation fields down and back up.
                                <p role="status" className="sr-only">
                                    Loading current provider models…
                                </p>
                            ) : candidateError ? (
                                <Alert
                                    ref={candidateErrorRef}
                                    tabIndex={-1}
                                    variant="destructive"
                                >
                                    <AlertTitle>Models unavailable</AlertTitle>
                                    <AlertDescription className="flex flex-col items-start gap-2">
                                        {candidateError}
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={loadCandidates}
                                        >
                                            Retry model loading
                                        </Button>
                                    </AlertDescription>
                                </Alert>
                            ) : candidates.length === 0 ? (
                                <p className="text-copy-14 text-muted-foreground">
                                    This provider did not return any language
                                    models. Choose another configured provider.
                                </p>
                            ) : null}
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <GenerationField
                                control="maxOutputTokens"
                                controls={controls}
                                label="Maximum output tokens"
                                defaultValue="4096"
                                required
                            />
                            <GenerationField
                                control="temperature"
                                controls={controls}
                                label="Temperature"
                                inputMode="decimal"
                            />
                            <GenerationField
                                control="topP"
                                controls={controls}
                                label="Top P"
                                inputMode="decimal"
                            />
                            <GenerationField
                                control="seed"
                                controls={controls}
                                label="Seed"
                                inputMode="numeric"
                            />
                        </div>
                        {controls.has("reasoningEffort") ? (
                            <Field
                                label="Reasoning effort"
                                id="llm-reasoning-effort"
                            >
                                <Select
                                    name="reasoningEffort"
                                    defaultValue="none"
                                >
                                    <SelectTrigger id="llm-reasoning-effort">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {REASONING_EFFORT_LEVELS.map(
                                                (effort) => (
                                                    <SelectItem
                                                        key={effort}
                                                        value={effort}
                                                    >
                                                        {labelFor(
                                                            REASONING_EFFORT_LABELS,
                                                            effort,
                                                        )}
                                                    </SelectItem>
                                                ),
                                            )}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </Field>
                        ) : null}
                        {candidate?.transport === "openrouter" ? (
                            <OpenRouterFields candidate={candidate} />
                        ) : null}
                        {candidate?.support.supportsStructuredOutput ? (
                            <StructuredOutputFields />
                        ) : (
                            <input
                                type="hidden"
                                name="structuredOutputMode"
                                value="text"
                            />
                        )}
                        <Collapsible className="rounded-sm bg-surface p-3">
                            <CollapsibleTrigger>
                                Advanced controls
                            </CollapsibleTrigger>
                            {/* Kept mounted (and hidden) while closed so its fields still submit. */}
                            <CollapsibleContent
                                keepMounted
                                className="grid gap-4 pt-4 data-closed:hidden md:grid-cols-2"
                            >
                                <Field
                                    label="Flash Evals result reuse"
                                    id="llm-mosaic-reuse"
                                >
                                    <Select
                                        name="mosaicReuse"
                                        defaultValue="force_fresh"
                                    >
                                        <SelectTrigger id="llm-mosaic-reuse">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                <SelectItem value="force_fresh">
                                                    Always call provider
                                                    (recommended)
                                                </SelectItem>
                                                <SelectItem value="allow">
                                                    Allow exact-result reuse
                                                </SelectItem>
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                </Field>
                                <Field
                                    label="Provider caching"
                                    id="llm-provider-caching"
                                >
                                    <input
                                        type="hidden"
                                        name="providerCaching"
                                        value="allow"
                                    />
                                    <p
                                        id="llm-provider-caching"
                                        className="text-copy-14 text-muted-foreground"
                                    >
                                        Provider-managed caching may apply.
                                        Flash Evals records observed cache
                                        evidence but cannot disable every
                                        provider cache.
                                    </p>
                                </Field>
                                <Field
                                    label="Timeout (milliseconds)"
                                    id="llm-timeout"
                                >
                                    <Input
                                        id="llm-timeout"
                                        name="timeoutMs"
                                        type="number"
                                        min={1}
                                        defaultValue={60_000}
                                    />
                                </Field>
                                {candidate?.transport !== "gateway" ? (
                                    <Field
                                        label="Maximum attempts"
                                        id="llm-max-attempts"
                                    >
                                        <Input
                                            id="llm-max-attempts"
                                            name="maxAttempts"
                                            type="number"
                                            min={1}
                                            defaultValue={1}
                                        />
                                    </Field>
                                ) : null}
                            </CollapsibleContent>
                        </Collapsible>
                        <PendingButton
                            label={
                                routeId === "new"
                                    ? "Create route"
                                    : "Create route version"
                            }
                            pendingLabel="Creating…"
                            disabled={!canCreate}
                        />
                        <ActionMessage state={state} />
                    </form>
                )}
            </CardContent>
        </Card>
    );
}

function StructuredOutputFields() {
    const [mode, setMode] = useState<"text" | "json_schema">("text");
    return (
        <div className="grid gap-4 rounded-sm bg-surface p-3 md:grid-cols-2">
            <Field label="Structured output" id="llm-structured-output">
                <Select
                    name="structuredOutputMode"
                    value={mode}
                    onValueChange={(value) =>
                        setMode(value as "text" | "json_schema")
                    }
                >
                    <SelectTrigger id="llm-structured-output">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="json_schema">
                                JSON schema
                            </SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>
            {mode === "json_schema" ? (
                <>
                    <Field label="Schema name" id="llm-schema-name">
                        <Input
                            id="llm-schema-name"
                            name="schemaName"
                            required
                        />
                    </Field>
                    <Field
                        label="Schema digest"
                        id="llm-schema-digest"
                        helper="Use the canonical schema digest captured by your workflow contract."
                    >
                        <Input
                            id="llm-schema-digest"
                            name="schemaDigest"
                            className="text-mono-13"
                            required
                        />
                    </Field>
                    <CheckboxField
                        id="llm-schema-strict"
                        name="schemaStrict"
                        label="Require strict schema output"
                    />
                </>
            ) : null}
        </div>
    );
}

function OpenRouterFields({
    candidate,
}: {
    candidate: IWorkflowLlmRouteCandidate;
}) {
    const modes = candidate.support.upstreamRoutingModes.filter(
        (mode) => mode !== "none",
    );
    const [mode, setMode] = useState(modes[0] ?? "auto");
    return (
        <div className="grid gap-4 rounded-sm bg-surface p-3 md:grid-cols-2">
            <Field label="Upstream routing" id="llm-upstream-mode">
                <Select
                    name="upstreamMode"
                    value={mode}
                    onValueChange={(value) =>
                        setMode(value as "auto" | "preference" | "exact")
                    }
                >
                    <SelectTrigger id="llm-upstream-mode">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {modes.map((candidate) => (
                                <SelectItem key={candidate} value={candidate}>
                                    {labelFor(UPSTREAM_MODE_LABELS, candidate)}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </Field>
            {mode !== "auto" ? (
                <Field
                    label="Upstream providers"
                    id="llm-upstream-providers"
                    helper="Comma-separated upstream provider slugs. Saving revalidates them against current provider evidence."
                >
                    <Input
                        id="llm-upstream-providers"
                        name="upstreamProviders"
                        placeholder="provider-a, provider-b"
                        required
                    />
                </Field>
            ) : null}
            <CheckboxField
                id="llm-require-parameters"
                name="requireParameters"
                label="Require parameter support"
            />
            {mode === "preference" ? (
                <CheckboxField
                    id="llm-allow-fallbacks"
                    name="allowFallbacks"
                    label="Allow fallback after preference order"
                />
            ) : null}
            <CheckboxField
                id="llm-response-cache"
                name="responseCache"
                value="allow"
                label="Allow OpenRouter response cache"
            />
        </div>
    );
}

function RouteList({
    projectId,
    routes,
    projectDefault,
}: {
    projectId: string;
    routes: IWorkflowLlmRoute[];
    projectDefault?: IWorkflowLlmProjectDefaultState;
}) {
    const currentDefault = routes
        .flatMap((route) =>
            routeVersions(route).map((version) => ({ route, version })),
        )
        .find(({ version }) => version.id === projectDefault?.routeVersionId);
    return (
        <Card>
            <CardHeader>
                <CardTitle>Saved routes and project default</CardTitle>
                <CardDescription>
                    Default changes affect future default resolutions only.
                    Existing run snapshots stay unchanged.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 rounded-sm bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="text-label-14 text-on-surface">
                            Current project default
                        </p>
                        <p className="text-copy-14 text-muted-foreground">
                            {currentDefault
                                ? `${currentDefault.route.name} · v${currentDefault.version.version}`
                                : "No default. Nodes using the project default must be repaired or a default must be set before launch."}
                        </p>
                    </div>
                    {projectDefault ? (
                        <DefaultClearForm projectId={projectId} />
                    ) : null}
                </div>
                {routes.length === 0 ? (
                    <p className="text-copy-14 text-muted-foreground">
                        Create a route to make it available to workflow authors.
                    </p>
                ) : (
                    routes.map((route) => (
                        <ManagedRoute
                            key={route.id}
                            projectId={projectId}
                            route={route}
                            isDefault={routeVersions(route).some(
                                (version) =>
                                    version.id ===
                                    projectDefault?.routeVersionId,
                            )}
                        />
                    ))
                )}
            </CardContent>
        </Card>
    );
}

function ManagedRoute({
    projectId,
    route,
    isDefault,
}: {
    projectId: string;
    route: IWorkflowLlmRoute;
    isDefault: boolean;
}) {
    const [defaultState, defaultAction] = useActionState(
        setWorkflowLlmDefaultAction,
        {},
    );
    const [disableState, setDisableState] =
        useState<IWorkflowLlmRoutingActionState>({});
    const version = route.latestVersion;
    return (
        <div
            data-disabled={route.disabledAt ? "" : undefined}
            className="flex flex-col gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0"
        >
            <div
                className={cn(
                    "flex flex-col gap-1",
                    route.disabledAt && "opacity-60",
                )}
            >
                <p className="flex flex-wrap items-center gap-2 text-label-14 text-on-surface">
                    {route.name}
                    {isDefault ? <RouteStateBadge state="default" /> : null}
                    {route.disabledAt ? (
                        <RouteStateBadge state="disabled" />
                    ) : null}
                </p>
                <p className="text-mono-13 text-muted-foreground">
                    {version
                        ? `${labelFor(TRANSPORT_LABELS, version.config.transportConfig.transport)} · ${version.config.modelId} · v${version.version}`
                        : "No route version"}
                </p>
            </div>
            {!route.disabledAt && version ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                    {!isDefault ? (
                        <form action={defaultAction}>
                            <input
                                type="hidden"
                                name="projectId"
                                value={projectId}
                            />
                            <input
                                type="hidden"
                                name="routeVersionId"
                                value={version.id}
                            />
                            <PendingButton
                                label="Set as default"
                                pendingLabel="Setting…"
                                variant="secondary"
                            />
                        </form>
                    ) : null}
                    <ConfirmDialog
                        trigger={
                            <Button type="button" variant="secondary">
                                Disable route
                            </Button>
                        }
                        title={`Disable “${route.name}”?`}
                        description={
                            isDefault
                                ? "This is the project default. Workflow nodes that rely on it need another route before they can run."
                                : "Workflow nodes pinned to this route need another route before they can run."
                        }
                        confirmLabel="Disable route"
                        pendingLabel="Disabling…"
                        onConfirm={async () => {
                            const formData = new FormData();
                            formData.set("projectId", projectId);
                            formData.set("routeId", route.id);
                            const result = await disableWorkflowLlmRouteAction(
                                {},
                                formData,
                            );
                            setDisableState(result);
                            return result.error;
                        }}
                    />
                </div>
            ) : null}
            <ActionMessage state={defaultState} />
            <ActionMessage state={disableState} />
        </div>
    );
}

function DefaultClearForm({ projectId }: { projectId: string }) {
    const [state, setState] = useState<IWorkflowLlmRoutingActionState>({});
    return (
        <div>
            <ConfirmDialog
                trigger={
                    <Button type="button" variant="secondary">
                        Clear default
                    </Button>
                }
                title="Clear the project default route?"
                description="Workflow nodes that rely on the default need an explicit route before they can run."
                confirmLabel="Clear default"
                pendingLabel="Clearing…"
                onConfirm={async () => {
                    const formData = new FormData();
                    formData.set("projectId", projectId);
                    const result = await clearWorkflowLlmDefaultAction(
                        {},
                        formData,
                    );
                    setState(result);
                    return result.error;
                }}
            />
            <ActionMessage state={state} />
        </div>
    );
}

function GenerationField({
    control,
    controls,
    label,
    defaultValue,
    required,
    inputMode,
}: {
    control: WorkflowLlmGenerationControl;
    controls: Set<WorkflowLlmGenerationControl>;
    label: string;
    defaultValue?: string;
    required?: boolean;
    inputMode?: "decimal" | "numeric";
}) {
    if (!controls.has(control)) return null;
    return (
        <Field label={label} id={`llm-${control}`}>
            <Input
                id={`llm-${control}`}
                name={control}
                type="number"
                inputMode={inputMode}
                defaultValue={defaultValue}
                required={required}
            />
        </Field>
    );
}

function Field({
    label,
    id,
    helper,
    children,
}: {
    label: string;
    id: string;
    helper?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor={id}>{label}</Label>
            {children}
            {helper ? (
                <p className="text-copy-14 text-muted-foreground">{helper}</p>
            ) : null}
        </div>
    );
}

function CheckboxField({
    id,
    name,
    value,
    label,
}: {
    id: string;
    name: string;
    value?: string;
    label: string;
}) {
    return (
        <label
            htmlFor={id}
            className="flex items-center gap-2 text-copy-14 text-on-surface"
        >
            <Checkbox id={id} name={name} value={value} />
            {label}
        </label>
    );
}

function PendingButton({
    label,
    pendingLabel,
    disabled,
    variant = "default",
    ariaLabel,
}: {
    label: string;
    pendingLabel: string;
    disabled?: boolean;
    variant?: "default" | "secondary";
    ariaLabel?: string;
}) {
    const { pending } = useFormStatus();
    return (
        <Button
            type="submit"
            variant={variant}
            disabled={disabled}
            loading={pending}
            loadingText={pendingLabel}
            aria-label={ariaLabel}
        >
            {label}
        </Button>
    );
}

/** Success is a toast; errors stay next to the control that failed. */
function ActionMessage({ state }: { state: IWorkflowLlmRoutingActionState }) {
    useActionToast(state, (s) => (s.error ? undefined : s.message));
    if (!state.error) return null;
    return (
        <p role="alert" className="text-copy-14 text-error">
            {state.error}
            {state.remediation ? ` ${state.remediation}` : ""}
        </p>
    );
}

function keyForTransport(
    keys: IProviderKeyMetadata[],
    transport: WorkflowLlmTransport,
): IProviderKeyMetadata | undefined {
    return keys.find((key) => key.provider === transport);
}

function routeVersions(
    route: IWorkflowLlmRoute,
): NonNullable<IWorkflowLlmRoute["latestVersion"]>[] {
    if (route.versions?.length) return route.versions;
    return route.latestVersion ? [route.latestVersion] : [];
}
