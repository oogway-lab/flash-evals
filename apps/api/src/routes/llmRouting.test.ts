import { Buffer } from "node:buffer";
import type {
    ICreateWorkflowLlmRouteVersionRequest,
    IWorkflowLlmCapabilitySnapshot,
} from "@mosaic/api-contract";
import {
    WORKFLOW_JUDGE_SCHEMA_DIGEST,
    WORKFLOW_JUDGE_SCHEMA_NAME,
} from "@mosaic/api-contract";
import { encryptSecret } from "@mosaic/secrets";
import { describe, expect, it, vi } from "vitest";

// Stored base URLs are re-resolved before use; keep the test hosts public.
vi.mock("node:dns/promises", () => ({
    lookup: vi.fn(async () => [{ address: "203.1.1.1", family: 4 }]),
}));
import type { IDb } from "../db.js";
import {
    createWorkflowLlmRouteVersionPayload,
    listWorkflowLlmCapabilitiesPayload,
    listWorkflowLlmRoutesPayload,
    refreshWorkflowLlmCapabilitiesPayload,
    setWorkflowLlmProjectDefaultPayload,
    validateWorkflowLlmSelections,
    validateWorkflowLlmRouteConfig,
} from "./llmRouting.js";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const KEY_ID = "44444444-4444-4444-8444-444444444444";
const CAPABILITY_ID = "55555555-5555-4555-8555-555555555555";
const ROUTE_ID = "66666666-6666-4666-8666-666666666666";
const VERSION_ID = "77777777-7777-4777-8777-777777777777";
const ROTATION_ID = "88888888-8888-4888-8888-888888888888";
const ENC_KEY = Buffer.alloc(32, 9).toString("base64");

const capability: IWorkflowLlmCapabilitySnapshot = {
    capabilityVersionId: CAPABILITY_ID,
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
    supportedUpstreamProviders: ["openai", "azure"],
};

const createInput: ICreateWorkflowLlmRouteVersionRequest = {
    projectId: PROJECT_ID,
    name: "OpenRouter exact",
    config: {
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
        cache: {
            mosaicReuse: "allow",
            providerCaching: "allow",
        },
    },
};

function dbWithRows(rows: unknown[][]): {
    db: IDb;
    query: ReturnType<typeof vi.fn>;
} {
    const query = vi.fn(async () => ({ rows: rows.shift() ?? [] }));
    return { db: { query } as unknown as IDb, query };
}

describe("workflow LLM routing service", () => {
    it("accepts Gemma OpenRouter routes with the canonical judge schema", () => {
        for (const modelId of [
            "google/gemma-4-26b-a4b-it",
            "google/gemma-4-31b-it",
            "google/gemma-3n-e4b-it",
            "google/gemma-3-4b-it",
            "google/gemma-3-12b-it",
            "google/gemma-3-27b-it",
            "google/gemma-2-27b-it",
        ]) {
            expect(() =>
                validateWorkflowLlmRouteConfig(
                    {
                        ...createInput.config,
                        modelId,
                        structuredOutput: {
                            mode: "json_schema",
                            schemaName: WORKFLOW_JUDGE_SCHEMA_NAME,
                            schemaDigest: WORKFLOW_JUDGE_SCHEMA_DIGEST,
                            strict: true,
                        },
                    },
                    {
                        ...capability,
                        transport: {
                            ...capability.transport,
                            transportModelId: modelId,
                        },
                    },
                ),
            ).not.toThrow();
        }
    });

    it("accepts Bifrost capabilities with a discovered upstream-prefixed model ID", () => {
        expect(() =>
            validateWorkflowLlmRouteConfig(
                {
                    ...createInput.config,
                    modelId: "google/gemma-4-26b-a4b-it",
                    transportConfig: {
                        ...createInput.config.transportConfig,
                        transport: "bifrost",
                        upstreamPolicy: { mode: "bifrost_default" },
                    },
                },
                {
                    ...capability,
                    transport: {
                        ...capability.transport,
                        transport: "bifrost",
                        modelId: "google/gemma-4-26b-a4b-it",
                        transportModelId:
                            "openrouter/google/gemma-4-26b-a4b-it:free",
                        upstreamRoutingModes: ["auto"],
                    },
                },
            ),
        ).not.toThrow();
    });

    it("lists safe immutable route history so old pins never upgrade to latest", async () => {
        const createdAt = "2026-07-24T01:00:00.000Z";
        const version = (id: string, number: number) => ({
            id,
            routeId: ROUTE_ID,
            version: number,
            config: createInput.config,
            providerKeyId: KEY_ID,
            providerKeyRotationVersion: ROTATION_ID,
            capabilityVersionId: CAPABILITY_ID,
            createdBy: ACTOR_ID,
            createdAt,
        });
        const v1 = version(VERSION_ID, 1);
        const v2 = version("99999999-9999-4999-8999-999999999999", 2);
        const { db, query } = dbWithRows([
            [{ ok: 1 }],
            [
                {
                    id: ROUTE_ID,
                    team_id: TEAM_ID,
                    project_id: PROJECT_ID,
                    name: createInput.name,
                    disabled_at: null,
                    created_by: ACTOR_ID,
                    created_at: createdAt,
                    version_id: v2.id,
                    version: 2,
                    config: createInput.config,
                    provider_key_id: KEY_ID,
                    provider_key_rotation_version: ROTATION_ID,
                    capability_version_id: CAPABILITY_ID,
                    version_created_by: ACTOR_ID,
                    version_created_at: createdAt,
                    versions: [v1, v2],
                },
            ],
        ]);

        const [route] = await listWorkflowLlmRoutesPayload(
            db,
            TEAM_ID,
            PROJECT_ID,
        );

        expect(route?.latestVersion?.id).toBe(v2.id);
        expect(route?.versions?.map((item) => item.id)).toEqual([v2.id]);
        expect(query).toHaveBeenLastCalledWith(
            expect.not.stringContaining("jsonb_agg"),
            [TEAM_ID, PROJECT_ID],
        );
        expect(JSON.stringify(route)).not.toContain("secret");
    });

    it("uses the same safe not-found result for an out-of-scope project", async () => {
        const { db, query } = dbWithRows([[]]);
        await expect(
            createWorkflowLlmRouteVersionPayload(
                db,
                { mosaicSecretsEncKey: ENC_KEY } as never,
                createInput,
                { teamId: TEAM_ID, actorId: ACTOR_ID },
            ),
        ).rejects.toMatchObject({
            code: "not_found",
            message: "LLM routing resource was not found or is unavailable.",
        });
        expect(query).toHaveBeenCalledTimes(1);
    });

    it("lists safe capability state without credential material", async () => {
        const { db } = dbWithRows([
            [{ ok: 1 }],
            [
                {
                    id: CAPABILITY_ID,
                    team_id: TEAM_ID,
                    project_id: PROJECT_ID,
                    transport: "openrouter",
                    capability_digest: "sha256:capability",
                    capability_snapshot: capability,
                    captured_at: "2026-07-24T00:00:00.000Z",
                    expires_at: "2026-07-25T00:00:00.000Z",
                    credential_available: true,
                },
            ],
        ]);

        const result = await listWorkflowLlmCapabilitiesPayload(
            db,
            TEAM_ID,
            PROJECT_ID,
        );
        expect(result[0]).toMatchObject({
            transport: "openrouter",
            credentialAvailable: true,
        });
        expect(JSON.stringify(result)).not.toContain("ciphertext");
        expect(JSON.stringify(result)).not.toContain("rotation");
    });

    it("marks expired capability versions stale when they are read", async () => {
        const { db } = dbWithRows([
            [{ ok: 1 }],
            [
                {
                    id: CAPABILITY_ID,
                    team_id: TEAM_ID,
                    project_id: PROJECT_ID,
                    transport: "openrouter",
                    capability_digest: "sha256:expired",
                    capability_snapshot: capability,
                    captured_at: "2020-01-01T00:00:00.000Z",
                    expires_at: "2020-01-01T01:00:00.000Z",
                    credential_available: true,
                },
            ],
        ]);

        const result = await listWorkflowLlmCapabilitiesPayload(
            db,
            TEAM_ID,
            PROJECT_ID,
        );

        expect(result[0]?.snapshot.stale).toBe(true);
    });

    it("refreshes capabilities from the exact stored credential without environment fallback", async () => {
        const encrypted = encryptSecret(
            "stored-openrouter-key",
            { teamId: TEAM_ID, provider: "openrouter" },
            ENC_KEY,
        );
        const listModels = vi.fn(async () => [{ id: "openai/gpt-4o" }]);
        const { db, query } = dbWithRows([
            [{ ok: 1 }],
            [
                {
                    provider: "openrouter",
                    ...encrypted,
                    authTag: encrypted.authTag,
                    baseUrl: "https://openrouter.example/v1",
                },
            ],
            [],
            [{ ok: 1 }],
            [
                {
                    id: CAPABILITY_ID,
                    team_id: TEAM_ID,
                    project_id: PROJECT_ID,
                    transport: "openrouter",
                    capability_digest: "captured-digest",
                    capability_snapshot: {
                        ...capability,
                        transport: {
                            ...capability.transport,
                            upstreamRoutingModes: ["auto"],
                        },
                        supportedUpstreamProviders: [],
                    },
                    captured_at: "2026-07-24T02:00:00.000Z",
                    expires_at: "2026-07-24T03:00:00.000Z",
                    credential_available: true,
                },
            ],
        ]);

        const result = await refreshWorkflowLlmCapabilitiesPayload(
            db,
            { mosaicSecretsEncKey: ENC_KEY } as never,
            {
                teamId: TEAM_ID,
                projectId: PROJECT_ID,
                transport: "openrouter",
                providerKeyId: KEY_ID,
                refreshedBy: ACTOR_ID,
            },
            {
                listModels,
                now: () => new Date("2026-07-24T02:00:00.000Z"),
            },
        );

        expect(listModels).toHaveBeenCalledWith(
            {
                openrouter: "stored-openrouter-key",
                openrouterBaseUrl: "https://openrouter.example/v1",
            },
            { provider: "openrouter" },
        );
        expect(result[0]?.snapshot.transport.upstreamRoutingModes).toEqual([
            "auto",
        ]);
        const insert = query.mock.calls.find(([sql]) =>
            String(sql).includes("insert into llm_capability_versions"),
        );
        expect(insert).toBeDefined();
        expect(JSON.stringify(insert)).not.toContain("stored-openrouter-key");
    });

    it("rejects a cross-project default before mutation", async () => {
        const { db, query } = dbWithRows([[{ ok: 1 }], [], []]);
        await expect(
            setWorkflowLlmProjectDefaultPayload(db, {
                teamId: TEAM_ID,
                projectId: PROJECT_ID,
                routeVersionId: VERSION_ID,
                updatedBy: ACTOR_ID,
            }),
        ).rejects.toMatchObject({ code: "not_found" });
        expect(
            query.mock.calls.some(([sql]) =>
                String(sql).includes("insert into project_llm_defaults"),
            ),
        ).toBe(false);
    });

    it("rejects unknown workflow-selection fields before lookup", async () => {
        const { db, query } = dbWithRows([]);
        await expect(
            validateWorkflowLlmSelections(db, TEAM_ID, PROJECT_ID, [
                {
                    nodeKey: "prompt-1",
                    label: "Prompt",
                    promptVersionId: VERSION_ID,
                    modelId: "gpt-4o",
                    evalConfig: { type: "none" },
                    llmExecutionSelection: {
                        mode: "project_default",
                        hiddenRouteId: ROUTE_ID,
                    } as never,
                },
            ]),
        ).rejects.toThrow(/nodes\.0\.llmExecutionSelection/);
        expect(query).not.toHaveBeenCalled();
    });

    it("accepts only active pinned versions from the same project", async () => {
        const { db, query } = dbWithRows([[{ id: VERSION_ID }]]);
        await expect(
            validateWorkflowLlmSelections(db, TEAM_ID, PROJECT_ID, [
                {
                    nodeKey: "prompt-1",
                    label: "Prompt",
                    promptVersionId: VERSION_ID,
                    modelId: "gpt-4o",
                    evalConfig: { type: "none" },
                    llmExecutionSelection: {
                        mode: "pinned_route",
                        routeVersionId: VERSION_ID,
                    },
                },
            ]),
        ).resolves.toBeUndefined();
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("r.disabled_at is null"),
            [[VERSION_ID], TEAM_ID, PROJECT_ID],
        );
    });
});
