import { Buffer } from "node:buffer";
import type {
    ICreateWorkflowLlmRouteVersionRequest,
    WorkflowLlmTransport,
} from "@mosaic/api-contract";
import { encryptSecret } from "@mosaic/secrets";
import { describe, expect, it, vi } from "vitest";

// Stored base URLs are re-resolved before use; keep the test hosts public.
vi.mock("node:dns/promises", () => ({
    lookup: vi.fn(async () => [{ address: "203.1.1.1", family: 4 }]),
}));
import type { IDb, ITransactionalDb } from "../db.js";
import {
    createWorkflowLlmRouteVersionPayload,
    listWorkflowLlmRouteCandidatesPayload,
} from "./llmRouting.js";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const KEY_ID = "44444444-4444-4444-8444-444444444444";
const ROUTE_ID = "66666666-6666-4666-8666-666666666666";
const VERSION_ID = "77777777-7777-4777-8777-777777777777";
const ROTATION_ID = "88888888-8888-4888-8888-888888888888";
const ROTATED_ID = "99999999-9999-4999-8999-999999999999";
const ENC_KEY = Buffer.alloc(32, 9).toString("base64");
const NOW = new Date("2026-07-27T10:00:00.000Z");
const context = { teamId: TEAM_ID, actorId: ACTOR_ID };
const config = { mosaicSecretsEncKey: ENC_KEY } as never;

const input: ICreateWorkflowLlmRouteVersionRequest = {
    projectId: PROJECT_ID,
    name: "OpenRouter route",
    config: {
        modelId: "gpt-4o",
        transportConfig: {
            transport: "openrouter",
            upstreamPolicy: { mode: "auto" },
            requireParameters: true,
            responseCache: "allow",
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

interface IHarnessOptions {
    authorized?: boolean;
    rotationAfterDiscovery?: string;
    existingRoute?: boolean;
    existingCapabilityId?: string;
    provider?: WorkflowLlmTransport;
    baseUrl?: string | null;
}

function createHarness(options: IHarnessOptions = {}) {
    const provider = options.provider ?? "openrouter";
    const encrypted = encryptSecret(
        "stored-openrouter-key",
        { teamId: TEAM_ID, provider },
        ENC_KEY,
    );
    const writes: string[] = [];
    let authorizationChecks = 0;
    let routeVersion = options.existingRoute ? 2 : 1;
    let capabilityId = "";

    const query = vi.fn(async (sqlValue: string, values?: unknown[]) => {
        const sql = String(sqlValue);
        if (sql.includes("join users u")) {
            authorizationChecks += 1;
            return { rows: options.authorized === false ? [] : [{ ok: 1 }] };
        }
        if (sql.includes("from provider_keys") && sql.includes("ciphertext")) {
            return {
                rows: [
                    {
                        id: KEY_ID,
                        provider,
                        rotationVersion: ROTATION_ID,
                        ...encrypted,
                        authTag: encrypted.authTag,
                        baseUrl:
                            options.baseUrl === undefined
                                ? "https://openrouter.example/v1"
                                : options.baseUrl,
                    },
                ],
            };
        }
        if (sql.includes("from provider_keys") && sql.includes("for update")) {
            return {
                rows: [
                    {
                        id: KEY_ID,
                        rotationVersion:
                            options.rotationAfterDiscovery ?? ROTATION_ID,
                    },
                ],
            };
        }
        if (sql.includes("insert into llm_capability_versions")) {
            writes.push("capability");
            capabilityId = String(values?.[0]);
            return {
                rows: options.existingCapabilityId
                    ? []
                    : [{ id: capabilityId }],
            };
        }
        if (
            sql.includes("select id from llm_capability_versions") &&
            sql.includes("capability_digest")
        ) {
            capabilityId = options.existingCapabilityId ?? "";
            return { rows: capabilityId ? [{ id: capabilityId }] : [] };
        }
        if (
            sql.includes("select id, disabled_at from llm_routes") &&
            sql.includes("for update")
        ) {
            return {
                rows: options.existingRoute
                    ? [{ id: ROUTE_ID, disabled_at: null }]
                    : [],
            };
        }
        if (sql.includes("insert into llm_routes")) {
            writes.push("route");
            return { rows: [{ id: ROUTE_ID }] };
        }
        if (sql.includes("coalesce(max(version)")) {
            return { rows: [{ next_version: routeVersion }] };
        }
        if (sql.includes("insert into llm_route_versions")) {
            writes.push("route_version");
            routeVersion = Number(values?.[3]);
            return { rows: [] };
        }
        if (sql.includes("from llm_routes r")) {
            return {
                rows: [
                    {
                        id: ROUTE_ID,
                        team_id: TEAM_ID,
                        project_id: PROJECT_ID,
                        name: input.name,
                        disabled_at: null,
                        created_by: ACTOR_ID,
                        created_at: NOW,
                        version_id: VERSION_ID,
                        version: routeVersion,
                        config: input.config,
                        provider_key_id: KEY_ID,
                        provider_key_rotation_version:
                            options.rotationAfterDiscovery ?? ROTATION_ID,
                        capability_version_id: capabilityId,
                        version_created_by: ACTOR_ID,
                        version_created_at: NOW,
                    },
                ],
            };
        }
        throw new Error(`Unexpected SQL in test: ${sql}`);
    });
    const db: ITransactionalDb = {
        query: query as unknown as IDb["query"],
        transaction: async (run) => run({ query: query as never }),
    };
    return {
        db,
        query,
        writes,
        authorizationChecks: () => authorizationChecks,
    };
}

describe("workflow LLM live route discovery", () => {
    it("discovers from the stored credential and creates evidence before the first route version", async () => {
        const harness = createHarness();
        const listModels = vi.fn(async () => [{ id: "openai/gpt-4o" }]);

        const route = await createWorkflowLlmRouteVersionPayload(
            harness.db,
            config,
            input,
            context,
            { listModels, now: () => NOW },
        );

        expect(listModels).toHaveBeenCalledWith(
            {
                openrouter: "stored-openrouter-key",
                openrouterBaseUrl: "https://openrouter.example/v1",
            },
            { provider: "openrouter" },
        );
        expect(harness.writes).toEqual([
            "capability",
            "route",
            "route_version",
        ]);
        expect(route.latestVersion).toMatchObject({
            version: 1,
            providerKeyId: KEY_ID,
            providerKeyRotationVersion: ROTATION_ID,
        });
        expect(route.latestVersion?.capabilityVersionId).toBeTruthy();
    });

    it("appends an immutable version to an existing route and still performs live discovery", async () => {
        const harness = createHarness({ existingRoute: true });
        const listModels = vi.fn(async () => [{ id: "openai/gpt-4o" }]);

        const route = await createWorkflowLlmRouteVersionPayload(
            harness.db,
            config,
            { ...input, routeId: ROUTE_ID },
            context,
            { listModels, now: () => NOW },
        );

        expect(listModels).toHaveBeenCalledTimes(1);
        expect(harness.writes).toEqual(["capability", "route_version"]);
        expect(route.latestVersion?.version).toBe(2);
        expect(
            harness.query.mock.calls.some(([sql]) =>
                String(sql).includes("update llm_route_versions"),
            ),
        ).toBe(false);
    });

    it("reuses immutable evidence without updating a conflicting capability row", async () => {
        const existingCapabilityId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        const harness = createHarness({ existingCapabilityId });

        const route = await createWorkflowLlmRouteVersionPayload(
            harness.db,
            config,
            input,
            context,
            {
                listModels: vi.fn(async () => [{ id: "openai/gpt-4o" }]),
                now: () => NOW,
            },
        );

        const capabilityInsert = harness.query.mock.calls.find(([sql]) =>
            String(sql).includes("insert into llm_capability_versions"),
        );
        expect(String(capabilityInsert?.[0])).toContain(
            "on conflict (project_id, capability_digest) do nothing",
        );
        expect(String(capabilityInsert?.[0])).not.toContain("do update");
        expect(
            harness.query.mock.calls.some(([sql]) =>
                String(sql).includes("select id from llm_capability_versions"),
            ),
        ).toBe(true);
        expect(route.latestVersion?.capabilityVersionId).toBe(
            existingCapabilityId,
        );
    });

    it("does not reuse a prior fresh capability instead of provider discovery", async () => {
        const harness = createHarness();
        const listModels = vi.fn(async () => [{ id: "openai/gpt-4o" }]);

        await createWorkflowLlmRouteVersionPayload(
            harness.db,
            config,
            input,
            context,
            { listModels, now: () => NOW },
        );

        expect(listModels).toHaveBeenCalledTimes(1);
        expect(
            harness.query.mock.calls.some(([sql]) =>
                String(sql).includes("expires_at > now()"),
            ),
        ).toBe(false);
    });

    it("rejects unsupported models without writing capability or route state", async () => {
        const harness = createHarness();

        await expect(
            createWorkflowLlmRouteVersionPayload(
                harness.db,
                config,
                input,
                context,
                {
                    listModels: vi.fn(async () => [
                        { id: "google/gemini-2.5-pro" },
                    ]),
                    now: () => NOW,
                },
            ),
        ).rejects.toMatchObject({
            code: "invalid_llm_routing",
            path: "config.modelId",
        });
        expect(harness.writes).toEqual([]);
    });

    it("sanitizes provider failures and writes nothing", async () => {
        const harness = createHarness();

        await expect(
            createWorkflowLlmRouteVersionPayload(
                harness.db,
                config,
                input,
                context,
                {
                    listModels: vi.fn(async () => {
                        throw new Error(
                            "401 key=stored-openrouter-key upstream body",
                        );
                    }),
                },
            ),
        ).rejects.toMatchObject({
            code: "conflict",
            message:
                "The provider model list is temporarily unavailable. Try again.",
        });
        expect(harness.writes).toEqual([]);
    });

    it("refuses a stored base URL that now resolves to a private address", async () => {
        const harness = createHarness();
        const listModels = vi.fn();

        await expect(
            listWorkflowLlmRouteCandidatesPayload(
                harness.db,
                config,
                PROJECT_ID,
                "openrouter",
                context,
                {
                    listModels,
                    resolveHost: vi.fn(async () => ["10.0.0.5"]),
                },
            ),
        ).rejects.toMatchObject({
            code: "bad_request",
            message: expect.stringMatching(/no longer allowed/i),
        });
        expect(listModels).not.toHaveBeenCalled();
    });

    it("returns a retryable 503 when the stored base URL host cannot be resolved", async () => {
        const harness = createHarness();
        const listModels = vi.fn();

        await expect(
            listWorkflowLlmRouteCandidatesPayload(
                harness.db,
                config,
                PROJECT_ID,
                "openrouter",
                context,
                {
                    listModels,
                    resolveHost: vi.fn(async () => {
                        throw new Error("ENOTFOUND");
                    }),
                },
            ),
        ).rejects.toMatchObject({
            status: 503,
            code: "service_unavailable",
        });
        expect(listModels).not.toHaveBeenCalled();
    });

    it("explains a legacy Bifrost credential that has no base URL", async () => {
        const harness = createHarness({ provider: "bifrost", baseUrl: null });

        await expect(
            listWorkflowLlmRouteCandidatesPayload(
                harness.db,
                config,
                PROJECT_ID,
                "bifrost",
                context,
                { listModels: vi.fn() },
            ),
        ).rejects.toMatchObject({
            code: "bad_request",
            message: expect.stringMatching(/Bifrost needs a base URL/i),
        });
        expect(harness.writes).toEqual([]);
    });

    it("rejects credential rotation after discovery without persisting evidence", async () => {
        const harness = createHarness({ rotationAfterDiscovery: ROTATED_ID });

        await expect(
            createWorkflowLlmRouteVersionPayload(
                harness.db,
                config,
                input,
                context,
                {
                    listModels: vi.fn(async () => [{ id: "openai/gpt-4o" }]),
                },
            ),
        ).rejects.toMatchObject({
            code: "conflict",
            message:
                "The provider credential changed during model discovery. Try again.",
        });
        expect(harness.writes).toEqual([]);
    });

    it("denies cross-scope access before calling the provider", async () => {
        const harness = createHarness({ authorized: false });
        const listModels = vi.fn(async () => [{ id: "openai/gpt-4o" }]);

        await expect(
            createWorkflowLlmRouteVersionPayload(
                harness.db,
                config,
                input,
                context,
                { listModels },
            ),
        ).rejects.toMatchObject({ code: "not_found" });
        expect(listModels).not.toHaveBeenCalled();
        expect(harness.query).toHaveBeenCalledTimes(1);
    });

    it("applies the write gate before authorization or provider discovery", async () => {
        const harness = createHarness();
        const listModels = vi.fn(async () => [{ id: "openai/gpt-4o" }]);

        await expect(
            createWorkflowLlmRouteVersionPayload(
                harness.db,
                {
                    workflowLlmWritesEnabled: false,
                    mosaicSecretsEncKey: ENC_KEY,
                } as never,
                input,
                context,
                { listModels },
            ),
        ).rejects.toMatchObject({ code: "conflict" });
        expect(harness.query).not.toHaveBeenCalled();
        expect(listModels).not.toHaveBeenCalled();
    });

    it("returns every model observed in the live provider listing", async () => {
        const harness = createHarness();

        const result = await listWorkflowLlmRouteCandidatesPayload(
            harness.db,
            config,
            PROJECT_ID,
            "openrouter",
            context,
            {
                listModels: vi.fn(async () => [
                    { id: "openai/gpt-4o" },
                    { id: "provider/unregistered-new-model" },
                ]),
            },
        );

        expect(result).toMatchObject({
            transport: "openrouter",
            coverage: "provider_model_listing",
        });
        expect(result.candidates.map((candidate) => candidate.modelId)).toEqual(
            ["gpt-4o", "provider/unregistered-new-model"],
        );
        expect(result.candidates[0]?.support.upstreamRoutingModes).toEqual([
            "auto",
        ]);
        expect(JSON.stringify(result)).not.toContain("stored-openrouter-key");
    });

    it("creates a Gateway route for a provider-listed GLM model", async () => {
        const harness = createHarness({ provider: "gateway" });
        const listModels = vi.fn(async () => [{ id: "zai/glm-5.1" }]);

        const candidates = await listWorkflowLlmRouteCandidatesPayload(
            harness.db,
            config,
            PROJECT_ID,
            "gateway",
            context,
            { listModels },
        );
        expect(candidates.candidates).toEqual([
            expect.objectContaining({
                modelId: "zai/glm-5.1",
                label: "Glm 5.1",
                modelProvider: "zai",
                modelProviderLabel: "Zai",
                support: expect.objectContaining({
                    supportedGenerationControls: ["maxOutputTokens"],
                    supportsStructuredOutput: false,
                }),
            }),
        ]);

        await expect(
            createWorkflowLlmRouteVersionPayload(
                harness.db,
                config,
                {
                    ...input,
                    config: {
                        ...input.config,
                        modelId: "zai/glm-5.1",
                        transportConfig: {
                            transport: "gateway",
                            upstreamPolicy: { mode: "gateway_auto" },
                            modelFallback: "disabled",
                        },
                        generation: { maxOutputTokens: 512 },
                    },
                },
                context,
                { listModels },
            ),
        ).resolves.toMatchObject({ id: ROUTE_ID });
        const capabilityWrite = harness.query.mock.calls.find(([sql]) =>
            String(sql).includes("insert into llm_capability_versions"),
        );
        expect(
            JSON.parse(String((capabilityWrite?.[1] as unknown[])?.[5])),
        ).toMatchObject({
            transport: {
                modelId: "zai/glm-5.1",
                transportModelId: "zai/glm-5.1",
            },
        });
    });

    it("recognizes Bifrost upstream model prefixes and preserves their exact execution IDs", async () => {
        const harness = createHarness({ provider: "bifrost" });

        const result = await listWorkflowLlmRouteCandidatesPayload(
            harness.db,
            config,
            PROJECT_ID,
            "bifrost",
            context,
            {
                listModels: vi.fn(async () => [
                    { id: "openrouter/google/gemma-4-26b-a4b-it:free" },
                    { id: "gemini/gemma-4-26b-a4b-it" },
                    { id: "bedrock/google.gemma-3-27b-it" },
                    { id: "gemini/gemma-4-31b-it" },
                    { id: "nvidia/google/codegemma-7b" },
                ]),
            },
        );

        expect(result.candidates.map((candidate) => candidate.modelId)).toEqual(
            [
                "google/gemma-4-26b-a4b-it",
                "google/gemma-3-27b-it",
                "google/gemma-4-31b-it",
                "nvidia/google/codegemma-7b",
            ],
        );

        const route = await createWorkflowLlmRouteVersionPayload(
            harness.db,
            config,
            {
                ...input,
                config: {
                    ...input.config,
                    modelId: "google/gemma-4-26b-a4b-it",
                    transportConfig: {
                        ...input.config.transportConfig,
                        transport: "bifrost",
                        upstreamPolicy: { mode: "bifrost_default" },
                    },
                },
            },
            context,
            {
                listModels: vi.fn(async () => [
                    { id: "openrouter/google/gemma-4-26b-a4b-it:free" },
                    { id: "gemini/gemma-4-26b-a4b-it" },
                ]),
            },
        );

        expect(route.latestVersion?.capabilityVersionId).toBeTruthy();
        const capabilityWrite = harness.query.mock.calls.find(([sql]) =>
            String(sql).includes("insert into llm_capability_versions"),
        );
        const capabilitySnapshot = JSON.parse(
            String((capabilityWrite?.[1] as unknown[])?.[5]),
        );
        expect(capabilitySnapshot.transport).toMatchObject({
            modelId: "google/gemma-4-26b-a4b-it",
            transportModelId: "gemini/gemma-4-26b-a4b-it",
        });
    });
});
