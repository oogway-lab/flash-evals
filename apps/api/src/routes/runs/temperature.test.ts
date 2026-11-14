import { describe, expect, it, vi } from "vitest";
import type { ICreateRunRequest } from "@flash-evals/api-contract";
import type { IApiConfig } from "../../config.js";
import type { IDb } from "../../db.js";
import { resolveApiFeatureFlags } from "../../featureFlags.js";
import {
    createRunFromSelectionPayload,
    createRunPayload,
    temperatureRefusal,
    validateRunTemperatures,
} from "./creation.js";

type RunModel = ICreateRunRequest["models"][number];

function model(overrides: Partial<RunModel>): RunModel {
    return { modelId: "gpt-4o", isReference: true, ...overrides };
}

describe("which models can take a temperature", () => {
    it.each<[string, Partial<RunModel>]>([
        ["a model that takes sampling settings", { modelId: "gpt-4o" }],
        [
            "Claude with thinking off",
            {
                modelId: "anthropic/claude-sonnet-4.6",
                reasoningConfig: { effort: "none" },
            },
        ],
        [
            "Claude with no thinking level",
            { modelId: "anthropic/claude-sonnet-4.5" },
        ],
        [
            "Claude with thinking on at temperature 1",
            {
                modelId: "anthropic/claude-sonnet-4.6",
                reasoningConfig: { effort: "low" },
                temperature: 1,
            },
        ],
        [
            "a thinking model other than OpenAI's or Claude",
            {
                modelId: "openrouter/z-ai/glm-5.2",
                transport: "bifrost",
                reasoningConfig: { effort: "medium" },
            },
        ],
    ])("accepts %s", (_name, overrides) => {
        expect(
            temperatureRefusal(model({ temperature: 0.3, ...overrides })),
        ).toBeUndefined();
    });

    it("refuses an OpenAI reasoning model, naming it and why", () => {
        expect(
            temperatureRefusal(
                model({ modelId: "gpt-6-luna", temperature: 0 }),
            ),
        ).toBe(
            "gpt-6-luna is an OpenAI reasoning model, which takes no temperature. Remove the temperature for gpt-6-luna.",
        );
    });

    it("refuses an OpenAI reasoning model by the id its provider is sent", () => {
        expect(
            temperatureRefusal(
                model({
                    modelId: "openrouter/openai/gpt-6-luna",
                    transport: "bifrost",
                    temperature: 0.5,
                }),
            ),
        ).toMatch(/OpenAI reasoning model/);
    });

    it("refuses Claude with thinking on below or above 1", () => {
        expect(
            temperatureRefusal(
                model({
                    modelId: "anthropic/claude-sonnet-4.6",
                    transport: "anthropic",
                    reasoningConfig: { effort: "low" },
                    temperature: 0.2,
                }),
            ),
        ).toBe(
            'anthropic/claude-sonnet-4.6 runs with thinking on ("low"), and Claude takes only temperature 1 while thinking. Remove the temperature for anthropic/claude-sonnet-4.6, set it to 1, or turn thinking off.',
        );
    });

    it("refuses any temperature for a Claude model that takes none", () => {
        expect(
            temperatureRefusal(
                model({
                    modelId: "anthropic/claude-sonnet-5.5",
                    reasoningConfig: { effort: "none" },
                    temperature: 1,
                }),
            ),
        ).toBe(
            "anthropic/claude-sonnet-5.5 takes no temperature (Claude 5 models and Opus 4.7 and later refuse it). Remove the temperature for anthropic/claude-sonnet-5.5.",
        );
    });

    it("leaves models without a temperature alone", () => {
        expect(
            temperatureRefusal(model({ modelId: "gpt-6-luna" })),
        ).toBeUndefined();
    });

    it.each([-0.1, 2.1, Number.NaN, "0.5" as unknown as number])(
        "refuses a temperature of %s",
        (temperature) => {
            expect(() =>
                validateRunTemperatures(
                    [model({ temperature })],
                    "temperatureAssignments",
                ),
            ).toThrow(
                "temperatureAssignments: the temperature for gpt-4o must be a number from 0 to 2.",
            );
        },
    );
});

describe("POST /api/runs with a temperature", () => {
    it("stores the temperature on the run's model and in its snapshot", async () => {
        const db = dbForCreate();
        await createRunPayload(
            db,
            runInput({ modelId: "gpt-4o", temperature: 0.7 }),
            testConfig(),
        );
        const insert = queryCall(db, "insert into run_models");
        expect(insert?.[0]).toContain("temperature");
        expect(insert?.[1]).toContain(0.7);
        const run = queryCall(db, "insert into runs");
        expect((run?.[1] as unknown[])[6]).toMatchObject({
            models: [expect.objectContaining({ temperature: 0.7 })],
        });
    });

    it("stores no temperature when the run sets none", async () => {
        const db = dbForCreate();
        await createRunPayload(
            db,
            runInput({ modelId: "gpt-4o" }),
            testConfig(),
        );
        const values = queryCall(
            db,
            "insert into run_models",
        )?.[1] as unknown[];
        expect(values[7]).toBeNull();
    });

    it("refuses a model that can't take it, before anything is stored", async () => {
        const db = dbForCreate();
        await expect(
            createRunPayload(
                db,
                runInput({ modelId: "gpt-6-luna", temperature: 0.2 }),
                testConfig(),
            ),
        ).rejects.toThrow(
            "models: gpt-6-luna is an OpenAI reasoning model, which takes no temperature.",
        );
        expect(db.query).not.toHaveBeenCalled();
    });
});

describe("temperatureAssignments on the selection path", () => {
    function selection(
        temperatureAssignments: Array<{ modelId: string; temperature: number }>,
    ) {
        const db = {
            query: vi.fn(async (sql: string) =>
                sql.includes("from datasets")
                    ? {
                          rows: [
                              {
                                  id: "dataset-1",
                                  team_id: "team-1",
                                  archived_at: null,
                                  purpose: "golden",
                                  modality: "text",
                              },
                          ],
                      }
                    : { rows: [] },
            ),
        } as unknown as IDb;
        return createRunFromSelectionPayload(
            db,
            {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                promptVersionId: "pv-1",
                maxTokens: 500,
                judgeModelId: "gpt-5.4-mini",
                modelIds: ["gpt-4o"],
                promptAssignments: [],
                reasoningConfigs: [],
                temperatureAssignments,
                fieldConfigs: [],
                createdBy: "user-1",
            },
            testConfig(),
        );
    }

    it("refuses a temperature for a model the run doesn't have", async () => {
        await expect(
            selection([{ modelId: "gpt-4.1", temperature: 0.2 }]),
        ).rejects.toThrow(
            "temperatureAssignments: gpt-4.1 is not one of the run's models.",
        );
    });

    it("refuses a model listed twice", async () => {
        await expect(
            selection([
                { modelId: "gpt-4o", temperature: 0.2 },
                { modelId: "gpt-4o", temperature: 0.4 },
            ]),
        ).rejects.toThrow("temperatureAssignments: gpt-4o is listed twice.");
    });

    it("refuses a temperature outside 0 to 2", async () => {
        await expect(
            selection([{ modelId: "gpt-4o", temperature: 3 }]),
        ).rejects.toThrow(
            "temperatureAssignments: the temperature for gpt-4o must be a number from 0 to 2.",
        );
    });
});

function runInput(spec: Partial<RunModel>): ICreateRunRequest {
    return {
        teamId: "team-1",
        projectId: "project-1",
        datasetId: "dataset-1",
        models: [model({ promptVersionId: null, ...spec })],
        maxTokens: 500,
        fieldConfigs: [],
        createdBy: "user-1",
    };
}

function dbForCreate(): IDb {
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
                    rows: [
                        { id: "item-1", input_text: "hi", storage_key: null },
                    ],
                };
            if (sql.includes("insert into runs"))
                return { rows: [{ id: "run-1" }] };
            if (sql.includes("insert into run_models"))
                return { rows: [{ id: "run-model-1" }] };
            return { rows: [] };
        }),
    } as unknown as IDb;
}

function queryCall(db: IDb, text: string): [string, unknown[]] | undefined {
    return vi
        .mocked(db.query)
        .mock.calls.find(([sql]) => String(sql).includes(text)) as
        [string, unknown[]] | undefined;
}

function testConfig(): IApiConfig {
    return {
        nodeEnv: "test",
        port: 3001,
        databaseUrl: "postgres://test",
        storageAdapter: "supabase",
        supabaseUrl: "https://supabase.example.com",
        supabaseServiceRoleKey: "service-role",
        supabaseStorageBucket: "flash-evals-images",
        clerkSecretKey: "clerk-secret",
        flashEvalsTenancyMode: "single-org",
        flashEvalsAllowedEmailDomain: "example.com",
        corsOrigins: [],
        flashEvalsLlmProvider: "openai",
        openaiApiKey: "test-openai",
        sttCapabilityProbes: {},
        profilingEnabled: false,
        featureFlags: resolveApiFeatureFlags({}),
    };
}
