import type {
    IWorkflowLlmCapabilitySnapshot,
    IWorkflowLlmRouteConfig,
    WorkflowLlmGenerationControl,
    WorkflowLlmTransport,
} from "./workflows.js";

export interface IWorkflowLlmCapability {
    id: string;
    teamId: string;
    projectId: string;
    transport: WorkflowLlmTransport;
    capabilityDigest: string;
    snapshot: IWorkflowLlmCapabilitySnapshot;
    capturedAt: string;
    expiresAt: string;
    credentialAvailable: boolean;
}

export interface IRefreshWorkflowLlmCapabilitiesRequest {
    teamId: string;
    projectId: string;
    transport: WorkflowLlmTransport;
    providerKeyId: string;
    refreshedBy: string;
}

export interface IWorkflowLlmRouteVersion {
    id: string;
    routeId: string;
    version: number;
    config: IWorkflowLlmRouteConfig;
    providerKeyId: string;
    providerKeyRotationVersion: string;
    capabilityVersionId: string;
    createdBy?: string;
    createdAt: string;
}

export interface IWorkflowLlmRoute {
    id: string;
    teamId: string;
    projectId: string;
    name: string;
    disabledAt?: string;
    latestVersion?: IWorkflowLlmRouteVersion;
    /** The latest immutable version; history is fetched through the paginated endpoint. */
    versions?: IWorkflowLlmRouteVersion[];
    createdBy?: string;
    createdAt: string;
}

export interface IWorkflowLlmRouteHistoryResponse {
    routeId: string;
    versions: IWorkflowLlmRouteVersion[];
    nextCursor?: string;
}

export interface ICreateWorkflowLlmRouteVersionRequest {
    projectId: string;
    routeId?: string;
    name: string;
    config: IWorkflowLlmRouteConfig;
}

/**
 * Compatibility name for semantic provider/model route authoring.
 *
 * New callers should use `ICreateWorkflowLlmRouteVersionRequest`. Both simple
 * and advanced authoring submit the same canonical route configuration; the
 * API resolves credentials and records provider-verified evidence.
 */
export type ICreateWorkflowLlmRouteForModelRequest =
    ICreateWorkflowLlmRouteVersionRequest;

/** Provider IDs from live model catalogs are intentionally open-ended. */
export type WorkflowLlmModelProvider = string;

export interface IWorkflowLlmRouteCandidateSupport {
    upstreamRoutingModes: Array<"none" | "auto" | "preference" | "exact">;
    supportedGenerationControls: WorkflowLlmGenerationControl[];
    supportsStructuredOutput: boolean;
}

/**
 * A model observed in the selected provider's live model listing and enriched
 * with Flash Evals's conservative registry metadata. It is selection context, not
 * proof that a later execution will succeed; route mutation rechecks it.
 */
export interface IWorkflowLlmRouteCandidate {
    transport: WorkflowLlmTransport;
    modelId: string;
    label: string;
    modelProvider: WorkflowLlmModelProvider;
    modelProviderLabel: string;
    source: "provider_model_listing";
    availability: "provider_listed_candidate";
    requiresMutationDiscovery: true;
    support: IWorkflowLlmRouteCandidateSupport;
}

export interface IWorkflowLlmRouteCandidatesResponse {
    transport: WorkflowLlmTransport;
    /** Every language model in the provider's current authenticated listing. */
    coverage: "provider_model_listing";
    candidates: IWorkflowLlmRouteCandidate[];
}

export interface IDisableWorkflowLlmRouteRequest {
    teamId: string;
    projectId: string;
    routeId: string;
    disabledBy: string;
}

export interface IWorkflowLlmProjectDefaultState {
    projectId: string;
    routeVersionId: string;
    updatedBy?: string;
    updatedAt: string;
}

export interface IWorkflowLlmProjectDefaultResponse {
    default?: IWorkflowLlmProjectDefaultState;
}

export interface ISetWorkflowLlmProjectDefaultRequest {
    teamId: string;
    projectId: string;
    routeVersionId: string;
    updatedBy: string;
}

export interface IClearWorkflowLlmProjectDefaultRequest {
    teamId: string;
    projectId: string;
    updatedBy: string;
}

export interface IWorkflowLlmProjectDefaultMutation {
    oldDefault?: IWorkflowLlmProjectDefaultState;
    newDefault?: IWorkflowLlmProjectDefaultState;
    updatedBy: string;
}
