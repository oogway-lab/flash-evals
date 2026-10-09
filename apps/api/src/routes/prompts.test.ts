import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@mosaic/llm-core";
import { Buffer } from "node:buffer";
import { encryptSecret } from "@mosaic/secrets";
import { getEvalProvider, listAvailableModelMetadata } from "@mosaic/llm-core";

const llmCoreMocks = vi.hoisted(() => ({
    complete: vi.fn(),
}));
const TEAM_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("@mosaic/llm-core", async (importOriginal) => {
    const actual = await importOriginal<typeof LlmCore>();
    return {
        ...actual,
        getEvalProvider: vi.fn(() => ({
            complete: llmCoreMocks.complete,
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
    createJudgePromptPayload,
    deletePromptPayload,
    duplicatePromptVersionPayload,
    generatePromptSchemaPayload,
    listPromptsPayload,
    optimizePromptPayload,
    promptDetailPayload,
    promptWorkbenchSetupPayload,
    recordPromptValidationAttemptPayload,
    saveRunnablePromptPayload,
    testPromptDraftPayload,
    validateRunnablePromptPayload,
} from "./prompts.js";
import { runSetupPayload } from "./runs.js";
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import { ApiBadRequestError, ApiNotFoundError } from "../errors.js";
import { resolveApiFeatureFlags } from "../featureFlags.js";

beforeEach(() => {
    llmCoreMocks.complete.mockReset();
});

it("validates outputs against generated schemas that declare Draft 7", async () => {
    llmCoreMocks.complete.mockResolvedValueOnce({
        text: JSON.stringify({
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: { answer: { type: "string" } },
        }),
    });
    const generated = await generatePromptSchemaPayload(
        dbWithRows([[{ id: "project-1" }], [], []]),
        testConfig(),
        {
            teamId: TEAM_ID,
            projectId: "project-1",
            content: "Return an answer as JSON.",
            targetModelId: "gpt-4o",
            generatorModelId: "gpt-4o",
            createdBy: "user-1",
        },
    );
    llmCoreMocks.complete.mockResolvedValueOnce({
        text: '{"answer":"ok"}',
        usage: {},
        latencyMs: 1,
    });
    const tested = await testPromptDraftPayload(dbWithRows([]), testConfig(), {
        teamId: TEAM_ID,
        prompt: "Return an answer as JSON.",
        jsonSchema: generated.schema,
        targetModelId: "gpt-4o",
        transport: "openai",
        samples: [{ name: "sample", inputText: "hello" }],
    });
    expect(tested.results[0]?.status).toBe("success");
});

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

it("uses the team database key for a real prompt provider call", async () => {
    const encryptionKey = Buffer.alloc(32, 9).toString("base64");
    const encrypted = encryptSecret(
        "db-openai-key",
        { teamId: TEAM_ID, provider: "openai" },
        encryptionKey,
    );
    const db: IDb = {
        query: vi.fn(
            async () =>
                ({
                    rows: [{ provider: "openai", ...encrypted, baseUrl: null }],
                }) as never,
        ),
    };
    llmCoreMocks.complete.mockResolvedValue({
        text: '{"answer":"ok"}',
        parsed: { answer: "ok" },
        usage: { promptTokens: 10, completionTokens: 5 },
        latencyMs: 1,
    });

    const result = await testPromptDraftPayload(
        db,
        testConfig({ mosaicSecretsEncKey: encryptionKey }),
        {
            teamId: TEAM_ID,
            prompt: "Answer",
            jsonSchema: {
                type: "object",
                additionalProperties: false,
                required: ["answer"],
                properties: { answer: { type: "string" } },
            },
            targetModelId: "gpt-4o",
            transport: "openrouter",
            samples: [{ name: "one", inputText: "hello" }],
        },
    );

    expect(vi.mocked(getEvalProvider)).toHaveBeenCalledWith(
        expect.objectContaining({ openai: "db-openai-key" }),
        expect.objectContaining({ transport: "openrouter" }),
    );
    expect(result.results[0]).toMatchObject({
        costSource: "computed",
        costUsd: expect.any(Number),
    });
});

it("runs newly discovered Gateway models with their live transport ids", async () => {
    const encryptionKey = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptSecret(
        "db-gateway-key",
        { teamId: TEAM_ID, provider: "gateway" },
        encryptionKey,
    );
    const db: IDb = {
        query: vi.fn(
            async () =>
                ({
                    rows: [
                        { provider: "gateway", ...encrypted, baseUrl: null },
                    ],
                }) as never,
        ),
    };
    vi.mocked(listAvailableModelMetadata).mockResolvedValueOnce([
        {
            id: "openai/gpt-5.6-luna",
            pricing: {
                promptPricePerToken: 1 / 1_000_000,
                completionPricePerToken: 2 / 1_000_000,
            },
        },
    ]);
    llmCoreMocks.complete.mockResolvedValue({
        text: '{"answer":"ok"}',
        parsed: { answer: "ok" },
        usage: { promptTokens: 10, completionTokens: 5 },
        latencyMs: 1,
    });

    const lunaResult = await testPromptDraftPayload(
        db,
        testConfig({
            mosaicLlmProvider: "gateway",
            mosaicSecretsEncKey: encryptionKey,
        }),
        {
            teamId: TEAM_ID,
            prompt: "Answer",
            jsonSchema: {
                type: "object",
                additionalProperties: false,
                required: ["answer"],
                properties: { answer: { type: "string" } },
            },
            targetModelId: "gpt-5.6-luna",
            transport: "gateway",
            samples: [{ name: "one", inputText: "hello" }],
        },
    );

    expect(vi.mocked(getEvalProvider)).toHaveBeenCalledWith(
        expect.objectContaining({ gateway: "db-gateway-key" }),
        expect.objectContaining({
            transport: "gateway",
            exactTransportModelId: "openai/gpt-5.6-luna",
        }),
    );
    expect(lunaResult.results[0]).toMatchObject({
        costSource: "computed",
        costUsd: expect.any(Number),
    });

    vi.mocked(listAvailableModelMetadata).mockResolvedValueOnce([
        { id: "anthropic/new-gateway-model" },
    ]);
    await testPromptDraftPayload(
        db,
        testConfig({
            mosaicLlmProvider: "gateway",
            mosaicSecretsEncKey: encryptionKey,
        }),
        {
            teamId: TEAM_ID,
            prompt: "Answer",
            jsonSchema: {
                type: "object",
                additionalProperties: false,
                required: ["answer"],
                properties: { answer: { type: "string" } },
            },
            targetModelId: "anthropic/new-gateway-model",
            transport: "gateway",
            samples: [{ name: "one", inputText: "hello" }],
        },
    );

    expect(vi.mocked(getEvalProvider)).toHaveBeenLastCalledWith(
        expect.objectContaining({ gateway: "db-gateway-key" }),
        expect.objectContaining({
            transport: "gateway",
            exactTransportModelId: "anthropic/new-gateway-model",
        }),
    );
});

function dbWithRows(rows: unknown[] | unknown[][]): IDb {
    const queue = Array.isArray(rows[0])
        ? [...(rows as unknown[][])]
        : [rows as unknown[]];
    return {
        query: vi.fn(async () => ({ rows: queue.shift() ?? [] }) as never),
    };
}

describe("listPromptsPayload", () => {
    it("keeps project A and project B prompt queries isolated", async () => {
        const projectADb = dbWithRows([]);
        const projectBDb = dbWithRows([]);

        await listPromptsPayload(projectADb, "team-1", "project-a");
        await listPromptsPayload(projectBDb, "team-1", "project-b");

        expect(projectADb.query).toHaveBeenCalledWith(expect.any(String), [
            "team-1",
            "project-a",
        ]);
        expect(projectBDb.query).toHaveBeenCalledWith(expect.any(String), [
            "team-1",
            "project-b",
        ]);
    });

    it("returns prompt cards with latest version metadata", async () => {
        const db = dbWithRows([
            {
                id: "prompt-1",
                name: "Meal prompt",
                description: "Describe food",
                kind: "eval",
                latest_version: 3,
                latest_status: "runnable",
                latest_created_at: new Date("2026-07-06T08:00:00.000Z"),
                latest_optimizer_attempt_id: "attempt-1",
            },
            {
                id: "prompt-2",
                name: "Judge prompt",
                description: null,
                kind: "judge",
                latest_version: null,
                latest_status: null,
                latest_created_at: null,
                latest_optimizer_attempt_id: null,
            },
        ]);

        await expect(
            listPromptsPayload(db, "team-1", "project-1"),
        ).resolves.toEqual([
            {
                id: "prompt-1",
                name: "Meal prompt",
                description: "Describe food",
                kind: "eval",
                latest: {
                    version: 3,
                    status: "runnable",
                    createdAt: "2026-07-06T08:00:00.000Z",
                    optimizedWithAi: true,
                },
            },
            {
                id: "prompt-2",
                name: "Judge prompt",
                description: null,
                kind: "judge",
                latest: undefined,
            },
        ]);
        expect(db.query).toHaveBeenCalledWith(expect.any(String), [
            "team-1",
            "project-1",
        ]);
    });
});

describe("promptDetailPayload", () => {
    it("returns prompt detail, versions, and latest schema", async () => {
        const db = dbWithRows([
            [
                {
                    id: "prompt-1",
                    name: "Meal prompt",
                    description: "Describe food",
                    kind: "eval",
                },
            ],
            [
                {
                    id: "version-2",
                    version: 2,
                    status: "runnable",
                    content: "Prompt v2",
                    created_at: new Date("2026-07-06T08:00:00.000Z"),
                    schema_version_id: "schema-1",
                    optimizer_attempt_id: "attempt-1",
                },
                {
                    id: "version-1",
                    version: 1,
                    status: "legacy",
                    content: "Prompt v1",
                    created_at: "2026-07-05T08:00:00.000Z",
                    schema_version_id: null,
                    optimizer_attempt_id: null,
                },
            ],
            [{ json_schema: { type: "object" } }],
        ]);

        await expect(
            promptDetailPayload(db, "team-1", "project-1", "prompt-1"),
        ).resolves.toEqual({
            prompt: {
                id: "prompt-1",
                name: "Meal prompt",
                description: "Describe food",
                kind: "eval",
            },
            latestVersion: {
                id: "version-2",
                version: 2,
                status: "runnable",
                content: "Prompt v2",
                createdAt: "2026-07-06T08:00:00.000Z",
                schemaVersionId: "schema-1",
                optimizerAttemptId: "attempt-1",
            },
            schemaVersion: { jsonSchema: { type: "object" } },
            versions: [
                {
                    id: "version-2",
                    version: 2,
                    status: "runnable",
                    content: "Prompt v2",
                    createdAt: "2026-07-06T08:00:00.000Z",
                    schemaVersionId: "schema-1",
                    optimizerAttemptId: "attempt-1",
                },
                {
                    id: "version-1",
                    version: 1,
                    status: "legacy",
                    content: "Prompt v1",
                    createdAt: "2026-07-05T08:00:00.000Z",
                    schemaVersionId: null,
                    optimizerAttemptId: null,
                },
            ],
        });
        expect(db.query).toHaveBeenCalledWith(expect.any(String), [
            "prompt-1",
            "team-1",
            "project-1",
        ]);
    });
});

describe("promptWorkbenchSetupPayload", () => {
    it("keeps prompt and run transport options in parity", async () => {
        const db = {
            query: vi.fn(async () => ({ rows: [] }) as never),
        } as IDb;
        const config = testConfig();
        const [promptSetup, runSetup] = await Promise.all([
            promptWorkbenchSetupPayload(db, config, "team-1", "project-1"),
            runSetupPayload(db, config, "team-1", "project-1"),
        ]);
        expect(
            promptSetup.availableModels.map(({ id, transports }) => ({
                id,
                transports,
            })),
        ).toEqual(
            runSetup.availableModels.map(({ id, transports }) => ({
                id,
                transports,
            })),
        );
    });

    it("returns prompt workbench setup with edit seed data", async () => {
        const db = dbWithRows([
            [],
            [{ tag: "nutrition" }, { tag: "food" }],
            [
                {
                    id: "prompt-1",
                    name: "Meal prompt",
                    description: null,
                    kind: "eval",
                    target_model_id: "gpt-4o",
                },
            ],
            [
                {
                    id: "version-1",
                    content: "Describe the meal",
                    schema_version_id: "schema-1",
                    reasoning_config: { effort: "low" },
                },
            ],
            [{ json_schema: { type: "object" } }],
            [{ tag: "food" }],
        ]);

        const payload = await promptWorkbenchSetupPayload(
            db,
            testConfig(),
            "team-1",
            "project-1",
            "prompt-1",
        );

        expect(payload.tagSuggestions).toEqual(["food", "nutrition"]);
        expect(payload.modelsDegraded).toBe(false);
        expect(payload.availableModels[0]).toMatchObject({
            id: expect.any(String),
            vision: expect.any(Boolean),
            providerLabel: expect.any(String),
            structuredOutput: expect.any(Boolean),
            judgeSuitable: expect.any(Boolean),
            costAvailable: expect.any(Boolean),
            available: true,
            transports: expect.any(Array),
        });
        expect(payload.initialPrompt).toEqual({
            promptId: "prompt-1",
            name: "Meal prompt",
            description: "",
            kind: "eval",
            content: "Describe the meal",
            jsonSchema: '{\n    "type": "object"\n}',
            targetModelId: "gpt-4o",
            reasoningEffort: "low",
            fitTags: ["food"],
        });
    });
});

describe("deletePromptPayload", () => {
    it("blocks deleting prompts used by runs", async () => {
        const db = dbWithRows([
            [{ id: "prompt-1" }],
            [{ id: "version-1" }],
            [{ id: "run-model-1" }],
            [],
        ]);

        await expect(
            deletePromptPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                promptId: "prompt-1",
            }),
        ).rejects.toThrow("Delete the runs");
    });

    it("cleans up prompt rows when unused", async () => {
        const db = dbWithRows([
            [{ id: "prompt-1" }],
            [{ id: "version-1" }],
            [],
            [],
            [{ id: "schema-1" }],
            [{ id: "draft-1" }],
            [{ id: "validation-1" }],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
            [],
        ]);

        await expect(
            deletePromptPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                promptId: "prompt-1",
            }),
        ).resolves.toBeUndefined();
        expect(db.query).toHaveBeenLastCalledWith(
            "delete from prompts where id = $1 and team_id = $2",
            ["prompt-1", "team-1"],
        );
    });
});

describe("duplicatePromptVersionPayload", () => {
    it("copies a structured prompt version and validation evidence", async () => {
        const db = dbWithRows([
            [{ id: "project-1" }],
            [
                {
                    id: "source-pv",
                    prompt_id: "source-prompt",
                    content: "Return JSON.",
                    schema_version_id: "source-schema",
                    validation_attempt_id: "source-validation",
                    reasoning_config: { effort: "low" },
                },
            ],
            [
                {
                    id: "source-prompt",
                    team_id: "team-1",
                    name: "Source",
                    description: "Extract answer",
                    base_prompt_id: null,
                    target_model_id: "gpt-4o",
                },
            ],
            [
                {
                    json_schema: { type: "object" },
                    field_configs: [],
                    schema_hash: "hash-source",
                    openai_compatible: true,
                    compatibility_errors: [],
                },
            ],
            [
                {
                    target_model_id: "gpt-4o",
                    status: "passed",
                    evidence: { sampleResults: [] },
                    raw_output: '{"answer":"yes"}',
                    parsed_output: { answer: "yes" },
                    latency_ms: 12,
                },
            ],
            [{ id: "prompt-copy" }],
            [{ id: "schema-copy", schema_hash: "hash-source" }],
            [{ id: "validation-copy" }],
            [{ id: "version-copy" }],
            [],
        ]);

        await expect(
            duplicatePromptVersionPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                sourcePromptVersionId: "source-pv",
                createdBy: "user-1",
            }),
        ).resolves.toBeUndefined();
        expect(db.query).toHaveBeenNthCalledWith(
            6,
            expect.stringContaining("insert into prompts"),
            [
                "team-1",
                "project-1",
                "Source copy",
                "source-prompt",
                "gpt-4o",
                "Extract answer",
            ],
        );
        expect(db.query).toHaveBeenNthCalledWith(
            8,
            expect.stringContaining("insert into prompt_validation_attempts"),
            [
                "team-1",
                "project-1",
                "prompt-copy",
                "schema-copy",
                "gpt-4o",
                "hash-source",
                { sampleResults: [] },
                '{"answer":"yes"}',
                { answer: "yes" },
                12,
                "user-1",
            ],
        );
        expect(db.query).toHaveBeenLastCalledWith(
            expect.stringContaining("insert into prompt_version_fit_tags"),
            ["version-copy"],
        );
    });

    it("rejects unstructured source versions", async () => {
        const db = dbWithRows([
            [{ id: "project-1" }],
            [
                {
                    id: "source-pv",
                    prompt_id: "source-prompt",
                    content: "Return text.",
                    schema_version_id: null,
                    validation_attempt_id: null,
                    reasoning_config: null,
                },
            ],
            [
                {
                    id: "source-prompt",
                    team_id: "team-1",
                    name: "Source",
                    description: null,
                    base_prompt_id: null,
                    target_model_id: null,
                },
            ],
        ]);

        await expect(
            duplicatePromptVersionPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                sourcePromptVersionId: "source-pv",
                createdBy: "user-1",
            }),
        ).rejects.toThrow("Only structured prompt versions");
    });
});

describe("createJudgePromptPayload", () => {
    it("creates a judge prompt and runnable version", async () => {
        const db = dbWithRows([
            [{ id: "project-1" }],
            [{ id: "prompt-1" }],
            [{ id: "prompt-version-1" }],
        ]);

        await expect(
            createJudgePromptPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                name: "Judge",
                modelId: "gpt-5.4-mini",
                rubricPrompt: "Score it",
                reasoningConfig: { effort: "low" },
                createdBy: "user-1",
            }),
        ).resolves.toEqual({
            promptId: "prompt-1",
            promptVersionId: "prompt-version-1",
        });
        expect(db.query).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining("insert into prompts"),
            ["team-1", "project-1", "Judge", "gpt-5.4-mini"],
        );
        expect(db.query).toHaveBeenNthCalledWith(
            3,
            expect.stringContaining("insert into prompt_versions"),
            [
                "prompt-1",
                1,
                "Score it",
                {
                    modelId: "gpt-5.4-mini",
                    declaredInputs: [
                        "task_input",
                        "candidate_output",
                        "reference",
                    ],
                },
                { effort: "low" },
                "user-1",
            ],
        );
    });
});

describe("createJudgePromptPayload with an existing prompt", () => {
    const JUDGE_ID = "22222222-2222-4222-8222-222222222222";
    const input = {
        teamId: "team-1",
        projectId: "project-1",
        promptId: JUDGE_ID,
        name: "Judge v2",
        modelId: "gpt-5.4-mini",
        rubricPrompt: "Score it again",
        createdBy: "user-1",
    };

    it("adds the next version to the same judge prompt", async () => {
        const db = dbWithRows([
            [{ id: "project-1" }],
            [{ id: JUDGE_ID, team_id: "team-1", kind: "judge" }],
            [],
            [{ version: 3 }],
            [{ id: "prompt-version-4" }],
        ]);

        await expect(createJudgePromptPayload(db, input)).resolves.toEqual({
            promptId: JUDGE_ID,
            promptVersionId: "prompt-version-4",
        });
        const sql = vi
            .mocked(db.query)
            .mock.calls.map(([text]) => String(text));
        expect(sql.some((q) => q.includes("insert into prompts"))).toBe(false);
        expect(db.query).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining("from prompts"),
            [JUDGE_ID, "team-1", "project-1"],
        );
        expect(db.query).toHaveBeenNthCalledWith(
            3,
            expect.stringContaining("update prompts"),
            ["Judge v2", "gpt-5.4-mini", JUDGE_ID, "team-1", "project-1"],
        );
        expect(db.query).toHaveBeenNthCalledWith(
            5,
            expect.stringContaining("insert into prompt_versions"),
            expect.arrayContaining([JUDGE_ID, 4, "Score it again"]),
        );
    });

    it("rejects adding a judge version to an eval prompt", async () => {
        const db = dbWithRows([
            [{ id: "project-1" }],
            [{ id: JUDGE_ID, team_id: "team-1", kind: "eval" }],
        ]);
        await expect(createJudgePromptPayload(db, input)).rejects.toThrow(
            "Only judge prompts can save judge versions.",
        );
        await expect(
            createJudgePromptPayload(
                dbWithRows([
                    [{ id: "project-1" }],
                    [{ id: JUDGE_ID, team_id: "team-1", kind: "eval" }],
                ]),
                input,
            ),
        ).rejects.toBeInstanceOf(ApiBadRequestError);
    });

    it("answers 404 for another team's or project's prompt", async () => {
        // Scoped by team and project, so a foreign prompt is simply not found.
        const db = dbWithRows([[{ id: "project-1" }], []]);
        await expect(
            createJudgePromptPayload(db, input),
        ).rejects.toBeInstanceOf(ApiNotFoundError);
        const sql = vi
            .mocked(db.query)
            .mock.calls.map(([text]) => String(text));
        expect(sql.some((q) => q.includes("insert into"))).toBe(false);
    });

    it("answers 404 for a malformed id without querying Postgres with it", async () => {
        const db = dbWithRows([[{ id: "project-1" }]]);
        await expect(
            createJudgePromptPayload(db, { ...input, promptId: "not-a-uuid" }),
        ).rejects.toBeInstanceOf(ApiNotFoundError);
        expect(db.query).toHaveBeenCalledTimes(1);
    });
});

describe("prompt persistence payloads", () => {
    const validationEvidence = {
        staticChecks: [],
        schemaValidation: {
            localValid: true,
            openaiCompatible: true,
            errors: [],
        },
        sampleResults: [],
    };

    it("records validation attempts through the API boundary", async () => {
        const db = dbWithRows([[{ id: "project-1" }], []]);

        await expect(
            recordPromptValidationAttemptPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                targetModelId: "gpt-4o",
                status: "failed",
                schemaHash: "hash-1",
                evidence: validationEvidence,
                createdBy: "user-1",
            }),
        ).resolves.toBeUndefined();

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("insert into prompt_validation_attempts"),
            [
                "team-1",
                "project-1",
                null,
                null,
                "gpt-4o",
                "failed",
                "hash-1",
                validationEvidence,
                null,
                null,
                null,
                null,
                "user-1",
            ],
        );
    });

    it("creates prompt, schema, validation evidence, version, tags, and optimizer link", async () => {
        const db = dbWithRows([
            [{ id: "project-1" }],
            [{ id: "prompt-1" }],
            [{ version: null }],
            [{ id: "schema-1", schema_hash: "hash-1" }],
            [{ id: "validation-1" }],
            [{ version: null }],
            [{ id: "pv-1", version: 1 }],
            [],
            [],
            [],
        ]);

        await expect(
            saveRunnablePromptPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                name: "Extract answer",
                description: "Structured",
                targetModelId: "gpt-4o",
                content: "Return JSON.",
                jsonSchema: { type: "object" },
                fieldConfigs: [],
                validationEvidence,
                optimizerAttemptId: "opt-1",
                reasoningConfig: { effort: "low" },
                fitTags: ["food", "gpt-4o"],
                createdBy: "user-1",
            }),
        ).resolves.toMatchObject({
            promptId: "prompt-1",
            promptVersionId: "pv-1",
            promptVersion: 1,
            schemaVersionId: "schema-1",
        });

        expect(db.query).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining("insert into prompts"),
            ["team-1", "project-1", "Extract answer", "gpt-4o", "Structured"],
        );
        expect(db.query).toHaveBeenNthCalledWith(
            4,
            expect.stringContaining("insert into prompt_schema_versions"),
            expect.arrayContaining([
                "prompt-1",
                1,
                { type: "object" },
                "[]",
                true,
                "[]",
                "user-1",
            ]),
        );
        expect(db.query).toHaveBeenNthCalledWith(
            7,
            expect.stringContaining("insert into prompt_versions"),
            [
                "prompt-1",
                1,
                "Return JSON.",
                "schema-1",
                "validation-1",
                "opt-1",
                { effort: "low" },
                "user-1",
            ],
        );
        expect(db.query).toHaveBeenLastCalledWith(
            expect.stringContaining("update prompt_optimization_attempts"),
            ["prompt-1", "validation-1", "opt-1", "team-1", "project-1"],
        );
        expect(vi.mocked(db.query).mock.calls.at(-1)?.[0]).toContain(
            "project_id = $5",
        );
    });
});

describe("optimizePromptPayload", () => {
    const optimizeInput = {
        teamId: "team-1",
        projectId: "project-1",
        content: "Extract the dish name.",
        targetModelId: "anthropic/claude-sonnet-4.5",
        optimizerModelId: "gpt-5.4-mini",
        jsonSchema: {
            type: "object",
            additionalProperties: false,
            required: ["dish"],
            properties: { dish: { type: "string" } },
        },
        createdBy: "user-1",
    };

    function mockOptimizerSuccess(overrides: {
        rationale: string;
        fitTags: string[];
    }) {
        llmCoreMocks.complete.mockResolvedValueOnce({
            parsed: {
                proposedPrompt: "Return the dish as JSON.",
                rationale: overrides.rationale,
                fitTags: overrides.fitTags,
                structuredOutputNotes: ["Return only JSON."],
            },
        });
    }

    it("uses official provider guidance for Claude targets", async () => {
        mockOptimizerSuccess({
            rationale: "The prompt is clearer for Claude.",
            fitTags: ["claude", "json"],
        });
        const db = dbWithRows([[{ id: "project-1" }], [], [{ id: "opt-1" }]]);

        const result = await optimizePromptPayload(
            db,
            testConfig({
                mosaicLlmProvider: "gateway",
                aiGatewayApiKey: "gateway",
            }),
            optimizeInput,
        );

        expect(result.optimizationGuidanceSource.title).toContain(
            "Anthropic Claude",
        );
        expect(result.optimizationGuidanceSource.url).toContain(
            "platform.claude.com",
        );
        expect(llmCoreMocks.complete).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.stringMatching(
                    /XML-style tags[\s\S]*proposedPrompt must be model-agnostic/,
                ),
            }),
        );
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("insert into prompt_optimization_attempts"),
            expect.arrayContaining([
                "team-1",
                "anthropic/claude-sonnet-4.5",
                "gpt-5.4-mini",
                expect.objectContaining({
                    title: expect.stringContaining("Anthropic Claude"),
                    url: expect.stringContaining("platform.claude.com"),
                }),
            ]),
        );
    });

    it("labels fallback guidance as generic with an internal source URL", async () => {
        mockOptimizerSuccess({
            rationale: "The prompt preserves the schema.",
            fitTags: ["generic", "json"],
        });
        const db = dbWithRows([[{ id: "project-1" }], [], [{ id: "opt-1" }]]);

        const result = await optimizePromptPayload(
            db,
            testConfig({
                mosaicLlmProvider: "gateway",
                aiGatewayApiKey: "gateway",
            }),
            {
                ...optimizeInput,
                targetModelId: "meta/llama-4-maverick",
            },
        );

        expect(result.optimizationGuidanceSource).toEqual({
            title: "Flash Evals generic prompt optimization guidance",
            url: "internal://mosaic/prompt-optimization",
            retrievedAt: "2026-07-08",
        });
        expect(llmCoreMocks.complete).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.stringContaining("provider-neutral"),
            }),
        );
    });
});

it.each([
    { samples: [] },
    { samples: [{ name: "Receipt", inputText: "Maple Cafe" }] },
])(
    "keeps missing provider credentials in prompt validation results (%j)",
    async ({ samples }) => {
        const message = "Please add your OpenRouter API key to run evals.";
        const actual =
            await vi.importActual<typeof LlmCore>("@mosaic/llm-core");
        vi.mocked(getEvalProvider).mockImplementationOnce(
            actual.getEvalProvider,
        );
        const db: IDb = {
            query: vi.fn(
                async (sql: string) =>
                    ({
                        rows: sql.includes("from provider_keys")
                            ? []
                            : [{ id: "project-1" }],
                    }) as never,
            ),
        };
        const result = await validateRunnablePromptPayload(
            db,
            testConfig({
                mosaicLlmProvider: "openrouter",
                openaiApiKey: undefined,
            }),
            {
                teamId: TEAM_ID,
                projectId: "project-1",
                createdBy: "user-1",
                prompt: "Return JSON.",
                targetModelId: "gpt-4o",
                jsonSchema: {
                    type: "object",
                    properties: { answer: { type: "string" } },
                    required: ["answer"],
                    additionalProperties: false,
                },
                samples,
            },
        );
        expect(result.passed).toBe(false);
        expect(result.failureMessage).toContain(message);
        expect(result.evidence.sampleResults[0]?.status).toBe("provider_error");
        expect(llmCoreMocks.complete).not.toHaveBeenCalled();
    },
);
