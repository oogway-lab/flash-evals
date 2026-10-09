import { describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@mosaic/llm-core";

vi.mock("@mosaic/llm-core", async (importOriginal) => {
    const actual = await importOriginal<typeof LlmCore>();
    return {
        ...actual,
        getEvalProvider: vi.fn(() => ({
            complete: vi.fn(async () => ({ text: "  Score accuracy.  " })),
        })),
        listAvailableModelMetadata: vi.fn(
            async (
                _apiKeys: unknown,
                options: { provider?: string } | undefined,
            ) =>
                actual.MODEL_REGISTRY.map(
                    (entry: { id: string; gatewayModelId: string }) => ({
                        id:
                            options?.provider === "gateway"
                                ? entry.gatewayModelId
                                : entry.id,
                        pricing: entry.id.startsWith("gpt-")
                            ? {
                                  promptPricePerToken: 1 / 1_000_000,
                                  completionPricePerToken: 2 / 1_000_000,
                              }
                            : undefined,
                    }),
                ),
        ),
    };
});

import {
    createRunFromSelectionPayload,
    createRunPayload,
    deleteRunPayload,
    generateJudgeForRunPayload,
    listRunsPayload,
    retryRunPayload,
    runDetailPayload,
    runProgressPayload,
    runSetupPayload,
    saveCellAnnotationPayload,
    saveRunNotePayload,
} from "./runs.js";
import { ApiNotFoundError } from "../errors.js";
import type { IDb } from "../db.js";
import type { IApiConfig } from "../config.js";
import type { ISttRunConfig } from "@mosaic/api-contract";
import { resolveApiFeatureFlags } from "../featureFlags.js";
import { encryptSecret } from "@mosaic/secrets";
import { normalizeSttVariants } from "./runs/creation.js";

const TEST_SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");

describe("normalizeSttVariants", () => {
    const variant = (variantKey: string) => ({
        variantKey,
        label: variantKey,
        config: { modelId: "soniox:stt-async-v5" },
    });

    it("rejects more than six variants", () => {
        expect(() =>
            normalizeSttVariants(
                Array.from({ length: 7 }, (_, index) =>
                    variant(`v${index + 1}`),
                ),
                undefined,
            ),
        ).toThrow("Choose between 1 and 6 STT variants");
    });

    it("rejects duplicate variant keys", () => {
        expect(() =>
            normalizeSttVariants([variant("same"), variant("same")], undefined),
        ).toThrow("key 'same' is duplicated");
    });

    it("rejects malformed runtime variant shapes with a bad request", () => {
        expect(() =>
            normalizeSttVariants(
                {} as unknown as Parameters<typeof normalizeSttVariants>[0],
                undefined,
            ),
        ).toThrow("valid STT variants list");
        expect(() =>
            normalizeSttVariants(
                [
                    {
                        ...variant("bad-config"),
                        config: [] as unknown as ISttRunConfig,
                    },
                ],
                undefined,
            ),
        ).toThrow("valid STT configuration");
    });
});

it("rejects an unsupported transport before persistence", async () => {
    const db = { query: vi.fn() } as unknown as IDb;
    await expect(
        createRunPayload(db, {
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            models: [
                {
                    modelId: "alibaba/qwen3-max",
                    transport: "openai",
                    isReference: true,
                },
            ],
            maxTokens: 100,
            fieldConfigs: [],
            createdBy: "user-1",
        }),
    ).rejects.toThrow('does not support the "openai" transport');
    expect(db.query).not.toHaveBeenCalled();
});

it("rejects a missing explicit transport key before persistence", async () => {
    const db = dbWithRows([[]]);
    await expect(
        createRunPayload(
            db,
            {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                models: [
                    {
                        modelId: "gpt-4o",
                        transport: "gateway",
                        isReference: true,
                    },
                ],
                maxTokens: 100,
                fieldConfigs: [],
                createdBy: "user-1",
            },
            testConfig({ aiGatewayApiKey: "" }),
        ),
    ).rejects.toThrow("transportAssignments: Add a Vercel AI Gateway API key");
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalledWith(
        expect.stringContaining("insert into runs"),
        expect.anything(),
    );
});

it("rejects duplicate model ids before persistence", async () => {
    const db = { query: vi.fn() } as unknown as IDb;
    await expect(
        createRunPayload(db, {
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "dataset-1",
            models: [
                { modelId: "gpt-4o", isReference: true },
                { modelId: "gpt-4o", isReference: false },
            ],
            maxTokens: 100,
            fieldConfigs: [],
            createdBy: "user-1",
        }),
    ).rejects.toThrow('Duplicate model "gpt-4o"');
    expect(db.query).not.toHaveBeenCalled();
});

it("rejects a judge config that does not belong to the caller's team", async () => {
    const db = {
        query: vi.fn(async (sql: string) => {
            if (sql.includes("from datasets")) {
                return {
                    rows: [
                        {
                            id: "dataset-1",
                            team_id: "team-1",
                            archived_at: null,
                            purpose: "golden",
                            modality: "text",
                        },
                    ],
                } as never;
            }
            if (sql.includes("from dataset_items")) {
                return { rows: [{ id: "item-1" }] } as never;
            }
            return { rows: [] } as never;
        }),
    } as unknown as IDb;

    await expect(
        createRunPayload(
            db,
            {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                models: [
                    {
                        modelId: "gpt-4o",
                        transport: "gateway",
                        isReference: true,
                    },
                ],
                maxTokens: 100,
                fieldConfigs: [],
                judgeConfigId: "judge-config-from-another-team",
                createdBy: "user-1",
            },
            testConfig({ aiGatewayApiKey: "vck-test" }),
        ),
    ).rejects.toThrow("Judge config not found.");
    expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("from judge_configs"),
        ["judge-config-from-another-team", "team-1", "project-1"],
    );
    expect(db.query).not.toHaveBeenCalledWith(
        expect.stringContaining("insert into runs"),
        expect.anything(),
    );
});

function dbWithRows(rows: unknown[][]): IDb {
    return {
        query: vi.fn(async () => ({ rows: rows.shift() ?? [] }) as never),
    };
}

function dbForRunDetail(): IDb {
    return {
        query: vi.fn(async (sql: string, values?: unknown[]) => {
            if (sql.includes("from runs\n        where id = $1")) {
                return {
                    rows: [
                        {
                            id: "run-1",
                            team_id: "team-1",
                            dataset_id: "dataset-1",
                            status: "completed",
                            config_snapshot: {},
                            created_at: new Date("2026-07-06T08:00:00.000Z"),
                        },
                    ],
                } as never;
            }

            if (
                sql.includes("from run_cells") &&
                sql.includes("group by status")
            ) {
                return {
                    rows: [{ status: "succeeded", count: 1 }],
                } as never;
            }

            if (sql.includes("from run_models")) {
                return {
                    rows: [
                        {
                            id: values?.[0] === "run-1" ? "rm-1" : "rm-other",
                            model_id: "gpt-4o",
                            prompt_version_id: "pv-1",
                            is_reference: false,
                            reasoning_config: { effort: "low" },
                        },
                    ],
                } as never;
            }

            if (
                sql.includes("from run_cells") &&
                !sql.includes("group by status")
            ) {
                return {
                    rows: [
                        {
                            id: "cell-1",
                            dataset_item_id: "item-1",
                            run_model_id: "rm-1",
                            status: "succeeded",
                            output_json: { answer: "A" },
                            latency_ms: 100,
                            cost_usd: 0.01,
                            prompt_tokens: 10,
                            completion_tokens: 5,
                            error: null,
                        },
                    ],
                } as never;
            }

            if (sql.includes("from dataset_items")) {
                return {
                    rows: [
                        {
                            id: "item-1",
                            type: "audio",
                            input_text: null,
                            storage_key: "audio/sample.wav",
                            mime_type: "audio/wav",
                        },
                    ],
                } as never;
            }

            if (sql.includes("from audio_transcripts")) {
                return {
                    rows: [
                        {
                            id: "transcript-1",
                            dataset_item_id: "item-1",
                            storage_key: "audio/sample.wav",
                            provider_id: "soniox",
                            route_id: "soniox-async-v5",
                            stt_model_id: "soniox-v5",
                            canonical_model_id: "soniox-v5",
                            language: "hi",
                            config_json: { diarization: true },
                            transcript: "namaste",
                            raw_text: "namaste",
                            normalized_text: "namaste",
                            detected_language: "hi",
                            segments_json: [
                                {
                                    speaker: "S1",
                                    text: "namaste",
                                    startMs: 0,
                                    endMs: 500,
                                },
                            ],
                            speakers_json: [{ id: "S1", label: "S1" }],
                            provider_metadata: { provider: "soniox" },
                            warnings: ["low confidence"],
                            status: "completed",
                            error: null,
                            created_at: new Date("2026-07-06T08:30:00.000Z"),
                        },
                    ],
                } as never;
            }

            if (sql.includes("from audio_transcript_variants")) {
                return {
                    rows: [
                        {
                            id: "variant-1",
                            dataset_item_id: "item-1",
                            storage_key: "audio/sample.wav",
                            source_transcript_hash:
                                "8e9177ca98ef097a826950fce977e0477e592b9f1473d1a4a9fa2a83c441d8f2",
                            variant_kind: "latin",
                            target_script: "latin",
                            target_language: "hi",
                            model_id: "gemini-2.5-flash",
                            transcript: "namaste",
                            provider_metadata: { provider: "gateway" },
                            status: "completed",
                            error: null,
                            created_at: new Date("2026-07-06T08:31:00.000Z"),
                        },
                    ],
                } as never;
            }

            if (sql.includes("from cell_scores")) {
                return {
                    rows: [
                        {
                            run_cell_id: "cell-1",
                            scorer_type: "judge",
                            score: 0.8,
                            rationale: "Good",
                            details_json: { ok: true },
                        },
                        {
                            run_cell_id: "cell-1",
                            scorer_type: "transcript_metric",
                            score: 0.9,
                            rationale: null,
                            details_json: {
                                wer: 0.1,
                                cer: 0.05,
                                diarization: { cpWer: 0.12 },
                                latencyMsTotal: 2500,
                                costUsd: 0.002,
                                costSource: "computed",
                                referenceKind: "prod_reference",
                                hardFailures: [],
                            },
                        },
                        {
                            run_cell_id: "cell-1",
                            scorer_type: "transcript_judge",
                            score: 0.77,
                            rationale: "Solid transcript",
                            details_json: { metricKind: "llm_judge" },
                        },
                    ],
                } as never;
            }

            if (sql.includes("from run_cell_annotations")) {
                return {
                    rows: [
                        {
                            run_cell_id: "cell-1",
                            verdict: "approved",
                            comment: "Looks right",
                            updated_at: new Date("2026-07-06T09:00:00.000Z"),
                            updated_by: "user-1",
                        },
                    ],
                } as never;
            }

            if (sql.includes("from run_notes")) {
                return {
                    rows: [
                        {
                            body: "Ship it",
                            updated_at: new Date("2026-07-06T10:00:00.000Z"),
                            updated_by: "user-1",
                        },
                    ],
                } as never;
            }

            if (sql.includes("inner join datasets d on d.id = r.dataset_id")) {
                return {
                    rows: [
                        {
                            dataset_name: "Food",
                            judge_config_model_id: null,
                            judge_spec: { modelId: "gpt-4.1" },
                            judge_prompt_id: "judge-prompt-1",
                            judge_prompt_name: "Accuracy judge",
                            judge_prompt_version: 2,
                        },
                    ],
                } as never;
            }

            if (sql.includes("from prompt_versions pv")) {
                return {
                    rows: [
                        {
                            prompt_id: "prompt-1",
                            name: "Extract menu",
                            version: 3,
                        },
                    ],
                } as never;
            }

            if (sql.includes("from runs r")) {
                return { rows: [] } as never;
            }

            return { rows: [] } as never;
        }),
    };
}

function dbForSttMetricsRunDetail(): IDb {
    return {
        query: vi.fn(async (sql: string) => {
            if (sql.includes("from runs\n        where id = $1")) {
                return {
                    rows: [
                        {
                            id: "run-stt",
                            team_id: "team-1",
                            dataset_id: "dataset-audio",
                            status: "completed",
                            config_snapshot: {
                                audioRunMode: "stt_metrics",
                                sttConfig: { modelId: "gpt-4o-transcribe" },
                            },
                            created_at: new Date("2026-07-10T03:00:00.000Z"),
                        },
                    ],
                } as never;
            }
            if (
                sql.includes("from run_cells") &&
                sql.includes("group by status")
            ) {
                return { rows: [{ status: "succeeded", count: 1 }] } as never;
            }
            if (sql.includes("from run_models")) {
                return {
                    rows: [
                        {
                            id: "rm-stt",
                            model_id: "stt:gpt-4o-transcribe",
                            prompt_version_id: null,
                            is_reference: true,
                            reasoning_config: null,
                        },
                    ],
                } as never;
            }
            if (
                sql.includes("from run_cells") &&
                !sql.includes("group by status")
            ) {
                return {
                    rows: [
                        {
                            id: "cell-stt",
                            dataset_item_id: "item-audio",
                            run_model_id: "rm-stt",
                            status: "succeeded",
                            output_json: { transcript: "hello" },
                            latency_ms: 1200,
                            cost_usd: null,
                            prompt_tokens: null,
                            completion_tokens: null,
                            error: null,
                        },
                    ],
                } as never;
            }
            if (sql.includes("from dataset_items")) {
                return {
                    rows: [
                        {
                            id: "item-audio",
                            type: "audio",
                            input_text: null,
                            storage_key: "audio/call.wav",
                            mime_type: "audio/wav",
                        },
                    ],
                } as never;
            }
            if (sql.includes("from cell_scores")) {
                return {
                    rows: [
                        {
                            run_cell_id: "cell-stt",
                            scorer_type: "transcript_metric",
                            score: 0.95,
                            rationale: null,
                            details_json: { wer: 0.05, cer: 0.02 },
                        },
                    ],
                } as never;
            }
            if (sql.includes("from audio_transcripts")) {
                return {
                    rows: [
                        {
                            id: "transcript-stt",
                            dataset_item_id: "item-audio",
                            storage_key: "audio/call.wav",
                            provider_id: "openai",
                            route_id: "openai-audio-transcriptions",
                            stt_model_id: "gpt-4o-transcribe",
                            canonical_model_id: "gpt-4o-transcribe",
                            language: "",
                            config_json: {},
                            transcript: "hello",
                            raw_text: "hello",
                            normalized_text: "hello",
                            detected_language: "en",
                            segments_json: [],
                            speakers_json: [],
                            provider_metadata: { provider: "openai" },
                            warnings: [],
                            status: "completed",
                            error: null,
                            created_at: new Date("2026-07-10T03:00:10.000Z"),
                        },
                    ],
                } as never;
            }
            if (sql.includes("from audio_transcript_variants")) {
                return { rows: [] } as never;
            }
            if (
                sql.includes("from run_cell_annotations") ||
                sql.includes("from run_notes") ||
                sql.includes("from runs r")
            ) {
                return { rows: [] } as never;
            }
            return { rows: [] } as never;
        }),
    };
}

function dbForSttMetricsRunDetailWithoutAudioTables(): IDb {
    const db = dbForSttMetricsRunDetail();
    const query = vi.mocked(db.query);
    query.mockImplementation(async (sql: string, values?: unknown[]) => {
        if (
            sql.includes("from audio_transcripts") ||
            sql.includes("from audio_transcript_variants")
        ) {
            throw Object.assign(new Error("relation does not exist"), {
                code: "42P01",
            });
        }
        return dbForSttMetricsRunDetail().query(sql, values);
    });
    return db;
}

function limitRunInput() {
    return {
        teamId: "team-1",
        projectId: "project-1",
        datasetId: "dataset-1",
        models: [
            {
                modelId: "gpt-4o",
                promptVersionId: null,
                isReference: false,
            },
        ],
        maxTokens: 500,
        fieldConfigs: [],
        createdBy: "user-1",
    };
}

function dbForRunLimits(input: { itemCount: number; spentUsd: number }): IDb {
    return {
        query: vi.fn(async (sql: string) => {
            if (sql.includes("from datasets"))
                return {
                    rows: [
                        {
                            id: "dataset-1",
                            team_id: "team-1",
                            archived_at: null,
                        },
                    ],
                };
            if (sql.includes("from dataset_items"))
                return {
                    rows: Array.from({ length: input.itemCount }, (_, i) => ({
                        id: `item-${i + 1}`,
                        input_text: `Question ${i + 1}`,
                        storage_key: null,
                    })),
                };
            if (sql.includes('as "spentUsd"'))
                return { rows: [{ spentUsd: input.spentUsd }] };
            if (sql.includes("insert into runs"))
                return { rows: [{ id: "run-1" }] };
            if (sql.includes("insert into run_models"))
                return { rows: [{ id: "run-model-1" }] };
            return { rows: [] };
        }),
    } as unknown as IDb;
}

function insertedRuns(db: IDb): unknown[] {
    return vi
        .mocked(db.query)
        .mock.calls.filter(([sql]) => String(sql).includes("insert into runs"));
}

function testConfig(overrides: Partial<IApiConfig> = {}): IApiConfig {
    return {
        nodeEnv: "test",
        port: 3001,
        databaseUrl: "postgres://test",
        storageAdapter: "supabase",
        supabaseUrl: "https://supabase.example.com",
        supabaseServiceRoleKey: "service-role",
        supabaseStorageBucket: "mosaic-images",
        clerkSecretKey: "clerk-secret",
        mosaicTenancyMode: "single-org",
        mosaicAllowedEmailDomain: "example.com",
        corsOrigins: [],
        mosaicLlmProvider: "openai",
        openaiApiKey: "test-openai",
        sttCapabilityProbes: {},
        profilingEnabled: false,
        featureFlags: resolveApiFeatureFlags({}),
        ...overrides,
    };
}

describe("runProgressPayload", () => {
    it("returns progress for a team-owned run", async () => {
        const db = dbWithRows([
            [{ status: "running" }],
            [
                { status: "succeeded", count: 2 },
                { status: "cached", count: 1 },
                { status: "failed", count: 1 },
                { status: "pending", count: 3 },
            ],
        ]);

        await expect(
            runProgressPayload(db, "team-1", "project-1", "run-1"),
        ).resolves.toEqual({
            status: "running",
            total: 7,
            done: 3,
            failed: 1,
            pending: 3,
        });
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining(
                "from runs where id = $1 and team_id = $2 and project_id = $3",
            ),
            ["run-1", "team-1", "project-1"],
        );
    });

    it("does not leak runs outside the requesting team", async () => {
        const db = dbWithRows([[]]);

        await expect(
            runProgressPayload(db, "team-1", "project-1", "run-1"),
        ).rejects.toThrow(ApiNotFoundError);
    });
});

describe("createRunPayload", () => {
    it("creates a run, model rows, and pending cells", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                },
            ],
            [
                { id: "item-1", input_text: "Question 1", storage_key: null },
                { id: "item-2", input_text: null, storage_key: "images/a.png" },
            ],
            [{ id: "run-1" }],
            [{ id: "run-model-1" }],
            [],
            [],
        ]);

        await expect(
            createRunPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                models: [
                    {
                        modelId: "gpt-4o",
                        promptVersionId: "pv-1",
                        schemaVersionId: "schema-1",
                        promptSnapshot: {
                            promptId: "prompt-1",
                            promptName: "Extract",
                            promptVersionId: "pv-1",
                            promptVersion: 1,
                            schemaVersionId: "schema-1",
                            schemaVersion: 1,
                            schemaHash: "hash-1",
                            fitTags: [],
                        },
                        isReference: false,
                    },
                ],
                maxTokens: 500,
                fieldConfigs: [],
                createdBy: "user-1",
            }),
        ).resolves.toEqual({
            runId: "run-1",
            enqueueStatus: "pending_enqueue",
        });
        expect(db.query).toHaveBeenNthCalledWith(
            3,
            expect.stringContaining("insert into runs"),
            expect.arrayContaining(["team-1", "dataset-1"]),
        );
        expect(db.query).toHaveBeenNthCalledWith(
            4,
            expect.stringContaining("insert into run_models"),
            expect.arrayContaining(["run-1", "gpt-4o", "pv-1", "schema-1"]),
        );
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("insert into run_cells"),
            expect.arrayContaining(["run-1", "item-2", "run-model-1"]),
        );
        expect(db.query).toHaveBeenLastCalledWith(
            expect.stringContaining("insert into run_enqueue_outbox"),
            ["run-1"],
        );
    });

    it("rejects runs over the configured cell limit before inserting rows", async () => {
        const db = dbForRunLimits({ itemCount: 3, spentUsd: 0 });

        await expect(
            createRunPayload(
                db,
                limitRunInput(),
                testConfig({ maxRunCells: 2 }),
            ),
        ).rejects.toThrow(
            "This run would create 3 cells (3 items x 1 models); the limit is 2.",
        );
        expect(insertedRuns(db)).toHaveLength(0);
    });

    it("refuses to start runs once the team daily spend cap is reached", async () => {
        const db = dbForRunLimits({ itemCount: 1, spentUsd: 12.5 });

        await expect(
            createRunPayload(
                db,
                limitRunInput(),
                testConfig({ teamDailySpendCapUsd: 10 }),
            ),
        ).rejects.toThrow("reaching its $10.00 daily cap");
        expect(insertedRuns(db)).toHaveLength(0);
    });

    it("creates runs while team spend is under the cap", async () => {
        const db = dbForRunLimits({ itemCount: 1, spentUsd: 2 });

        await expect(
            createRunPayload(
                db,
                limitRunInput(),
                testConfig({ teamDailySpendCapUsd: 10 }),
            ),
        ).resolves.toEqual({
            runId: "run-1",
            enqueueStatus: "pending_enqueue",
        });
        expect(insertedRuns(db)).toHaveLength(1);
    });

    it("rejects archived datasets before inserting rows", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: new Date("2026-07-06T08:00:00.000Z"),
                },
            ],
        ]);

        await expect(
            createRunPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                models: [],
                maxTokens: 500,
                fieldConfigs: [],
                createdBy: "user-1",
            }),
        ).rejects.toThrow("archived");
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("requires an OpenAI key for direct audio run creation", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    modality: "audio",
                },
            ],
        ]);

        await expect(
            createRunPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    models: [
                        {
                            modelId: "gpt-4o",
                            promptVersionId: "pv-1",
                            isReference: false,
                        },
                    ],
                    maxTokens: 500,
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: { modelId: "gpt-4o-mini-transcribe" },
                },
                testConfig({ openaiApiKey: "" }),
            ),
        ).rejects.toThrow("Add OPENAI_API_KEY to run audio transcription.");
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    it("rejects malformed sttConfig without modelId with 400, not 500", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    modality: "audio",
                },
            ],
        ]);

        await expect(
            createRunPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    models: [
                        {
                            modelId: "gpt-4o",
                            promptVersionId: "pv-1",
                            isReference: false,
                        },
                    ],
                    maxTokens: 500,
                    fieldConfigs: [],
                    createdBy: "user-1",
                    // Runtime-malformed payload: modelId missing
                    sttConfig: {} as { modelId: string },
                },
                testConfig({ openaiApiKey: "sk-test" }),
            ),
        ).rejects.toThrow("Choose an STT model for audio datasets.");
    });

    it("enriches STT snapshot identity for direct audio run creation", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    modality: "audio",
                },
            ],
            [{ id: "item-1", input_text: null, storage_key: "audio/a.wav" }],
            [{ id: "run-1" }],
            [{ id: "run-model-1" }],
            [],
        ]);

        await expect(
            createRunPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    models: [
                        {
                            modelId: "gpt-4o",
                            promptVersionId: "pv-1",
                            isReference: false,
                        },
                    ],
                    maxTokens: 500,
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: {
                        modelId: "gpt-4o-mini-transcribe",
                        language: "hi",
                    },
                },
                testConfig({ openaiApiKey: "sk-test" }),
            ),
        ).resolves.toEqual({
            runId: "run-1",
            enqueueStatus: "pending_enqueue",
        });

        const insertRunArgs = vi.mocked(db.query).mock
            .calls[2]?.[1] as unknown[];
        expect(insertRunArgs[6]).toMatchObject({
            sttConfig: {
                modelId: "gpt-4o-mini-transcribe",
                providerId: "openai",
                routeId: "openai-audio-transcriptions",
                canonicalModelId: "gpt-4o-mini-transcribe",
                language: "hi",
            },
        });
    });
});

describe("createRunFromSelectionPayload", () => {
    it("allows a valid explicit Gateway assignment in OpenAI mode", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "text",
                },
            ],
            [
                {
                    id: "pv-1",
                    prompt_id: "prompt-1",
                    version: 1,
                    schema_version_id: "schema-1",
                    status: "legacy",
                    reasoning_config: null,
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["anthropic/claude-sonnet-4.5"],
                    transportAssignments: [
                        {
                            modelId: "anthropic/claude-sonnet-4.5",
                            transport: "gateway",
                        },
                    ],
                    promptAssignments: [],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                },
                testConfig({ aiGatewayApiKey: "vck-test" }),
            ),
        ).rejects.toThrow(
            "Choose a runnable prompt version for anthropic/claude-sonnet-4.5.",
        );
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    it("allows a provider-listed Gateway model that is not in the static catalog", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "text",
                },
            ],
            [
                {
                    id: "pv-1",
                    prompt_id: "prompt-1",
                    version: 1,
                    schema_version_id: "schema-1",
                    status: "legacy",
                    reasoning_config: null,
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["zai/glm-5.1"],
                    transportAssignments: [
                        { modelId: "zai/glm-5.1", transport: "gateway" },
                    ],
                    promptAssignments: [],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                },
                testConfig({ aiGatewayApiKey: "vck-test" }),
            ),
        ).rejects.toThrow("Choose a runnable prompt version for zai/glm-5.1.");
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    it("allows a provider-listed Gateway model with an unqualified canonical id", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "text",
                },
            ],
            [
                {
                    id: "pv-1",
                    prompt_id: "prompt-1",
                    version: 1,
                    schema_version_id: "schema-1",
                    status: "legacy",
                    reasoning_config: null,
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["gpt-5.6-luna"],
                    transportAssignments: [
                        { modelId: "gpt-5.6-luna", transport: "gateway" },
                    ],
                    promptAssignments: [],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                },
                testConfig({ aiGatewayApiKey: "vck-test" }),
            ),
        ).rejects.toThrow("Choose a runnable prompt version for gpt-5.6-luna.");
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    it("rejects Gateway-only models when the API is in OpenAI mode", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "text",
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["anthropic/claude-sonnet-4.5"],
                    promptAssignments: [
                        {
                            modelId: "anthropic/claude-sonnet-4.5",
                            promptVersionId: "pv-1",
                        },
                    ],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                },
                testConfig(),
            ),
        ).rejects.toThrow(
            "Claude Sonnet 4.5 is not available for the configured provider mode.",
        );
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("rejects known text-only Gateway models for image datasets before prompt reads", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "image",
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "google/gemini-2.5-pro",
                    modelIds: ["xai/grok-4"],
                    promptAssignments: [
                        { modelId: "xai/grok-4", promptVersionId: "pv-1" },
                    ],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                },
                testConfig({
                    mosaicLlmProvider: "gateway",
                    aiGatewayApiKey: "vck-test",
                }),
            ),
        ).rejects.toThrow(
            "xai/grok-4 cannot run on image datasets because vision support is not available.",
        );
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("requires an STT model for audio datasets before prompt reads", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["gpt-4o"],
                    promptAssignments: [
                        { modelId: "gpt-4o", promptVersionId: "pv-1" },
                    ],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                },
                testConfig(),
            ),
        ).rejects.toThrow("Choose an STT model for audio datasets.");
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("requires an OpenAI key for selected audio transcription models", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["gpt-4o"],
                    promptAssignments: [
                        { modelId: "gpt-4o", promptVersionId: "pv-1" },
                    ],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: { modelId: "gpt-4o-mini-transcribe" },
                },
                testConfig({ openaiApiKey: "" }),
            ),
        ).rejects.toThrow("Add OPENAI_API_KEY to run audio transcription.");
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    it("rejects unsupported STT config fields before prompt reads", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["gpt-4o"],
                    promptAssignments: [
                        { modelId: "gpt-4o", promptVersionId: "pv-1" },
                    ],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: {
                        modelId: "gpt-4o-mini-transcribe",
                        config: { diarization: true },
                    },
                },
                testConfig(),
            ),
        ).rejects.toThrow(
            "Unsupported STT config for GPT-4o mini Transcribe: diarization.",
        );
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("creates STT metrics runs without prompt versions or downstream models", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    modality: "audio",
                },
            ],
            [
                {
                    id: "item-1",
                    input_text: null,
                    storage_key: "audio/call.wav",
                },
            ],
            [{ id: "run-1" }],
            [{ id: "run-model-1" }],
            [],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: [],
                    promptAssignments: [],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: { modelId: "gpt-4o-mini-transcribe" },
                    audioRunMode: "stt_metrics",
                },
                testConfig(),
            ),
        ).resolves.toEqual({
            runId: "run-1",
            enqueueStatus: "pending_enqueue",
        });

        expect(db.query).toHaveBeenCalledTimes(7);
        expect(vi.mocked(db.query).mock.calls[3]?.[1]).toEqual([
            "team-1",
            "project-1",
            "dataset-1",
            null,
            null,
            null,
            expect.objectContaining({
                audioRunMode: "stt_metrics",
                fieldConfigs: [],
                models: [
                    expect.objectContaining({
                        modelId: "stt:gpt-4o-mini-transcribe",
                        promptVersionId: null,
                    }),
                ],
            }),
            "user-1",
        ]);
        expect(vi.mocked(db.query).mock.calls[4]?.[1]).toEqual([
            "run-1",
            "stt:gpt-4o-mini-transcribe",
            null,
            null,
            null,
            null,
            true,
        ]);
    });

    it("fans explicit STT variants into distinct models, cells, and snapshot configs", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    modality: "audio",
                },
            ],
            [{ id: "item-1", input_text: null, storage_key: "audio/call.wav" }],
            [{ id: "run-1" }],
            [{ id: "run-model-1" }],
            [{ id: "run-model-2" }],
            [],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: [],
                    promptAssignments: [],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: { modelId: "gpt-4o-mini-transcribe" },
                    sttVariants: [
                        {
                            variantKey: "diarized",
                            label: "Diarization on",
                            config: {
                                modelId: "soniox:stt-async-v5",
                                config: { diarization: true },
                            },
                        },
                        {
                            variantKey: "plain",
                            label: "Diarization off",
                            config: {
                                modelId: "soniox:stt-async-v5",
                                config: { diarization: false },
                            },
                        },
                    ],
                    sttEvaluation: {
                        evaluator: {
                            enabled: true,
                            modelId: "gpt-4o-mini",
                            rubricPrompt: "Flag leaked OTP values.",
                        },
                    },
                    audioRunMode: "stt_metrics",
                },
                testConfig({ sonioxApiKey: "soniox-test" }),
            ),
        ).resolves.toEqual({
            runId: "run-1",
            enqueueStatus: "pending_enqueue",
        });

        const snapshot = vi.mocked(db.query).mock.calls[3]?.[1]?.[6] as {
            sttConfig?: unknown;
            sttVariants: Record<string, { config: ISttRunConfig }>;
        };
        expect(snapshot.sttConfig).toBeUndefined();
        expect(Object.keys(snapshot.sttVariants)).toEqual([
            "diarized",
            "plain",
        ]);
        expect(
            snapshot.sttVariants.diarized?.config.evaluator?.rubricPrompt,
        ).toBe("Flag leaked OTP values.");
        expect(snapshot.sttVariants.plain?.config.evaluator?.rubricPrompt).toBe(
            "Flag leaked OTP values.",
        );
        expect(vi.mocked(db.query).mock.calls[4]?.[1]?.[1]).toBe(
            "stt:soniox:stt-async-v5#diarized",
        );
        expect(vi.mocked(db.query).mock.calls[5]?.[1]?.[1]).toBe(
            "stt:soniox:stt-async-v5#plain",
        );
        expect(vi.mocked(db.query).mock.calls[4]?.[1]?.[6]).toBe(true);
        expect(vi.mocked(db.query).mock.calls[5]?.[1]?.[6]).toBe(false);
        expect(vi.mocked(db.query).mock.calls[6]?.[1]).toEqual([
            "run-1",
            "item-1",
            "run-model-1",
            expect.any(String),
            "run-1",
            "item-1",
            "run-model-2",
            expect.any(String),
        ]);
    });

    it("rejects malformed explicit variants with a variant-labelled error", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: [],
                    promptAssignments: [],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttVariants: [
                        {
                            variantKey: "bad_key",
                            label: "Bad variant",
                            config: { modelId: "soniox:stt-async-v5" },
                        },
                    ],
                    audioRunMode: "stt_metrics",
                },
                testConfig({ sonioxApiKey: "soniox-test" }),
            ),
        ).rejects.toThrow("Variant 'Bad variant': key must contain only");
    });

    it("creates Soniox STT runs with a stored team key", async () => {
        const encrypted = encryptSecret(
            "stored-soniox-key",
            { teamId: "team-1", provider: "soniox" },
            TEST_SECRETS_KEY,
        );
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
            [
                {
                    provider: "soniox",
                    ...encrypted,
                    baseUrl: null,
                },
            ],
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    modality: "audio",
                },
            ],
            [{ id: "item-1", input_text: null, storage_key: "audio/call.wav" }],
            [{ id: "run-1" }],
            [{ id: "run-model-1" }],
            [],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: [],
                    promptAssignments: [],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: { modelId: "soniox:stt-async-v5" },
                    audioRunMode: "stt_metrics",
                },
                testConfig({
                    sonioxApiKey: "",
                    mosaicSecretsEncKey: TEST_SECRETS_KEY,
                }),
            ),
        ).resolves.toEqual({
            runId: "run-1",
            enqueueStatus: "pending_enqueue",
        });
    });

    it("rejects invalid STT config value types before prompt reads", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["gpt-4o"],
                    promptAssignments: [
                        { modelId: "gpt-4o", promptVersionId: "pv-1" },
                    ],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: {
                        modelId: "soniox:stt-async-v5",
                        config: { context: 42, diarization: "true" },
                    },
                },
                testConfig({ sonioxApiKey: "soniox-test" }),
            ),
        ).rejects.toThrow(
            "Invalid STT config for Soniox STT async v5: Context must be text. Diarization must be true or false.",
        );
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("rejects configured provider routes whose STT capability is unverified", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["gpt-4o"],
                    promptAssignments: [
                        { modelId: "gpt-4o", promptVersionId: "pv-1" },
                    ],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: { modelId: "openrouter:whisper-large-v3-turbo" },
                },
                testConfig({ openrouterApiKey: "openrouter-test" }),
            ),
        ).rejects.toThrow(
            "OpenRouter STT route needs capability verification before it can run.",
        );
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("rejects audio language overrides when the selected STT route does not declare language support", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["gpt-4o"],
                    promptAssignments: [
                        { modelId: "gpt-4o", promptVersionId: "pv-1" },
                    ],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: {
                        modelId: "vercel:openai/whisper-1",
                        language: "hi",
                    },
                },
                testConfig({
                    aiGatewayApiKey: "vck-test",
                    sttCapabilityProbes: {
                        "vercel:openai/whisper-1": { status: "available" },
                    },
                }),
            ),
        ).rejects.toThrow(
            "Whisper does not support an audio language override.",
        );
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("rejects Latin transcript variants without enabled transliteration", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["gpt-4o"],
                    promptAssignments: [
                        { modelId: "gpt-4o", promptVersionId: "pv-1" },
                    ],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: {
                        modelId: "gpt-4o-mini-transcribe",
                        transcriptVariant: "latin",
                    },
                },
                testConfig(),
            ),
        ).rejects.toThrow(
            "Latin transcript variant requires transliteration to be enabled.",
        );
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("accepts Latin transcript variants through STT validation", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["gpt-4o"],
                    promptAssignments: [
                        { modelId: "gpt-4o", promptVersionId: "pv-1" },
                    ],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: {
                        modelId: "gpt-4o-mini-transcribe",
                        transcriptVariant: "latin",
                        transliteration: {
                            enabled: true,
                            targetScript: "latin",
                            modelId: "gpt-4o-mini",
                        },
                    },
                },
                testConfig(),
            ),
        ).rejects.toThrow("Choose a runnable prompt version for gpt-4o.");
    });

    it("rejects out-of-range transliteration temperature before prompt reads", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["gpt-4o"],
                    promptAssignments: [
                        { modelId: "gpt-4o", promptVersionId: "pv-1" },
                    ],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: {
                        modelId: "gpt-4o-mini-transcribe",
                        transcriptVariant: "latin",
                        transliteration: {
                            enabled: true,
                            targetScript: "latin",
                            modelId: "gpt-4o-mini",
                            temperature: 3,
                        },
                    },
                },
                testConfig(),
            ),
        ).rejects.toThrow(
            "Transliteration temperature must be a number between 0 and 2.",
        );
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("rejects enabled transcript evaluators without a rubric", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["gpt-4o"],
                    promptAssignments: [
                        { modelId: "gpt-4o", promptVersionId: "pv-1" },
                    ],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: {
                        modelId: "gpt-4o-mini-transcribe",
                        evaluator: {
                            enabled: true,
                            modelId: "gpt-4o-mini",
                            rubricPrompt: "",
                        },
                    },
                },
                testConfig(),
            ),
        ).rejects.toThrow("Add a transcript judge rubric.");
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("rejects unsupported transcript judge reasoning effort before prompt reads", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "audio",
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(
                db,
                {
                    teamId: "team-1",
                    projectId: "project-1",
                    datasetId: "dataset-1",
                    promptVersionId: "pv-1",
                    maxTokens: 500,
                    judgeModelId: "gpt-5.4-mini",
                    modelIds: ["gpt-4o"],
                    promptAssignments: [
                        { modelId: "gpt-4o", promptVersionId: "pv-1" },
                    ],
                    reasoningConfigs: [],
                    fieldConfigs: [],
                    createdBy: "user-1",
                    sttConfig: {
                        modelId: "gpt-4o-mini-transcribe",
                        evaluator: {
                            enabled: true,
                            modelId: "gpt-4o-mini",
                            rubricPrompt: "Score transcript quality.",
                            reasoningEffort: "extreme" as never,
                        },
                    },
                },
                testConfig(),
            ),
        ).rejects.toThrow(
            "Transcript judge reasoning effort is not supported.",
        );
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("rejects non-runnable selected prompt versions before creating rows", async () => {
        const db = dbWithRows([
            [
                {
                    id: "dataset-1",
                    team_id: "team-1",
                    archived_at: null,
                    purpose: "golden",
                    modality: "text",
                },
            ],
            [
                {
                    id: "pv-1",
                    prompt_id: "prompt-1",
                    version: 1,
                    schema_version_id: "schema-1",
                    status: "legacy",
                    reasoning_config: null,
                },
            ],
        ]);

        await expect(
            createRunFromSelectionPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                promptVersionId: "pv-1",
                maxTokens: 500,
                judgeModelId: "gpt-5.4-mini",
                modelIds: ["gpt-4o"],
                promptAssignments: [
                    { modelId: "gpt-4o", promptVersionId: "pv-1" },
                ],
                reasoningConfigs: [],
                fieldConfigs: [],
                createdBy: "user-1",
            }),
        ).rejects.toThrow("Choose a runnable prompt version for gpt-4o.");
        expect(db.query).toHaveBeenCalledTimes(2);
    });
});

describe("generateJudgeForRunPayload", () => {
    it("rejects prompt versions that are not runnable before provider work", async () => {
        const db = dbWithRows([
            [
                {
                    id: "pv-1",
                    prompt_id: "prompt-1",
                    content: "Draft prompt",
                    schema_version_id: null,
                    status: "legacy",
                },
            ],
        ]);

        await expect(
            generateJudgeForRunPayload(db, testConfig(), {
                teamId: "team-1",
                projectId: "project-1",
                promptVersionId: "pv-1",
                datasetId: "dataset-1",
            }),
        ).rejects.toThrow("Select a runnable prompt version first.");
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("generates the rubric through the statically imported eval provider", async () => {
        const { getEvalProvider } = await import("@mosaic/llm-core");
        const db = dbWithRows([
            [
                {
                    id: "pv-1",
                    prompt_id: "prompt-1",
                    content: "Classify the meal.",
                    schema_version_id: "schema-1",
                    status: "runnable",
                },
            ],
            [{ id: "prompt-1", team_id: "team-1", project_id: "project-1" }],
            [{ json_schema: { type: "object" } }],
            [
                {
                    team_id: "team-1",
                    project_id: "project-1",
                    modality: "text",
                    purpose: "evaluation",
                },
            ],
        ]);

        const result = await generateJudgeForRunPayload(db, testConfig(), {
            teamId: "team-1",
            projectId: "project-1",
            promptVersionId: "pv-1",
            datasetId: "dataset-1",
        });

        expect(result).toMatchObject({ rubricPrompt: "Score accuracy." });
        expect(vi.mocked(getEvalProvider)).toHaveBeenCalled();
    });
});

describe("listRunsPayload", () => {
    it("keeps project A and project B run queries isolated", async () => {
        const projectADb = dbWithRows([[]]);
        const projectBDb = dbWithRows([[]]);

        await listRunsPayload(projectADb, "team-1", "project-a");
        await listRunsPayload(projectBDb, "team-1", "project-b");

        expect(projectADb.query).toHaveBeenCalledWith(expect.any(String), [
            "team-1",
            "project-a",
        ]);
        expect(projectBDb.query).toHaveBeenCalledWith(expect.any(String), [
            "team-1",
            "project-b",
        ]);
    });

    it("returns enriched run rows for the runs page", async () => {
        const db = dbWithRows([
            [
                {
                    id: "run-1",
                    status: "partial",
                    created_at: new Date("2026-07-06T08:00:00.000Z"),
                    dataset_id: "dataset-1",
                    dataset_name: "Food",
                    models: ["gpt-4o", "gpt-4.1"],
                    total: "4",
                    done: "3",
                    failed: "1",
                    pending: "0",
                },
            ],
        ]);

        await expect(
            listRunsPayload(db, "team-1", "project-1"),
        ).resolves.toEqual([
            {
                id: "run-1",
                status: "partial",
                createdAt: "2026-07-06T08:00:00.000Z",
                datasetId: "dataset-1",
                datasetName: "Food",
                models: ["gpt-4o", "gpt-4.1"],
                progress: {
                    total: 4,
                    done: 3,
                    failed: 1,
                    pending: 0,
                },
            },
        ]);
        expect(db.query).toHaveBeenCalledWith(expect.any(String), [
            "team-1",
            "project-1",
        ]);
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("returns the note title and the top model with its score", async () => {
        const db = dbWithRows([
            [
                {
                    id: "run-1",
                    status: "completed",
                    created_at: new Date("2026-07-06T08:00:00.000Z"),
                    dataset_id: "dataset-1",
                    dataset_name: "Food",
                    models: ["gpt-4o", "gpt-4.1"],
                    total: "4",
                    done: "4",
                    failed: "0",
                    pending: "0",
                    note_title: "Baseline before prompt change",
                    model_scores: [
                        { model_id: "gpt-4o", judge: "0.71", transcript: null },
                        { model_id: "gpt-4.1", judge: 0.84, transcript: null },
                    ],
                },
                {
                    id: "run-2",
                    status: "running",
                    created_at: new Date("2026-07-06T09:00:00.000Z"),
                    dataset_id: "dataset-1",
                    dataset_name: "Food",
                    models: ["gpt-4o"],
                    total: "4",
                    done: "1",
                    failed: "0",
                    pending: "3",
                    note_title: null,
                    model_scores: [],
                },
            ],
        ]);

        const [scored, unscored] = await listRunsPayload(
            db,
            "team-1",
            "project-1",
        );

        expect(scored).toMatchObject({
            noteTitle: "Baseline before prompt change",
            best: {
                modelId: "gpt-4.1",
                score: 0.84,
                metric: "judge",
                scored: 2,
                total: 2,
                tiedCount: 1,
            },
        });
        expect(unscored).not.toHaveProperty("noteTitle");
        expect(unscored).not.toHaveProperty("best");
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("reports a partial winner as scored of total instead of a plain best", async () => {
        const db = dbWithRows([
            [
                {
                    id: "run-partial",
                    status: "running",
                    created_at: new Date("2026-07-06T08:00:00.000Z"),
                    dataset_id: "dataset-1",
                    dataset_name: "Food",
                    models: ["a", "b", "c"],
                    total: "6",
                    done: "2",
                    failed: "0",
                    pending: "4",
                    note_title: null,
                    // Unscored models still arrive, with null scores.
                    model_scores: [
                        { model_id: "a", judge: 0.6, transcript: null },
                        { model_id: "b", judge: null, transcript: null },
                        { model_id: "c", judge: null, transcript: null },
                    ],
                },
            ],
        ]);

        const [row] = await listRunsPayload(db, "team-1", "project-1");

        expect(row?.best).toMatchObject({
            modelId: "a",
            scored: 1,
            total: 3,
            tiedCount: 1,
        });
    });

    it("scopes the per-run score subquery to the run's cells and orders models deterministically", async () => {
        const db = dbWithRows([[]]);

        await listRunsPayload(db, "team-1", "project-1");

        const sql = String(vi.mocked(db.query).mock.calls[0]?.[0]);
        // run_cells is only indexed by run_id; without this the subquery
        // scans every cell of every run's models.
        expect(sql).toMatch(
            /left join run_cells rc2\s+on rc2\.run_model_id = rm2\.id and rc2\.run_id = r\.id/,
        );
        expect(sql).toMatch(/\) order by ms\.model_id\)/);
        expect(sql).toContain("where rn.run_id = r.id");
    });

    it("ranks STT runs by transcript score and reports ties as displayed", async () => {
        const db = dbWithRows([
            [
                {
                    id: "run-stt",
                    status: "completed",
                    created_at: new Date("2026-07-06T08:00:00.000Z"),
                    dataset_id: "dataset-1",
                    dataset_name: "Calls",
                    models: ["a", "b", "c"],
                    total: "3",
                    done: "3",
                    failed: "0",
                    pending: "0",
                    note_title: null,
                    model_scores: [
                        { model_id: "a", judge: null, transcript: 0.9 },
                        { model_id: "b", judge: null, transcript: 0.904 },
                        { model_id: "c", judge: null, transcript: 0.5 },
                    ],
                },
            ],
        ]);

        const [row] = await listRunsPayload(db, "team-1", "project-1");

        expect(row?.best).toMatchObject({
            modelId: "b",
            metric: "transcript",
            scored: 3,
            tiedCount: 2,
        });
    });

    it("issues exactly one aggregated query regardless of how many runs are returned (N+1 guard)", async () => {
        const runCount = 25;
        const rows = Array.from({ length: runCount }, (_, i) => ({
            id: `run-${i}`,
            status: "completed",
            created_at: new Date("2026-07-06T08:00:00.000Z"),
            dataset_id: "dataset-1",
            dataset_name: "Food",
            models: ["gpt-4o"],
            total: "2",
            done: "2",
            failed: "0",
            pending: "0",
        }));
        const db = dbWithRows([rows]);

        const result = await listRunsPayload(db, "team-1", "project-1");

        // listRunsPayload uses one join+group-by SQL query per call, not one
        // per row. A regression that fetches models/progress per run would
        // make this scale with runCount instead of staying at 1.
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(result).toHaveLength(runCount);
    });
});

describe("runDetailPayload", () => {
    it("returns the run detail page bundle for a team-owned run", async () => {
        const payload = await runDetailPayload(
            dbForRunDetail(),
            "team-1",
            "project-1",
            "run-1",
        );

        expect(payload.run).toMatchObject({
            id: "run-1",
            teamId: "team-1",
            datasetId: "dataset-1",
            status: "completed",
            createdAt: "2026-07-06T08:00:00.000Z",
        });
        expect(payload.progress).toEqual({
            total: 1,
            done: 1,
            failed: 0,
            pending: 0,
        });
        expect(payload.context).toEqual({
            datasetName: "Food",
            prompts: [
                { promptId: "prompt-1", name: "Extract menu", version: 3 },
            ],
            judge: {
                modelId: "gpt-4.1",
                promptId: "judge-prompt-1",
                promptName: "Accuracy judge",
                promptVersion: 2,
            },
        });
        expect(payload.models).toEqual([
            {
                id: "rm-1",
                modelId: "gpt-4o",
                promptVersionId: "pv-1",
                isReference: false,
            },
        ]);
        expect(payload.cells[0]).toMatchObject({
            id: "cell-1",
            datasetItemId: "item-1",
            annotation: {
                verdict: "approved",
                comment: "Looks right",
                updatedAt: "2026-07-06T09:00:00.000Z",
            },
        });
        expect(payload.audioTranscripts[0]).toMatchObject({
            id: "transcript-1",
            datasetItemId: "item-1",
            providerId: "soniox",
            canonicalModelId: "soniox-v5",
            detectedLanguage: "hi",
            warnings: ["low confidence"],
            segments: [{ speaker: "S1", text: "namaste" }],
            variants: [
                {
                    id: "variant-1",
                    variantKind: "latin",
                    targetScript: "latin",
                    modelId: "gemini-2.5-flash",
                },
            ],
        });
        expect(payload.leaderboard[0]).toMatchObject({
            modelId: "gpt-4o",
            avgJudgeScore: 0.8,
            avgTranscriptScore: 0.9,
            avgTranscriptJudgeScore: 0.77,
            avgWer: 0.1,
            avgCer: 0.05,
            avgCpWer: 0.12,
            avgSttLatencyMs: 2500,
            p95SttLatencyMs: 2500,
            totalSttCostUsd: 0.002,
            p95LatencyMs: 100,
            totalCostUsd: 0.01,
            projectedCostPer1k: 10,
        });
        expect(payload.scoresByCell["cell-1"]).toContainEqual(
            expect.objectContaining({
                scorerType: "transcript_metric",
                score: 0.9,
                detailsJson: expect.objectContaining({
                    referenceKind: "prod_reference",
                }),
            }),
        );
        expect(payload.note).toMatchObject({
            body: "Ship it",
            updatedAt: "2026-07-06T10:00:00.000Z",
        });
    });

    it("fetches the dataset and judge alongside the other detail queries", async () => {
        const inner = dbForRunDetail();
        let releaseModels!: () => void;
        const modelsGate = new Promise<void>((resolve) => {
            releaseModels = resolve;
        });
        const db: IDb = {
            query: vi.fn(async (sql: string, values?: unknown[]) => {
                if (sql.includes("from run_models")) await modelsGate;
                return inner.query(sql, values);
            }) as never,
        };

        const pending = runDetailPayload(db, "team-1", "project-1", "run-1");

        // Held: the matrix (run_models) query has not resolved, yet the
        // dataset/judge query has already been issued.
        await vi.waitFor(() => {
            const sqls = vi
                .mocked(db.query)
                .mock.calls.map(([sql]) => String(sql));
            expect(sqls.some((sql) => sql.includes("judge_configs"))).toBe(
                true,
            );
        });
        releaseModels();
        const payload = await pending;

        // The prompt-version lookup still waits for the models.
        expect(payload.context?.prompts).toEqual([
            { promptId: "prompt-1", name: "Extract menu", version: 3 },
        ]);
        expect(payload.context?.datasetName).toBe("Food");
    });

    it("returns STT metrics run details when the STT config has no provider config", async () => {
        const payload = await runDetailPayload(
            dbForSttMetricsRunDetail(),
            "team-1",
            "project-1",
            "run-stt",
        );

        expect(payload.models).toEqual([
            {
                id: "rm-stt",
                modelId: "stt:gpt-4o-transcribe",
                promptVersionId: null,
                isReference: true,
            },
        ]);
        expect(payload.leaderboard[0]).toMatchObject({
            modelId: "stt:gpt-4o-transcribe",
            avgTranscriptScore: 0.95,
            avgWer: 0.05,
            avgCer: 0.02,
        });
        expect(payload.audioTranscripts).toHaveLength(1);
        expect(payload.audioTranscripts[0]).toMatchObject({
            id: "transcript-stt",
            sttModelId: "gpt-4o-transcribe",
            transcript: "hello",
        });
    });

    it("fails run detail when the audio artifact schema is missing", async () => {
        await expect(
            runDetailPayload(
                dbForSttMetricsRunDetailWithoutAudioTables(),
                "team-1",
                "project-1",
                "run-stt",
            ),
        ).rejects.toThrow("relation does not exist");
    });
});

describe("run review mutations", () => {
    it("upserts a run note after checking team ownership", async () => {
        const db = dbWithRows([
            [
                {
                    id: "run-1",
                    team_id: "team-1",
                    dataset_id: "dataset-1",
                    status: "completed",
                    config_snapshot: {},
                    created_at: new Date("2026-07-06T08:00:00.000Z"),
                },
            ],
            [],
        ]);

        await expect(
            saveRunNotePayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                runId: "run-1",
                body: "Looks good",
                updatedBy: "user-1",
            }),
        ).resolves.toBeUndefined();
        expect(db.query).toHaveBeenLastCalledWith(expect.any(String), [
            "run-1",
            "Looks good",
            "user-1",
        ]);
    });

    it("upserts a cell annotation after checking team ownership", async () => {
        const db = dbWithRows([
            [{ run_id: "run-1", team_id: "team-1", project_id: "project-1" }],
            [],
        ]);

        await expect(
            saveCellAnnotationPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                runCellId: "cell-1",
                verdict: "approved",
                comment: "Correct",
                updatedBy: "user-1",
            }),
        ).resolves.toEqual({ runId: "run-1" });
        expect(db.query).toHaveBeenLastCalledWith(expect.any(String), [
            "cell-1",
            "approved",
            "Correct",
            "user-1",
        ]);
    });

    it("does not annotate a cell outside the requesting team", async () => {
        const db = dbWithRows([
            [{ run_id: "run-1", team_id: "team-1", project_id: "project-2" }],
        ]);

        await expect(
            saveCellAnnotationPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                runCellId: "cell-1",
                verdict: "approved",
                comment: "",
                updatedBy: "user-1",
            }),
        ).rejects.toThrow(ApiNotFoundError);
    });
});

describe("deleteRunPayload", () => {
    it("deletes an owned run and dependent rows", async () => {
        const db = dbWithRows([
            [
                {
                    id: "run-1",
                    team_id: "team-1",
                    dataset_id: "dataset-1",
                    status: "completed",
                    config_snapshot: {},
                    created_at: new Date("2026-07-06T08:00:00.000Z"),
                },
            ],
            [{ id: "cell-1" }],
            [],
            [],
            [],
            [],
            [],
            [],
        ]);

        await expect(
            deleteRunPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                runId: "run-1",
            }),
        ).resolves.toBeUndefined();
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("cell_scores"),
            [["cell-1"]],
        );
        expect(db.query).toHaveBeenLastCalledWith(
            "delete from runs where id = $1 and team_id = $2 and project_id = $3",
            ["run-1", "team-1", "project-1"],
        );
    });

    it("does not delete a run outside the requesting team", async () => {
        const db = dbWithRows([[]]);

        await expect(
            deleteRunPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                runId: "run-1",
            }),
        ).rejects.toThrow(ApiNotFoundError);
    });
});

describe("retryRunPayload", () => {
    it("allows retrying a team-owned run", async () => {
        const db = dbWithRows([
            [
                {
                    id: "run-1",
                    team_id: "team-1",
                    dataset_id: "dataset-1",
                    status: "failed",
                    config_snapshot: {},
                    created_at: new Date("2026-07-06T08:00:00.000Z"),
                },
            ],
        ]);

        await expect(
            retryRunPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                runId: "run-1",
            }),
        ).resolves.toBeUndefined();
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("from runs"),
            ["run-1", "team-1", "project-1"],
        );
    });

    it("records retry intent and marks admission pending in the same locked transaction", async () => {
        const db = dbWithRows([
            [{ status: "partial" }],
            [{ status: "queued", jobId: "old" }],
            [],
            [],
        ]);
        await retryRunPayload(db, {
            teamId: "team-1",
            projectId: "project-1",
            runId: "run-1",
        });
        expect(db.query).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining("for update"),
            ["run-1", "team-1", "project-1"],
        );
        expect(db.query).toHaveBeenNthCalledWith(
            3,
            expect.stringContaining("job_id=gen_random_uuid()"),
            ["run-1"],
        );
        expect(db.query).toHaveBeenLastCalledWith(
            expect.stringContaining("update runs set status='pending'"),
            ["run-1"],
        );
    });

    it("does not admit another retry while the published generation is queued or active", async () => {
        const db = dbWithRows([
            [{ status: "pending" }],
            [{ status: "queued", jobId: "job-1" }],
            [{ id: "job-1" }],
        ]);
        await retryRunPayload(db, {
            teamId: "team-1",
            projectId: "project-1",
            runId: "run-1",
        });
        expect(db.query).toHaveBeenCalledTimes(3);
        expect(db.query).toHaveBeenLastCalledWith(
            expect.stringContaining("state in ('created', 'retry', 'active')"),
            ["job-1"],
        );
        expect(db.query).not.toHaveBeenCalledWith(
            expect.stringContaining("insert into run_enqueue_outbox"),
            expect.anything(),
        );
    });

    it("recovers pending runs whose job finished before execution setup completed", async () => {
        const db = dbWithRows([
            [{ status: "pending" }],
            [{ status: "queued", jobId: "finished-job" }],
            [],
            [],
            [],
        ]);
        await retryRunPayload(db, {
            teamId: "team-1",
            projectId: "project-1",
            runId: "run-1",
        });
        expect(db.query).toHaveBeenNthCalledWith(
            4,
            expect.stringContaining("job_id=gen_random_uuid()"),
            ["run-1"],
        );
    });

    it("leaves an already pending publication generation unchanged", async () => {
        const db = dbWithRows([
            [{ status: "pending" }],
            [{ status: "pending_enqueue", jobId: "job-1" }],
        ]);
        await retryRunPayload(db, {
            teamId: "team-1",
            projectId: "project-1",
            runId: "run-1",
        });
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    it("does not retry runs outside the requesting team", async () => {
        const db = dbWithRows([[]]);

        await expect(
            retryRunPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                runId: "run-1",
            }),
        ).rejects.toThrow(ApiNotFoundError);
    });
});

describe("runSetupPayload", () => {
    it("returns new-run form options from Railway-owned reads", async () => {
        const db = dbWithRows([
            [],
            [
                {
                    id: "dataset-1",
                    name: "Food",
                    purpose: "golden",
                    modality: "image",
                    item_count: 2,
                    labeled_item_count: 1,
                },
                {
                    id: "dataset-2",
                    name: "Empty",
                    purpose: "golden",
                    modality: "text",
                    item_count: 0,
                    labeled_item_count: 0,
                },
            ],
            [
                {
                    id: "pipeline-1",
                    name: "Bundle",
                    field_configs: [{ field: "$.score", kind: "factual" }],
                },
            ],
            [
                {
                    id: "version-1",
                    prompt_name: "Prompt",
                    version: 3,
                    json_schema: {
                        type: "object",
                        properties: { score: { type: "number" } },
                    },
                    field_configs: [],
                    reasoning_config: { effort: "low" },
                },
            ],
            [
                {
                    prompt_version_id: "judge-version-1",
                    prompt_name: "Judge",
                    version: 2,
                    judge_spec: { modelId: "gpt-4o" },
                },
            ],
        ]);

        const payload = await runSetupPayload(
            db,
            testConfig(),
            "team-1",
            "project-1",
        );

        expect(payload.datasets).toEqual([
            {
                id: "dataset-1",
                name: "Food",
                itemCount: 2,
                labeledItemCount: 1,
                purpose: "golden",
                modality: "image",
            },
        ]);
        expect(payload.bundles).toEqual([
            {
                id: "pipeline-1",
                name: "Bundle",
                fieldCount: 1,
                fieldConfigs: [{ field: "$.score", kind: "factual" }],
            },
        ]);
        expect(payload.versionOptions).toEqual([
            {
                id: "version-1",
                label: "Prompt v3",
                fieldConfigs: [
                    {
                        field: "$.score",
                        kind: "factual",
                        spec: { matcher: "exact" },
                    },
                ],
                reasoningConfig: { effort: "low" },
            },
        ]);
        expect(payload.judgePrompts).toEqual([
            {
                promptVersionId: "judge-version-1",
                label: "Judge v2",
            },
        ]);
        expect(payload.hasPrompt).toBe(true);
        expect(payload.modelsDegraded).toBe(false);
        expect(payload.availableModels.length).toBeGreaterThan(0);
        expect(payload.availableModels[0]).toMatchObject({
            providerLabel: expect.any(String),
            structuredOutput: expect.any(Boolean),
            judgeSuitable: expect.any(Boolean),
            costAvailable: expect.any(Boolean),
        });
        expect(payload.sttModels).toContainEqual(
            expect.objectContaining({
                id: "gpt-4o-mini-transcribe",
                label: "GPT-4o mini Transcribe",
                providerId: "openai",
                providerLabel: "OpenAI",
                routeId: "openai-audio-transcriptions",
                outputKind: "plain_transcript",
                availabilityStatus: "available",
                available: true,
                configFields: expect.arrayContaining([
                    expect.objectContaining({ key: "language" }),
                    expect.objectContaining({ key: "prompt" }),
                ]),
            }),
        );
        expect(payload.sttModels).toContainEqual(
            expect.objectContaining({
                id: "soniox:stt-async-v5",
                providerId: "soniox",
                availabilityStatus: "missing_key",
                available: false,
                unavailableReason:
                    "Add SONIOX_API_KEY to use Soniox transcription.",
            }),
        );
    });
});
