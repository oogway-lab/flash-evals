import type {
    ICreateWorkflowRunRequest,
    IWorkflowLlmCapabilitySnapshot,
    IWorkflowLlmRouteConfig,
} from "@flash-evals/api-contract";
import {
    WORKFLOW_JUDGE_SCHEMA_DIGEST,
    WORKFLOW_JUDGE_SCHEMA_NAME,
} from "@flash-evals/api-contract";
import { vi } from "vitest";
import type { IDb, ITransactionalDb } from "../db.js";

/**
 * Test doubles for pipeline run creation: a database that answers the
 * creation queries and records the writes of one transaction.
 */
const RUN_TEAM_ID = "11111111-1111-4111-8111-111111111111";
const RUN_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const RUN_WORKFLOW_ID = "33333333-3333-4333-8333-333333333333";
const RUN_DATASET_ID = "44444444-4444-4444-8444-444444444444";
export const RUN_ROUTE_VERSION_ID = "55555555-5555-4555-8555-555555555555";
export const RUN_CAPABILITY_ID = "66666666-6666-4666-8666-666666666666";
export const RUN_ROTATION_ID = "77777777-7777-4777-8777-777777777777";

export const runRouteConfig: IWorkflowLlmRouteConfig = {
    modelId: "gpt-4o",
    transportConfig: {
        transport: "openrouter",
        upstreamPolicy: { mode: "exact", only: ["openai"] },
        requireParameters: true,
        responseCache: "disable",
    },
    generation: { maxOutputTokens: 512, temperature: 0 },
    structuredOutput: { mode: "text" },
    retry: { owner: "gateway", timeoutMs: 30_000 },
    cache: { flashEvalsReuse: "allow", providerCaching: "allow" },
};

const runCapability: IWorkflowLlmCapabilitySnapshot = {
    capabilityVersionId: RUN_CAPABILITY_ID,
    capabilityDigest: "sha256:capability",
    capturedAt: "2026-07-24T00:00:00.000Z",
    stale: false,
    transport: {
        transport: "openrouter",
        transportModelId: "openai/gpt-4o",
        upstreamRoutingModes: ["auto", "preference", "exact"],
        supportedGenerationControls: [
            "maxOutputTokens",
            "temperature",
            "topP",
            "seed",
        ],
        supportsStructuredOutput: true,
        requiresCurrentDiscovery: true,
    },
    supportedUpstreamProviders: ["openai"],
};

export const COMPARISON_RUN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
// Made-up snack-sales extraction; not client data.
export const COMPARISON_BENCHMARK = {
    source: "model" as const,
    taskMap: {
        tasks: [
            {
                key: "summary",
                name: "Summary",
                method: "head_to_head" as const,
                paths: ["$.summary"],
            },
        ],
    },
    judge: { modelId: "openai/judge-model", transport: "gateway" as const },
    policy: { minWinOrTieRate: 0.8 },
};
export const COMPARISON_RUN = {
    id: COMPARISON_RUN_ID,
    datasetId: "44444444-4444-4444-8444-444444444444",
    status: "completed",
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    configSnapshot: {
        benchmark: COMPARISON_BENCHMARK,
        dataPolicy: {
            onlyHosts: ["azure", "bedrock"],
            zeroDataRetention: true,
        },
        maxTokens: 4000,
    },
    noteTitle: null,
    referenceRunModelId: "rm-ref",
    referenceModelId: "openai/big-model",
};

export const createRunInput: ICreateWorkflowRunRequest = {
    teamId: RUN_TEAM_ID,
    projectId: RUN_PROJECT_ID,
    workflowId: RUN_WORKFLOW_ID,
    datasetId: RUN_DATASET_ID,
    runTarget: "dataset",
    createdBy: "88888888-8888-4888-8888-888888888888",
};

export interface ICreateRunDbOptions {
    promptSchema?: { digest: string; schema: Record<string, unknown> };
    selection?: "simple" | "pinned_route" | "project_default" | "missing";
    /** The provider a Simple mode node calls. */
    simpleTransport?:
        "gateway" | "openrouter" | "anthropic" | "google" | "bifrost";
    /** No key saved in Settings (a key may come from the server's .env). */
    noProviderKeys?: boolean;
    defaultMissing?: boolean;
    routeMissing?: boolean;
    disabled?: boolean;
    currentRotationVersion?: string | null;
    failOutbox?: boolean;
    scoringModelId?: string;
    nonModelScoring?: boolean;
    pinnedModelId?: string;
    itemCount?: number;
    spentUsd?: number;
    /** Give the pipeline a final answer. */
    finalAnswer?: boolean;
    /** The eval run `compareWithRunId` names; absent when not found. */
    comparisonRun?: Record<string, unknown>;
}

export function createRunDb(options: ICreateRunDbOptions = {}) {
    const committedWrites: Array<{ sql: string; values: unknown[] }> = [];
    const attemptedWrites: Array<{ sql: string; values: unknown[] }> = [];
    let capturedSnapshot: unknown;
    let keyedRun:
        | {
              workflowRunId: string;
              idempotencyKey: string;
              idempotencyFingerprint: string;
          }
        | undefined;
    let outboxStatus: "pending_enqueue" | "queued" | undefined;
    let committed = false;
    let rolledBack = false;
    const selection = options.selection ?? "pinned_route";
    // This fixture intentionally models the full transaction/query state machine.
    // eslint-disable-next-line complexity -- test double covers commit and rollback branches.
    const query = vi.fn(async (text: string, values: unknown[] = []) => {
        const sql = text.replace(/\s+/g, " ").trim();
        if (/^(insert|update|delete) /i.test(sql)) {
            if (
                options.failOutbox &&
                sql.includes("insert into workflow_run_enqueue_outbox")
            )
                throw new Error("outbox unavailable");
            attemptedWrites.push({ sql, values });
            if (sql.includes("insert into workflow_runs")) {
                capturedSnapshot = structuredClone(values[6]);
                if (typeof values[9] === "string")
                    keyedRun = {
                        workflowRunId: String(values[0]),
                        idempotencyKey: values[9],
                        idempotencyFingerprint: String(values[10]),
                    };
            }
            if (sql.includes("insert into workflow_run_enqueue_outbox"))
                outboxStatus = "pending_enqueue";
            if (
                sql.includes("update workflow_run_enqueue_outbox") &&
                sql.includes("set status = 'queued'")
            )
                outboxStatus = "queued";
            return { rows: [] } as never;
        }
        if (
            sql.includes("from workflow_run_enqueue_outbox") &&
            sql.includes("where workflow_run_id = $1")
        )
            return {
                rows: outboxStatus
                    ? [
                          {
                              workflowRunId: String(values[0]),
                              status: outboxStatus,
                          },
                      ]
                    : [],
            } as never;
        if (
            sql.includes('idempotency_fingerprint as "idempotencyFingerprint"')
        ) {
            const existing = keyedRun;
            return {
                rows:
                    existing && existing.idempotencyKey === values[3]
                        ? [
                              {
                                  workflowRunId: existing.workflowRunId,
                                  idempotencyFingerprint:
                                      existing.idempotencyFingerprint,
                                  enqueueStatus: "pending_enqueue",
                              },
                          ]
                        : [],
            } as never;
        }
        if (
            sql.includes("from prompt_workflows") &&
            sql.includes("archived_at")
        )
            return {
                rows: [
                    {
                        id: RUN_WORKFLOW_ID,
                        teamId: RUN_TEAM_ID,
                        projectId: RUN_PROJECT_ID,
                        name: "Pinned workflow",
                        description: "",
                        kind: "prompt",
                        sttConfig: null,
                        finalAnswer: options.finalAnswer
                            ? {
                                  fields: [
                                      {
                                          path: "$.summary",
                                          stepKey: "prompt-1",
                                          stepPath: "$",
                                      },
                                  ],
                              }
                            : null,
                        createdAt: new Date("2026-07-24T00:00:00.000Z"),
                    },
                ],
            } as never;
        if (
            sql.includes("from workflow_nodes") &&
            sql.includes("order by node_key")
        )
            return {
                rows: [
                    {
                        id: "node-1",
                        workflowId: RUN_WORKFLOW_ID,
                        nodeKey: "prompt-1",
                        label: "Prompt 1",
                        nodeType: options.nonModelScoring ? "input" : "prompt",
                        nodeConfig: options.nonModelScoring
                            ? {
                                  type: "input",
                                  modality: "text",
                                  datasetId: RUN_DATASET_ID,
                              }
                            : null,
                        promptVersionId: options.nonModelScoring
                            ? null
                            : "99999999-9999-4999-8999-999999999999",
                        modelId: options.nonModelScoring
                            ? null
                            : (options.pinnedModelId ?? "gpt-4o"),
                        reasoningConfig: null,
                        llmSelectionMode:
                            options.nonModelScoring || selection === "missing"
                                ? null
                                : selection,
                        llmRouteVersionId:
                            selection === "pinned_route"
                                ? RUN_ROUTE_VERSION_ID
                                : null,
                        llmTransport:
                            selection === "simple"
                                ? (options.simpleTransport ?? "gateway")
                                : null,
                        evalConfig: options.scoringModelId
                            ? {
                                  type: "judge",
                                  judgeConfigId:
                                      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                              }
                            : { type: "none" },
                        position: null,
                    },
                ],
            } as never;
        if (sql.includes("from workflow_edges")) return { rows: [] } as never;
        if (sql.includes("from provider_keys") && options.noProviderKeys)
            return { rows: [] } as never;
        if (sql.includes("from provider_keys"))
            return {
                rows: [
                    {
                        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                        // Direct Gemini API steps use the saved Gemini key.
                        provider:
                            options.simpleTransport === "google"
                                ? "gemini"
                                : (options.simpleTransport ?? "gateway"),
                        rotationVersion: RUN_ROTATION_ID,
                    },
                ],
            } as never;
        if (sql.includes("from prompt_versions pv"))
            return {
                rows: [
                    {
                        id: "99999999-9999-4999-8999-999999999999",
                        content: "Summarize this.",
                        schemaHash:
                            options.promptSchema?.digest ??
                            (options.scoringModelId
                                ? WORKFLOW_JUDGE_SCHEMA_DIGEST
                                : null),
                        jsonSchema:
                            options.promptSchema?.schema ??
                            (options.scoringModelId
                                ? { type: "object" }
                                : null),
                    },
                ],
            } as never;
        if (sql.includes("from datasets"))
            return {
                rows: [{ archivedAt: null, modality: "text" }],
            } as never;
        if (sql.includes("from project_llm_defaults"))
            return {
                rows: options.defaultMissing
                    ? []
                    : [{ routeVersionId: RUN_ROUTE_VERSION_ID }],
            } as never;
        if (sql.includes("from llm_route_versions v"))
            return {
                rows: options.routeMissing
                    ? []
                    : [
                          {
                              routeVersionId: RUN_ROUTE_VERSION_ID,
                              routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                              routeVersion: 3,
                              config: options.scoringModelId
                                  ? {
                                        ...runRouteConfig,
                                        structuredOutput: {
                                            mode: "json_schema",
                                            schemaName:
                                                WORKFLOW_JUDGE_SCHEMA_NAME,
                                            schemaDigest:
                                                WORKFLOW_JUDGE_SCHEMA_DIGEST,
                                            strict: true,
                                        },
                                    }
                                  : {
                                        ...runRouteConfig,
                                        modelId:
                                            options.pinnedModelId ?? "gpt-4o",
                                    },
                              providerKeyId:
                                  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                              capturedRotationVersion: RUN_ROTATION_ID,
                              currentRotationVersion:
                                  options.currentRotationVersion === undefined
                                      ? RUN_ROTATION_ID
                                      : options.currentRotationVersion,
                              credentialHint: "…1234",
                              capabilityVersionId: RUN_CAPABILITY_ID,
                              capabilityDigest: "sha256:capability",
                              capabilitySnapshot: {
                                  ...runCapability,
                                  transport: {
                                      ...runCapability.transport,
                                      modelId:
                                          options.pinnedModelId ?? "gpt-4o",
                                      transportModelId:
                                          options.pinnedModelId ??
                                          "openai/gpt-4o",
                                  },
                              },
                              disabledAt: options.disabled
                                  ? new Date("2026-07-24T01:00:00.000Z")
                                  : null,
                          },
                      ],
            } as never;
        if (sql.includes("from judge_configs"))
            return {
                rows: [
                    {
                        modelId: options.scoringModelId,
                        rubricPrompt: "Judge it",
                        declaredInputs: ["task_input", "candidate_output"],
                        reasoningEffort: undefined,
                    },
                ],
            } as never;
        if (sql.includes("from dataset_items"))
            return {
                rows: Array.from(
                    { length: options.itemCount ?? 1 },
                    (_, i) => ({ id: `item-${i + 1}` }),
                ),
            } as never;
        if (sql.includes('as "spentUsd"'))
            return { rows: [{ spentUsd: options.spentUsd ?? 0 }] } as never;
        if (sql.includes("from runs r") && sql.includes("left join lateral"))
            return {
                rows: options.comparisonRun ? [options.comparisonRun] : [],
            } as never;
        return { rows: [] } as never;
    });
    const db: ITransactionalDb = {
        query,
        async transaction(run) {
            const writeStart = attemptedWrites.length;
            try {
                const result = await run({ query } as unknown as IDb);
                committedWrites.push(...attemptedWrites.slice(writeStart));
                committed = true;
                return result;
            } catch (error) {
                attemptedWrites.splice(writeStart);
                capturedSnapshot = undefined;
                rolledBack = true;
                throw error;
            }
        },
    };
    return {
        db,
        query,
        committedWrites,
        get capturedSnapshot() {
            return capturedSnapshot;
        },
        get committed() {
            return committed;
        },
        get rolledBack() {
            return rolledBack;
        },
    };
}
