import {
    WORKFLOW_ENV_CREDENTIAL,
    type IWorkflowLlmCapabilitySnapshot,
} from "@flash-evals/api-contract";
import { describe, expect, it, vi } from "vitest";
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import {
    ApiBadRequestError,
    ApiFieldValidationError,
    ApiNotFoundError,
} from "../errors.js";
import {
    createWorkflowRunPayload,
    saveWorkflowRunCellAnnotationPayload,
    saveWorkflowRunNotePayload,
    simpleTransportModel,
    workflowRunDetailPayload,
} from "./workflowRuns.js";
import { publishWorkflowRunEnqueue } from "../workflowRunEnqueue.js";
import {
    createRunDb,
    createRunInput,
    RUN_CAPABILITY_ID,
    RUN_ROTATION_ID,
    RUN_ROUTE_VERSION_ID,
    runRouteConfig,
    type ICreateRunDbOptions,
} from "./workflowRuns.testFixture.js";

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

    it("stores the spend limit and data rules in the run's config snapshot", async () => {
        const fixture = createRunDb();

        await createWorkflowRunPayload(fixture.db, {
            ...createRunInput,
            maxCostUsd: 3,
            dataPolicy: {
                onlyHosts: ["openai", "azure"],
                disallowPromptTraining: true,
            },
        });

        const insert = fixture.committedWrites.find(({ sql }) =>
            sql.includes("insert into workflow_runs"),
        );
        expect(insert?.sql).toContain("config_snapshot");
        expect(insert?.values[11]).toEqual({
            maxCostUsd: 3,
            dataPolicy: {
                onlyHosts: ["openai", "azure"],
                disallowPromptTraining: true,
            },
        });
    });

    it("refuses data rules a pinned OpenRouter host would break", async () => {
        const fixture = createRunDb();

        await expect(
            createWorkflowRunPayload(fixture.db, {
                ...createRunInput,
                dataPolicy: { onlyHosts: ["google-vertex"] },
            }),
        ).rejects.toThrow(/pinned to OpenRouter host "openai"/);
        expect(fixture.committedWrites).toEqual([]);
    });

    it("refuses a spend limit that is not a positive amount", async () => {
        const fixture = createRunDb();

        await expect(
            createWorkflowRunPayload(fixture.db, {
                ...createRunInput,
                maxCostUsd: 0,
            }),
        ).rejects.toThrow("The spend limit must be more than $0");
        expect(fixture.committedWrites).toEqual([]);
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

    it("leaves Google text thinking unset while budgeting time and tokens for long output", async () => {
        const fixture = createRunDb({
            selection: "simple",
            pinnedModelId: "google/gemini-3.8-flash",
        });
        await createWorkflowRunPayload(fixture.db, createRunInput);
        const snapshot = fixture.capturedSnapshot as {
            nodes: Array<{
                resolvedLlmExecution: {
                    route: {
                        generation: Record<string, unknown>;
                        retry: { timeoutMs: number };
                    };
                };
            }>;
        };
        expect(
            snapshot.nodes[0]?.resolvedLlmExecution.route.generation,
        ).toEqual({ maxOutputTokens: 32768 });
        expect(
            snapshot.nodes[0]?.resolvedLlmExecution.route.retry.timeoutMs,
        ).toBe(300_000);
    });

    it("gives every Simple-mode step five minutes, not only Gemini 3", async () => {
        const fixture = createRunDb({ selection: "simple" });
        await createWorkflowRunPayload(fixture.db, createRunInput);
        const snapshot = fixture.capturedSnapshot as {
            nodes: Array<{
                resolvedLlmExecution: {
                    route: { retry: { timeoutMs: number } };
                };
            }>;
        };
        expect(
            snapshot.nodes[0]?.resolvedLlmExecution.route.retry.timeoutMs,
        ).toBe(300_000);
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
            "anthropic",
            "anthropic/claude-sonnet-4.6",
            "claude-sonnet-4-6",
            "anthropic",
        ],
        ["google", "google/gemma-4-31b-it", "gemma-4-31b-it", "gemini"],
    ] as const)(
        "runs Simple mode on %s directly with the maker's model id and Settings key",
        async (transport, modelId, transportModelId, keyName) => {
            const fixture = createRunDb({
                selection: "simple",
                simpleTransport: transport,
                pinnedModelId: modelId,
            });

            await createWorkflowRunPayload(fixture.db, createRunInput);

            const keyQuery = fixture.query.mock.calls.find(([sql]) =>
                String(sql).includes("from provider_keys"),
            );
            expect(keyQuery?.[1]).toEqual([expect.any(String), [keyName]]);
            const snapshot = fixture.capturedSnapshot as {
                nodes: Array<{ resolvedLlmExecution?: unknown }>;
            };
            expect(snapshot.nodes[0]?.resolvedLlmExecution).toMatchObject({
                requestedSelection: { mode: "simple", transport },
                route: { modelId, transportConfig: { transport } },
                credential: {
                    providerKeyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                },
                capability: {
                    transport: {
                        transport,
                        modelId,
                        transportModelId,
                        upstreamRoutingModes: ["none"],
                    },
                },
            });
        },
    );

    it("runs a Simple mode Bifrost step with the env key when none is saved, recording no key id", async () => {
        const fixture = createRunDb({
            selection: "simple",
            simpleTransport: "bifrost",
            noProviderKeys: true,
        });
        const envConfig = {
            bifrostApiKey: "env-bifrost-key",
            bifrostBaseUrl: "https://bifrost.example/v1",
        } as never;

        await createWorkflowRunPayload(fixture.db, createRunInput, envConfig);

        const snapshot = fixture.capturedSnapshot as {
            nodes: Array<{ resolvedLlmExecution?: unknown }>;
        };
        expect(snapshot.nodes[0]?.resolvedLlmExecution).toMatchObject({
            requestedSelection: { mode: "simple", transport: "bifrost" },
            credential: WORKFLOW_ENV_CREDENTIAL,
        });
        expect(JSON.stringify(fixture.capturedSnapshot)).not.toContain(
            "env-bifrost-key",
        );
    });

    it("prefers the Bifrost key saved in Settings over the env key", async () => {
        const fixture = createRunDb({
            selection: "simple",
            simpleTransport: "bifrost",
        });

        await createWorkflowRunPayload(fixture.db, createRunInput, {
            bifrostApiKey: "env-bifrost-key",
            bifrostBaseUrl: "https://bifrost.example/v1",
        } as never);

        const snapshot = fixture.capturedSnapshot as {
            nodes: Array<{ resolvedLlmExecution?: unknown }>;
        };
        expect(snapshot.nodes[0]?.resolvedLlmExecution).toMatchObject({
            credential: {
                providerKeyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                rotationVersion: RUN_ROTATION_ID,
            },
        });
    });

    it("runs a Simple mode Vercel AI Gateway step with the env key when none is saved", async () => {
        const fixture = createRunDb({
            selection: "simple",
            simpleTransport: "gateway",
            noProviderKeys: true,
        });

        await createWorkflowRunPayload(fixture.db, createRunInput, {
            aiGatewayApiKey: "env-gateway-key",
        } as never);

        const snapshot = fixture.capturedSnapshot as {
            nodes: Array<{ resolvedLlmExecution?: unknown }>;
        };
        expect(snapshot.nodes[0]?.resolvedLlmExecution).toMatchObject({
            requestedSelection: { mode: "simple", transport: "gateway" },
            credential: WORKFLOW_ENV_CREDENTIAL,
        });
        expect(JSON.stringify(fixture.capturedSnapshot)).not.toContain(
            "env-gateway-key",
        );
    });

    it("prefers the Vercel AI Gateway key saved in Settings over the env key", async () => {
        const fixture = createRunDb({
            selection: "simple",
            simpleTransport: "gateway",
        });

        await createWorkflowRunPayload(fixture.db, createRunInput, {
            aiGatewayApiKey: "env-gateway-key",
        } as never);

        const snapshot = fixture.capturedSnapshot as {
            nodes: Array<{ resolvedLlmExecution?: unknown }>;
        };
        expect(snapshot.nodes[0]?.resolvedLlmExecution).toMatchObject({
            credential: {
                providerKeyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                rotationVersion: RUN_ROTATION_ID,
            },
        });
    });

    it("refuses a Simple mode Vercel AI Gateway step with no key in Settings or the env", async () => {
        const fixture = createRunDb({
            selection: "simple",
            simpleTransport: "gateway",
            noProviderKeys: true,
        });

        await expect(
            createWorkflowRunPayload(fixture.db, createRunInput, {
                bifrostApiKey: "env-bifrost-key",
                bifrostBaseUrl: "https://bifrost.example/v1",
            } as never),
        ).rejects.toThrow(
            "No gateway provider key is configured for Simple mode.",
        );
        expect(fixture.committedWrites).toEqual([]);
    });

    it("does not use an OpenRouter key from the env for a Simple mode step", async () => {
        const fixture = createRunDb({
            selection: "simple",
            simpleTransport: "openrouter",
            noProviderKeys: true,
        });

        await expect(
            createWorkflowRunPayload(fixture.db, createRunInput, {
                openrouterApiKey: "env-openrouter-key",
            } as never),
        ).rejects.toThrow(/No openrouter provider key is configured/);
    });

    it("refuses a Simple mode Bifrost step with no key in Settings or the env", async () => {
        const fixture = createRunDb({
            selection: "simple",
            simpleTransport: "bifrost",
            noProviderKeys: true,
        });

        await expect(
            createWorkflowRunPayload(fixture.db, createRunInput),
        ).rejects.toThrow(/No bifrost provider key is configured/);
        expect(fixture.committedWrites).toEqual([]);
    });

    it("refuses a Simple mode model the maker doesn't serve directly", async () => {
        const fixture = createRunDb({
            selection: "simple",
            simpleTransport: "anthropic",
            pinnedModelId: "gpt-4o",
        });

        await expect(
            createWorkflowRunPayload(fixture.db, createRunInput),
        ).rejects.toThrow(
            /uses gpt-4o, which Anthropic doesn't serve directly/,
        );
        expect(fixture.committedWrites).toEqual([]);
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

    it("counts the answers to judge again on a completed run", async () => {
        const db = dbForWorkflowRunDetail({ rejudge: 3 });
        const payload = await workflowRunDetailPayload(
            db,
            "team-1",
            "project-1",
            "workflow-1",
            "run-1",
        );

        expect(payload.answersToRejudge).toBe(3);
        expect(
            vi
                .mocked(db.query)
                .mock.calls.find(([sql]) => sql.includes("as rejudge"))?.[1],
        ).toEqual(["run-1"]);
    });

    it("leaves the count out when there is nothing to judge again", async () => {
        const none = await workflowRunDetailPayload(
            dbForWorkflowRunDetail({ rejudge: 0 }),
            "team-1",
            "project-1",
            "workflow-1",
            "run-1",
        );
        expect(none).not.toHaveProperty("answersToRejudge");

        // A partial run already offers a retry; a run without a final answer
        // has no answers to judge.
        for (const db of [
            dbForWorkflowRunDetail({ status: "partial", rejudge: 2 }),
            dbForWorkflowRunDetail(),
        ]) {
            const payload = await workflowRunDetailPayload(
                db,
                "team-1",
                "project-1",
                "workflow-1",
                "run-1",
            );
            expect(payload).not.toHaveProperty("answersToRejudge");
            expect(queries(db).some((sql) => sql.includes("as rejudge"))).toBe(
                false,
            );
        }
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

function dbForWorkflowRunDetail(
    options: {
        status?: string;
        /** Gives the snapshot a final answer and these failed judgings. */
        rejudge?: number;
    } = {},
): IDb {
    return {
        query: vi.fn(async (sql: string) => {
            if (sql.includes("as rejudge from workflow_run_answers"))
                return { rows: [{ rejudge: options.rejudge ?? 0 }] } as never;
            if (sql.includes("from workflow_runs where id=$1"))
                return {
                    rows: [
                        {
                            id: "run-1",
                            teamId: "team-1",
                            projectId: "project-1",
                            workflowId: "workflow-1",
                            datasetId: "dataset-1",
                            status: options.status ?? "completed",
                            workflowSnapshot: {
                                ...(options.rejudge !== undefined
                                    ? { finalAnswer: { fields: [] } }
                                    : {}),
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
                                                    owner: "flash-evals",
                                                    maxAttempts: 1,
                                                    timeoutMs: 60_000,
                                                    retryableErrorClasses: [],
                                                },
                                                cache: {
                                                    flashEvalsReuse:
                                                        "force_fresh",
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
            if (
                sql.includes("from workflow_runs r") &&
                sql.includes("count(c.id)::int total")
            )
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

describe("simpleTransportModel", () => {
    it("sends a Bifrost id as listed and prices it as the registry model behind it", () => {
        expect(
            simpleTransportModel("bifrost", "openrouter/openai/gpt-4o"),
        ).toEqual({
            modelId: "gpt-4o",
            transportModelId: "openrouter/openai/gpt-4o",
        });
        expect(
            simpleTransportModel("bifrost", "openrouter/nobody/new-model"),
        ).toEqual({
            modelId: "openrouter/nobody/new-model",
            transportModelId: "openrouter/nobody/new-model",
        });
    });

    it("keeps a registry id and sends the registry's Bifrost id", () => {
        expect(simpleTransportModel("bifrost", "gpt-4o")).toEqual({
            modelId: "gpt-4o",
            transportModelId: "openai/gpt-4o",
        });
        expect(simpleTransportModel("openrouter", "gpt-4o")).toEqual({
            modelId: "gpt-4o",
            transportModelId: "gpt-4o",
        });
    });
});
