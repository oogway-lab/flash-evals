import type {
    ICreateWorkflowRunRequest,
    IWorkflowLlmCapabilitySnapshot,
    IWorkflowLlmRouteConfig,
} from "@mosaic/api-contract";
import {
    WORKFLOW_JUDGE_SCHEMA_DIGEST,
    WORKFLOW_JUDGE_SCHEMA_NAME,
} from "@mosaic/api-contract";
import { describe, expect, it, vi } from "vitest";
import type { IApiConfig } from "../config.js";
import type { IDb, ITransactionalDb } from "../db.js";
import {
    ApiBadRequestError,
    ApiFieldValidationError,
    ApiNotFoundError,
} from "../errors.js";
import {
    createWorkflowRunPayload,
    saveWorkflowRunCellAnnotationPayload,
    saveWorkflowRunNotePayload,
    workflowRunDetailPayload,
} from "./workflowRuns.js";
import { publishWorkflowRunEnqueue } from "../workflowRunEnqueue.js";

const RUN_TEAM_ID = "11111111-1111-4111-8111-111111111111";
const RUN_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const RUN_WORKFLOW_ID = "33333333-3333-4333-8333-333333333333";
const RUN_DATASET_ID = "44444444-4444-4444-8444-444444444444";
const RUN_ROUTE_VERSION_ID = "55555555-5555-4555-8555-555555555555";
const RUN_CAPABILITY_ID = "66666666-6666-4666-8666-666666666666";
const RUN_ROTATION_ID = "77777777-7777-4777-8777-777777777777";

const runRouteConfig: IWorkflowLlmRouteConfig = {
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
    cache: { mosaicReuse: "allow", providerCaching: "allow" },
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

const createRunInput: ICreateWorkflowRunRequest = {
    teamId: RUN_TEAM_ID,
    projectId: RUN_PROJECT_ID,
    workflowId: RUN_WORKFLOW_ID,
    datasetId: RUN_DATASET_ID,
    runTarget: "dataset",
    createdBy: "88888888-8888-4888-8888-888888888888",
};

interface ICreateRunDbOptions {
    promptSchema?: { digest: string; schema: Record<string, unknown> };
    selection?: "simple" | "pinned_route" | "project_default" | "missing";
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
}

function createRunDb(options: ICreateRunDbOptions = {}) {
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
                        llmTransport: selection === "simple" ? "gateway" : null,
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
        if (sql.includes("from provider_keys"))
            return {
                rows: [
                    {
                        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                        provider: "gateway",
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

describe("workflow run LLM route resolution", () => {
    it("creates no routed run while the rollout write gate is off", async () => {
        const fixture = createRunDb();

        await expect(
            createWorkflowRunPayload(fixture.db, createRunInput, {
                workflowLlmWritesEnabled: false,
            } as IApiConfig),
        ).rejects.toThrow("disabled until the API and worker rollout is ready");

        expect(fixture.committedWrites).toEqual([]);
    });

    it("rejects workflow runs over the configured cell limit", async () => {
        const fixture = createRunDb({ itemCount: 2 });

        await expect(
            createWorkflowRunPayload(fixture.db, createRunInput, {
                maxRunCells: 1,
            } as IApiConfig),
        ).rejects.toThrow("workflow nodes); the limit is 1.");

        expect(fixture.committedWrites).toEqual([]);
    });

    it("refuses workflow runs once the team daily spend cap is reached", async () => {
        const fixture = createRunDb({ spentUsd: 10 });

        await expect(
            createWorkflowRunPayload(fixture.db, createRunInput, {
                teamDailySpendCapUsd: 10,
            } as IApiConfig),
        ).rejects.toThrow("reaching its $10.00 daily cap");

        expect(fixture.committedWrites).toEqual([]);
    });

    it("replays an idempotent workflow run even after the spend cap is reached", async () => {
        const fixture = createRunDb({ spentUsd: 5 });
        const input = { ...createRunInput, idempotencyKey: "spend-cap-retry" };
        const created = await createWorkflowRunPayload(fixture.db, input);
        const capped = { teamDailySpendCapUsd: 1 } as IApiConfig;

        await expect(
            createWorkflowRunPayload(fixture.db, input, capped),
        ).resolves.toMatchObject({ workflowRunId: created.workflowRunId });
    });

    it("reuses one durable run for the same caller idempotency key and intent", async () => {
        const fixture = createRunDb();
        const input = {
            ...createRunInput,
            idempotencyKey: "mcp-retry-1",
        };

        const first = await createWorkflowRunPayload(fixture.db, input);
        const second = await createWorkflowRunPayload(fixture.db, input);

        expect(second).toEqual(first);
        expect(
            fixture.query.mock.calls.filter(([sql]) =>
                String(sql).includes("insert into workflow_runs"),
            ),
        ).toHaveLength(1);
        expect(
            fixture.query.mock.calls.filter(([sql]) =>
                String(sql).includes("pg_advisory_xact_lock"),
            ),
        ).toHaveLength(2);
    });

    it("rejects reuse of an idempotency key with different caller intent", async () => {
        const fixture = createRunDb();
        await createWorkflowRunPayload(fixture.db, {
            ...createRunInput,
            idempotencyKey: "mcp-retry-conflict",
        });

        await expect(
            createWorkflowRunPayload(fixture.db, {
                ...createRunInput,
                runTarget: "single_item",
                itemId: "99999999-9999-4999-8999-999999999998",
                idempotencyKey: "mcp-retry-conflict",
            }),
        ).rejects.toThrow(/already used for a different request/);
    });

    it("returns the same pending durable run after the first publish attempt fails", async () => {
        const fixture = createRunDb();
        const input = {
            ...createRunInput,
            idempotencyKey: "mcp-publish-retry",
        };
        const created = await createWorkflowRunPayload(fixture.db, input);
        const publish = await publishWorkflowRunEnqueue(
            fixture.db,
            {} as never,
            created.workflowRunId,
            async () => {
                throw new Error("queue unavailable");
            },
        );

        const retried = await createWorkflowRunPayload(fixture.db, input);

        expect(publish).toEqual({
            workflowRunId: created.workflowRunId,
            enqueueStatus: "pending_enqueue",
        });
        expect(retried).toEqual(publish);
        expect(
            fixture.query.mock.calls.filter(([sql]) =>
                String(sql).includes("insert into workflow_runs"),
            ),
        ).toHaveLength(1);
    });

    it("pins a complete immutable execution snapshot and outbox in one transaction", async () => {
        const fixture = createRunDb();

        await expect(
            createWorkflowRunPayload(fixture.db, createRunInput),
        ).resolves.toMatchObject({ enqueueStatus: "pending_enqueue" });

        expect(fixture.committed).toBe(true);
        expect(
            fixture.committedWrites.some(({ sql }) =>
                sql.includes("insert into workflow_runs"),
            ),
        ).toBe(true);
        expect(
            fixture.committedWrites.some(({ sql }) =>
                sql.includes("insert into workflow_run_cells"),
            ),
        ).toBe(true);
        expect(
            fixture.committedWrites.some(({ sql }) =>
                sql.includes("insert into workflow_run_enqueue_outbox"),
            ),
        ).toBe(true);
        const snapshot = fixture.capturedSnapshot as {
            nodes: Array<{
                resolvedLlmExecution?: {
                    requestedSelection: unknown;
                    routeVersionId: string;
                    credential: {
                        providerKeyId: string;
                        rotationVersion: string;
                    };
                    capability: IWorkflowLlmCapabilitySnapshot;
                };
            }>;
        };
        expect(snapshot.nodes[0]?.resolvedLlmExecution).toMatchObject({
            requestedSelection: {
                mode: "pinned_route",
                routeVersionId: RUN_ROUTE_VERSION_ID,
            },
            routeVersionId: RUN_ROUTE_VERSION_ID,
            credential: {
                providerKeyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                rotationVersion: RUN_ROTATION_ID,
            },
            capability: {
                capabilityVersionId: RUN_CAPABILITY_ID,
                capabilityDigest: "sha256:capability",
            },
        });
        expect(JSON.stringify(snapshot)).not.toMatch(
            /ciphertext|authTag|api[_-]?key|secret/i,
        );
    });

    it("resolves a symbolic project default once and preserves that immutable result", async () => {
        const fixture = createRunDb({ selection: "project_default" });

        await createWorkflowRunPayload(fixture.db, createRunInput);
        runRouteConfig.modelId = "changed-after-creation";

        const snapshot = fixture.capturedSnapshot as {
            nodes: Array<{
                resolvedLlmExecution?: {
                    requestedSelection: unknown;
                    route: { modelId: string };
                };
            }>;
        };
        expect(snapshot.nodes[0]?.resolvedLlmExecution).toMatchObject({
            requestedSelection: { mode: "project_default" },
            route: { modelId: "gpt-4o" },
        });
        runRouteConfig.modelId = "gpt-4o";
    });

    it("freezes the saved prompt schema for Simple mode execution", async () => {
        const schema = {
            type: "object",
            properties: { total: { type: "number" } },
            required: ["total"],
            additionalProperties: false,
        };
        const fixture = createRunDb({
            selection: "simple",
            promptSchema: { digest: "receipt-schema", schema },
        });
        await createWorkflowRunPayload(fixture.db, createRunInput);
        expect(fixture.capturedSnapshot).toMatchObject({
            nodes: [
                expect.objectContaining({
                    promptSchema: {
                        name: "output",
                        digest: "receipt-schema",
                        strict: true,
                        schema,
                    },
                    resolvedLlmExecution: expect.objectContaining({
                        route: expect.objectContaining({
                            structuredOutput: {
                                mode: "json_schema",
                                schemaName: "output",
                                schemaDigest: "receipt-schema",
                                strict: true,
                            },
                        }),
                    }),
                }),
            ],
        });
    });

    it("runs Simple mode directly with the current provider key", async () => {
        const fixture = createRunDb({ selection: "simple" });

        await createWorkflowRunPayload(fixture.db, createRunInput);

        const snapshot = fixture.capturedSnapshot as {
            nodes: Array<{
                resolvedLlmExecution?: {
                    requestedSelection: unknown;
                    route: {
                        modelId: string;
                        transportConfig: { transport: string };
                    };
                    routeVersion: number;
                };
            }>;
        };
        expect(snapshot.nodes[0]?.resolvedLlmExecution).toMatchObject({
            requestedSelection: { mode: "simple", transport: "gateway" },
            route: {
                modelId: "gpt-4o",
                transportConfig: { transport: "gateway" },
            },
            routeVersion: 0,
        });
        expect(
            fixture.query.mock.calls.some(([sql]) =>
                String(sql).includes("from llm_route_versions v"),
            ),
        ).toBe(false);
    });

    it.each([
        [
            "legacy unresolved node",
            { selection: "missing" } satisfies ICreateRunDbOptions,
            /has no LLM route selection/,
        ],
        [
            "missing project default",
            {
                selection: "project_default",
                defaultMissing: true,
            } satisfies ICreateRunDbOptions,
            /no default is configured/,
        ],
        [
            "disabled route",
            { disabled: true } satisfies ICreateRunDbOptions,
            /is disabled/,
        ],
        [
            "cross-project or missing route",
            { routeMissing: true } satisfies ICreateRunDbOptions,
            /is unavailable/,
        ],
        [
            "rotated credential",
            {
                currentRotationVersion: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            } satisfies ICreateRunDbOptions,
            /changed after this route version/,
        ],
        [
            "deleted credential",
            { currentRotationVersion: null } satisfies ICreateRunDbOptions,
            /changed after this route version/,
        ],
    ])("blocks %s before creating a run", async (_name, options, message) => {
        const fixture = createRunDb(options);

        await expect(
            createWorkflowRunPayload(fixture.db, createRunInput),
        ).rejects.toThrow(message);

        expect(fixture.committedWrites).toEqual([]);
        expect(fixture.rolledBack).toBe(true);
    });

    it("runs an existing pinned route after its capability TTL expires", async () => {
        const fixture = createRunDb();

        await expect(
            createWorkflowRunPayload(fixture.db, createRunInput),
        ).resolves.toMatchObject({
            workflowRunId: expect.any(String),
        });
        expect(fixture.committedWrites).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    sql: expect.stringContaining("insert into workflow_runs"),
                }),
            ]),
        );
        const routeLookup = fixture.query.mock.calls.find(([sql]) =>
            String(sql).includes("from llm_route_versions"),
        );
        expect(String(routeLookup?.[0])).not.toContain("expires_at > now()");
    });

    it("runs a pinned route from immutable evidence after registry removal", async () => {
        const fixture = createRunDb({
            pinnedModelId: "retired/provider-model",
        });

        await expect(
            createWorkflowRunPayload(fixture.db, createRunInput),
        ).resolves.toMatchObject({ workflowRunId: expect.any(String) });
    });

    it("returns a field-aware validation error for unresolved legacy nodes", async () => {
        const fixture = createRunDb({ selection: "missing" });

        const failure = await createWorkflowRunPayload(
            fixture.db,
            createRunInput,
        ).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(ApiFieldValidationError);
        expect(failure).toMatchObject({
            path: "nodes.prompt-1.llmExecutionSelection",
        });
    });

    it("rolls back the run and cells when the outbox write fails", async () => {
        const fixture = createRunDb({ failOutbox: true });

        await expect(
            createWorkflowRunPayload(fixture.db, createRunInput),
        ).rejects.toThrow("outbox unavailable");

        expect(fixture.rolledBack).toBe(true);
        expect(fixture.committedWrites).toEqual([]);
        expect(fixture.capturedSnapshot).toBeUndefined();
    });

    it("blocks an attached scoring model that differs from the resolved route", async () => {
        const fixture = createRunDb({ scoringModelId: "judge-model" });

        await expect(
            createWorkflowRunPayload(fixture.db, createRunInput),
        ).rejects.toThrow(
            'uses model "judge-model", but its resolved route uses "gpt-4o"',
        );

        expect(fixture.committedWrites).toEqual([]);
        expect(fixture.rolledBack).toBe(true);
    });

    it("freezes a matching attached scoring definition in the run snapshot", async () => {
        const fixture = createRunDb({ scoringModelId: "gpt-4o" });

        await createWorkflowRunPayload(fixture.db, createRunInput);

        const snapshot = fixture.capturedSnapshot as {
            nodes: Array<{ scoringConfig?: unknown }>;
        };
        expect(snapshot.nodes[0]?.scoringConfig).toEqual({
            modelId: "gpt-4o",
            rubricPrompt: "Judge it",
            declaredInputs: ["task_input", "candidate_output"],
        });
    });

    it("blocks LLM scoring on a node without a resolved execution", async () => {
        const fixture = createRunDb({
            nonModelScoring: true,
            scoringModelId: "gpt-4o",
        });

        await expect(
            createWorkflowRunPayload(fixture.db, createRunInput),
        ).rejects.toThrow("has no resolved LLM execution");

        expect(fixture.committedWrites).toEqual([]);
        expect(fixture.rolledBack).toBe(true);
    });
});

describe("workflow run review mutations", () => {
    it("upserts a note after resolving team and project ownership", async () => {
        const db = dbWithRows([[{ id: "run-1" }], [], [{ id: "run-1" }], []]);

        for (const body of ["First review", "Updated review"])
            await expect(
                saveWorkflowRunNotePayload(db, {
                    teamId: "team-1",
                    projectId: "project-1",
                    workflowRunId: "run-1",
                    body,
                    updatedBy: "user-1",
                }),
            ).resolves.toBeUndefined();

        expect(db.query).toHaveBeenNthCalledWith(
            1,
            expect.stringMatching(
                /where id = \$1 and team_id = \$2 and project_id = \$3/,
            ),
            ["run-1", "team-1", "project-1"],
        );
        expect(db.query).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining("on conflict (workflow_run_id) do update"),
            ["run-1", "First review", "user-1"],
        );
        expect(db.query).toHaveBeenNthCalledWith(
            4,
            expect.stringContaining("on conflict (workflow_run_id) do update"),
            ["run-1", "Updated review", "user-1"],
        );
    });

    it("rejects another team's run without writing a note", async () => {
        const db = dbWithRows([[]]);

        await expect(
            saveWorkflowRunNotePayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                workflowRunId: "run-other-team",
                body: "Do not write",
                updatedBy: "user-1",
            }),
        ).rejects.toThrow(ApiNotFoundError);

        expect(db.query).toHaveBeenCalledExactlyOnceWith(
            expect.stringMatching(
                /where id = \$1 and team_id = \$2 and project_id = \$3/,
            ),
            ["run-other-team", "team-1", "project-1"],
        );
        expect(queries(db)).not.toContainEqual(
            expect.stringContaining("insert into workflow_run_notes"),
        );
    });

    it("upserts a cell annotation through its tenant-owned workflow run", async () => {
        const db = dbWithRows([[{ workflowRunId: "run-1" }], []]);

        await expect(
            saveWorkflowRunCellAnnotationPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                workflowRunCellId: "cell-1",
                verdict: "approved",
                comment: "Correct",
                updatedBy: "user-1",
            }),
        ).resolves.toEqual({ workflowRunId: "run-1" });

        expect(db.query).toHaveBeenNthCalledWith(
            1,
            expect.stringMatching(
                /inner join workflow_runs r on c\.workflow_run_id = r\.id[\s\S]*r\.team_id = \$2[\s\S]*r\.project_id = \$3/,
            ),
            ["cell-1", "team-1", "project-1"],
        );
        expect(db.query).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining(
                "on conflict (workflow_run_cell_id) do update",
            ),
            ["cell-1", "approved", "Correct", "user-1"],
        );
    });

    it("rejects another team's cell without writing an annotation", async () => {
        const db = dbWithRows([[]]);

        await expect(
            saveWorkflowRunCellAnnotationPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                workflowRunCellId: "cell-other-team",
                verdict: "issue",
                comment: "Do not write",
                updatedBy: "user-1",
            }),
        ).rejects.toThrow(ApiNotFoundError);

        expect(db.query).toHaveBeenCalledExactlyOnceWith(
            expect.stringContaining("inner join workflow_runs"),
            ["cell-other-team", "team-1", "project-1"],
        );
        expect(queries(db)).not.toContainEqual(
            expect.stringContaining(
                "insert into workflow_run_cell_annotations",
            ),
        );
    });

    it("rejects an invalid verdict before querying the database", async () => {
        const db = dbWithRows([]);

        await expect(
            saveWorkflowRunCellAnnotationPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                workflowRunCellId: "cell-1",
                verdict: "invalid" as "approved",
                comment: "Do not write",
                updatedBy: "user-1",
            }),
        ).rejects.toThrow(ApiBadRequestError);

        expect(db.query).not.toHaveBeenCalled();
    });
});

describe("workflow run review detail", () => {
    it("returns the run note and cell annotation", async () => {
        const payload = await workflowRunDetailPayload(
            dbForWorkflowRunDetail(),
            "team-1",
            "project-1",
            "workflow-1",
            "run-1",
        );

        expect(payload.note).toEqual({
            body: "Ready to ship",
            updatedAt: "2026-07-21T10:00:00.000Z",
            updatedBy: "user-1",
        });
        expect(payload.cells[0]).toMatchObject({
            id: "cell-1",
            annotation: {
                verdict: "approved",
                comment: "Good output",
                updatedAt: "2026-07-21T10:01:00.000Z",
                updatedBy: "user-1",
            },
        });
    });

    it("normalizes immutable snapshot routing without inventing missing execution evidence", async () => {
        const payload = await workflowRunDetailPayload(
            dbForWorkflowRunDetail(),
            "team-1",
            "project-1",
            "workflow-1",
            "run-1",
        );

        expect(payload.cells[0]?.llmExecution).toMatchObject({
            availability: "partial",
            requested: { mode: "project_default" },
            resolved: {
                routeVersionId: "route-version-1",
                routeVersion: 1,
            },
        });
        expect(payload.cells[0]?.llmExecution).not.toHaveProperty("actual");
        expect(payload.cells[0]?.llmExecution).not.toHaveProperty("cache");
        expect(payload.cells[0]?.llmExecution).not.toHaveProperty("usage");
        expect(payload.cells[0]?.llmExecution).not.toHaveProperty(
            "currentCost",
        );
        expect(payload.cells[1]?.llmExecution).toEqual({
            availability: "legacy_unavailable",
        });
    });
});

function dbWithRows(rows: unknown[][]): IDb {
    const queue = [...rows];
    return {
        query: vi.fn(async () => ({ rows: queue.shift() ?? [] }) as never),
    };
}

function queries(db: IDb): string[] {
    return vi.mocked(db.query).mock.calls.map(([sql]) => sql);
}

function dbForWorkflowRunDetail(): IDb {
    return {
        query: vi.fn(async (sql: string) => {
            if (sql.includes("from workflow_runs where id=$1"))
                return {
                    rows: [
                        {
                            id: "run-1",
                            teamId: "team-1",
                            projectId: "project-1",
                            workflowId: "workflow-1",
                            datasetId: "dataset-1",
                            status: "completed",
                            workflowSnapshot: {
                                nodes: [
                                    {
                                        id: "node-1",
                                        workflowId: "workflow-1",
                                        nodeKey: "text-1",
                                        label: "Text 1",
                                        nodeType: "llm_text",
                                        nodeConfig: {
                                            type: "llm_text",
                                            promptText: "Clean",
                                        },
                                        evalConfig: { type: "none" },
                                        resolvedLlmExecution: {
                                            contractVersion: 1,
                                            requestedSelection: {
                                                mode: "project_default",
                                            },
                                            routeId: "route-1",
                                            routeVersionId: "route-version-1",
                                            routeVersion: 1,
                                            route: {
                                                transportConfig: {
                                                    transport: "openai",
                                                },
                                                modelId: "gpt-4o",
                                                generation: {
                                                    maxOutputTokens: 512,
                                                },
                                                structuredOutput: {
                                                    mode: "text",
                                                },
                                                retry: {
                                                    owner: "mosaic",
                                                    maxAttempts: 1,
                                                    timeoutMs: 60_000,
                                                    retryableErrorClasses: [],
                                                },
                                                cache: {
                                                    mosaicReuse: "force_fresh",
                                                    providerCaching: "allow",
                                                },
                                            },
                                            credential: {
                                                providerKeyId: "key-1",
                                                rotationVersion: "rotation-1",
                                            },
                                            capability: {
                                                capabilityVersionId:
                                                    "capability-1",
                                                capabilityDigest: "digest-1",
                                                capturedAt:
                                                    "2026-07-24T00:00:00.000Z",
                                                stale: false,
                                                transport: {
                                                    transport: "openai",
                                                    transportModelId: "gpt-4o",
                                                    upstreamRoutingModes: [
                                                        "none",
                                                    ],
                                                    supportedGenerationControls:
                                                        ["maxOutputTokens"],
                                                    supportsStructuredOutput: true,
                                                    requiresCurrentDiscovery: false,
                                                },
                                            },
                                        },
                                    },
                                    {
                                        id: "node-legacy",
                                        workflowId: "workflow-1",
                                        nodeKey: "text-legacy",
                                        label: "Legacy text",
                                        nodeType: "llm_text",
                                        nodeConfig: {
                                            type: "llm_text",
                                            promptText: "Legacy",
                                        },
                                        evalConfig: { type: "none" },
                                    },
                                ],
                                edges: [],
                            },
                            runTarget: "dataset",
                            createdAt: new Date("2026-07-21T09:00:00.000Z"),
                        },
                    ],
                } as never;
            if (sql.includes("from workflow_runs r join workflow_run_cells"))
                return {
                    rows: [
                        {
                            status: "completed",
                            total: 1,
                            done: 1,
                            failed: 0,
                            pending: 0,
                        },
                    ],
                } as never;
            if (sql.includes("from workflow_run_cells where"))
                return {
                    rows: [
                        {
                            id: "cell-1",
                            workflowRunId: "run-1",
                            datasetItemId: "item-1",
                            nodeKey: "text-1",
                            status: "succeeded",
                            inputText: "",
                        },
                        {
                            id: "cell-legacy",
                            workflowRunId: "run-1",
                            datasetItemId: "item-1",
                            nodeKey: "text-legacy",
                            status: "succeeded",
                            inputText: "",
                        },
                    ],
                } as never;
            if (sql.includes("from workflow_run_notes"))
                return {
                    rows: [
                        {
                            body: "Ready to ship",
                            updated_at: new Date("2026-07-21T10:00:00.000Z"),
                            updated_by: "user-1",
                        },
                    ],
                } as never;
            if (sql.includes("from workflow_run_cell_annotations"))
                return {
                    rows: [
                        {
                            workflow_run_cell_id: "cell-1",
                            verdict: "approved",
                            comment: "Good output",
                            updated_at: new Date("2026-07-21T10:01:00.000Z"),
                            updated_by: "user-1",
                        },
                    ],
                } as never;
            return { rows: [] } as never;
        }),
    };
}
