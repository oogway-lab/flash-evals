import { Buffer } from "node:buffer";
import type {
    ICreateWorkflowLlmRouteVersionRequest,
    WorkflowLlmTransport,
} from "@flash-evals/api-contract";
import { WORKFLOW_ENV_CREDENTIAL } from "@flash-evals/api-contract";
import {
    bifrostModelListKeyFor,
    installBifrostModelInfo,
    resetBifrostModelInfo,
    type ApiKeys,
} from "@flash-evals/llm-core";
import { encryptSecret } from "@flash-evals/secrets";
import { describe, expect, it, vi } from "vitest";

// Stored base URLs are re-resolved before use; keep the test hosts public.
vi.mock("node:dns/promises", () => ({
    lookup: vi.fn(async () => [{ address: "203.1.1.1", family: 4 }]),
}));
import type { IDb, ITransactionalDb } from "../db.js";
import {
    createWorkflowLlmRouteVersionPayload,
    listWorkflowLlmCapabilitiesPayload,
    listWorkflowLlmRouteCandidatesPayload,
} from "./llmRouting.js";
import { envCredential } from "./llmRoutingCredentials.js";

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
const config = { flashEvalsSecretsEncKey: ENC_KEY } as never;

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
            flashEvalsReuse: "allow",
            providerCaching: "allow",
        },
    },
};

interface IHarnessOptions {
    authorized?: boolean;
    rotationAfterDiscovery?: string;
    existingRoute?: boolean;
    existingCapabilityId?: string;
    /** The Settings key name the stored credential is saved under. */
    provider?: WorkflowLlmTransport | "gemini";
    baseUrl?: string | null;
    /** No key saved in Settings (the key may come from the server's .env). */
    noStoredKey?: boolean;
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
            if (options.noStoredKey) return { rows: [] };
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
            message: expect.stringMatching(
                /Bifrost key saved in Settings has no base URL/i,
            ),
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
                    flashEvalsSecretsEncKey: ENC_KEY,
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
                label: "GLM 5.1",
                modelProvider: "zai",
                modelProviderLabel: "zai",
                support: expect.objectContaining({
                    supportedGenerationControls: [
                        "maxOutputTokens",
                        "temperature",
                        "topP",
                        "seed",
                    ],
                    supportsStructuredOutput: true,
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

    it("lets Bifrost's model list decide thinking and structured output for openrouter/ ids", async () => {
        const harness = createHarness({ provider: "bifrost" });
        resetBifrostModelInfo();
        // Another team's Bifrost says otherwise; its list must not apply.
        installBifrostModelInfo(
            bifrostModelListKeyFor({
                bifrost: "other-team-key",
                bifrostBaseUrl: "https://other-bifrost.example",
            })!,
            [
                {
                    id: "openrouter/minimax/minimax-m3",
                    reasoning: false,
                    structuredOutput: false,
                },
            ],
        );
        // As the real listing does: it remembers this Bifrost's list.
        const listModels = vi.fn(async (apiKeys: ApiKeys) => {
            installBifrostModelInfo(bifrostModelListKeyFor(apiKeys)!, [
                {
                    id: "openrouter/acme/thinker-1",
                    reasoning: true,
                    reasoningEffort: false,
                    structuredOutput: true,
                },
                {
                    id: "openrouter/z-ai/glm-5.2",
                    reasoning: false,
                    reasoningEffort: false,
                    structuredOutput: false,
                },
            ]);
            return [
                { id: "openrouter/acme/thinker-1" },
                { id: "openrouter/z-ai/glm-5.2" },
                { id: "openrouter/minimax/minimax-m3" },
            ];
        });
        try {
            const result = await listWorkflowLlmRouteCandidatesPayload(
                harness.db,
                config,
                PROJECT_ID,
                "bifrost",
                context,
                { listModels },
            );
            const support = Object.fromEntries(
                result.candidates.map((candidate) => [
                    candidate.transportModelId,
                    candidate.support,
                ]),
            );
            expect(support["openrouter/acme/thinker-1"]).toMatchObject({
                supportsStructuredOutput: true,
            });
            expect(
                support["openrouter/acme/thinker-1"]
                    ?.supportedGenerationControls,
            ).toContain("reasoningEffort");
            expect(support["openrouter/z-ai/glm-5.2"]).toMatchObject({
                supportsStructuredOutput: false,
            });
            expect(
                support["openrouter/z-ai/glm-5.2"]?.supportedGenerationControls,
            ).not.toContain("reasoningEffort");
            // Not described by the list: the registry decides.
            expect(support["openrouter/minimax/minimax-m3"]).toMatchObject({
                supportsStructuredOutput: true,
            });
            expect(
                support["openrouter/minimax/minimax-m3"]
                    ?.supportedGenerationControls,
            ).toContain("reasoningEffort");
        } finally {
            resetBifrostModelInfo();
        }
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

        // One candidate per listed Bifrost id (the upstream decides where a
        // call goes), each naming the registry model behind it when known.
        expect(
            result.candidates.map((candidate) => [
                candidate.modelId,
                candidate.transportModelId,
            ]),
        ).toEqual([
            [
                "google/gemma-4-26b-a4b-it",
                "openrouter/google/gemma-4-26b-a4b-it:free",
            ],
            ["google/gemma-4-26b-a4b-it", "gemini/gemma-4-26b-a4b-it"],
            ["google/gemma-3-27b-it", "bedrock/google.gemma-3-27b-it"],
            ["google/gemma-4-31b-it", "gemini/gemma-4-31b-it"],
            ["nvidia/google/codegemma-7b", "nvidia/google/codegemma-7b"],
        ]);

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

describe("workflow LLM direct maker routes", () => {
    const directInput = (
        transport: "anthropic" | "google",
        modelId: string,
    ): ICreateWorkflowLlmRouteVersionRequest => ({
        ...input,
        name: "Direct route",
        config: {
            ...input.config,
            modelId,
            transportConfig: { transport },
            generation: { maxOutputTokens: 512 },
            retry: {
                owner: "flash-evals",
                maxAttempts: 2,
                timeoutMs: 30_000,
                retryableErrorClasses: ["rate_limit"],
            },
        },
    });

    it("lists Anthropic models from the registry without asking Anthropic", async () => {
        const harness = createHarness({ provider: "anthropic", baseUrl: null });
        const listModels = vi.fn(async () => {
            throw new Error("no provider listing for direct makers");
        });

        const result = await listWorkflowLlmRouteCandidatesPayload(
            harness.db,
            config,
            PROJECT_ID,
            "anthropic",
            context,
            { listModels, now: () => NOW },
        );

        expect(listModels).not.toHaveBeenCalled();
        expect(result.candidates.map((candidate) => candidate.modelId)).toEqual(
            [
                "anthropic/claude-opus-5.5",
                "anthropic/claude-sonnet-5.5",
                "anthropic/claude-haiku-5.5",
                "anthropic/claude-sonnet-4.6",
            ],
        );
        expect(result.candidates[0]).toMatchObject({
            transport: "anthropic",
            support: {
                upstreamRoutingModes: ["none"],
                supportedGenerationControls: [
                    "maxOutputTokens",
                    "reasoningEffort",
                ],
                supportsStructuredOutput: true,
            },
        });
        const keyLookup = harness.query.mock.calls.find(
            ([sql]) =>
                String(sql).includes("from provider_keys") &&
                String(sql).includes("ciphertext"),
        );
        expect(keyLookup?.[1]).toEqual([TEAM_ID, "anthropic", null]);
        expect(JSON.stringify(result)).not.toContain("stored-openrouter-key");
    });

    it("uses the saved Gemini key for Gemini API routes", async () => {
        const harness = createHarness({ provider: "gemini", baseUrl: null });

        const result = await listWorkflowLlmRouteCandidatesPayload(
            harness.db,
            config,
            PROJECT_ID,
            "google",
            context,
            { now: () => NOW },
        );

        expect(result.candidates.map((candidate) => candidate.modelId)).toEqual(
            [
                "google/gemini-3-flash",
                "google/gemini-3.5-flash-lite",
                "google/gemma-4-31b-it",
            ],
        );
        const keyLookup = harness.query.mock.calls.find(
            ([sql]) =>
                String(sql).includes("from provider_keys") &&
                String(sql).includes("ciphertext"),
        );
        expect(keyLookup?.[1]).toEqual([TEAM_ID, "gemini", null]);
    });

    it("creates an Anthropic route whose capability records the maker's own model id", async () => {
        const harness = createHarness({ provider: "anthropic", baseUrl: null });

        const route = await createWorkflowLlmRouteVersionPayload(
            harness.db,
            config,
            directInput("anthropic", "anthropic/claude-sonnet-4.6"),
            context,
            { now: () => NOW },
        );

        expect(route.latestVersion?.capabilityVersionId).toBeTruthy();
        const capabilityWrite = harness.query.mock.calls.find(([sql]) =>
            String(sql).includes("insert into llm_capability_versions"),
        );
        const values = capabilityWrite?.[1] as unknown[];
        expect(values[3]).toBe("anthropic");
        expect(JSON.parse(String(values[5]))).toMatchObject({
            transport: {
                transport: "anthropic",
                modelId: "anthropic/claude-sonnet-4.6",
                transportModelId: "claude-sonnet-4-6",
                upstreamRoutingModes: ["none"],
                requiresCurrentDiscovery: false,
            },
        });
        const credentialCheck = harness.query.mock.calls.find(
            ([sql]) =>
                String(sql).includes("from provider_keys") &&
                String(sql).includes("for update"),
        );
        expect(credentialCheck?.[1]).toEqual([KEY_ID, TEAM_ID, "anthropic"]);
    });

    it("checks a Gemini API route against the Gemini key and refuses unlisted models", async () => {
        const harness = createHarness({ provider: "gemini", baseUrl: null });

        await expect(
            createWorkflowLlmRouteVersionPayload(
                harness.db,
                config,
                directInput("google", "google/gemini-3-flash"),
                context,
                { now: () => NOW },
            ),
        ).resolves.toMatchObject({ id: ROUTE_ID });
        const credentialCheck = harness.query.mock.calls.find(
            ([sql]) =>
                String(sql).includes("from provider_keys") &&
                String(sql).includes("for update"),
        );
        expect(credentialCheck?.[1]).toEqual([KEY_ID, TEAM_ID, "gemini"]);

        const unlisted = createHarness({ provider: "gemini", baseUrl: null });
        await expect(
            createWorkflowLlmRouteVersionPayload(
                unlisted.db,
                config,
                directInput("google", "google/gemini-2.5-pro"),
                context,
                { now: () => NOW },
            ),
        ).rejects.toMatchObject({ path: "config.modelId" });
        expect(unlisted.writes).toEqual([]);
    });
});

describe("workflow LLM routing with Bifrost's key from the server's .env", () => {
    const envConfig = {
        flashEvalsSecretsEncKey: ENC_KEY,
        bifrostApiKey: "env-bifrost-key",
        bifrostBaseUrl: "https://bifrost.example/v1",
    } as never;
    const bifrostInput: ICreateWorkflowLlmRouteVersionRequest = {
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
    };

    it("lists Bifrost's models with the env key when no key is saved in Settings", async () => {
        const harness = createHarness({
            provider: "bifrost",
            noStoredKey: true,
        });
        const listModels = vi.fn(async () => [
            { id: "openrouter/google/gemma-4-26b-a4b-it" },
        ]);

        const result = await listWorkflowLlmRouteCandidatesPayload(
            harness.db,
            envConfig,
            PROJECT_ID,
            "bifrost",
            context,
            { listModels },
        );

        expect(listModels).toHaveBeenCalledWith(
            {
                bifrost: "env-bifrost-key",
                bifrostBaseUrl: "https://bifrost.example/v1",
            },
            { provider: "bifrost" },
        );
        expect(result.candidates.map((c) => c.transportModelId)).toEqual([
            "openrouter/google/gemma-4-26b-a4b-it",
        ]);
        expect(harness.writes).toEqual([]);
    });

    it("prefers the key saved in Settings over the env key", async () => {
        const harness = createHarness({
            provider: "bifrost",
            baseUrl: "https://saved-bifrost.example/v1",
        });
        const listModels = vi.fn(async () => [{ id: "openai/gpt-4o" }]);

        await listWorkflowLlmRouteCandidatesPayload(
            harness.db,
            envConfig,
            PROJECT_ID,
            "bifrost",
            context,
            { listModels },
        );

        expect(listModels).toHaveBeenCalledWith(
            {
                bifrost: "stored-openrouter-key",
                bifrostBaseUrl: "https://saved-bifrost.example/v1",
            },
            { provider: "bifrost" },
        );
    });

    it("refuses a saved Bifrost key without an address (never the env one)", async () => {
        const harness = createHarness({ provider: "bifrost", baseUrl: null });
        const listModels = vi.fn(async () => [{ id: "openai/gpt-4o" }]);

        await expect(
            listWorkflowLlmRouteCandidatesPayload(
                harness.db,
                envConfig,
                PROJECT_ID,
                "bifrost",
                context,
                { listModels },
            ),
        ).rejects.toThrow(/no base URL/);
        expect(listModels).not.toHaveBeenCalled();
    });

    it("is not found when neither Settings nor the env has a Bifrost key", async () => {
        const harness = createHarness({
            provider: "bifrost",
            noStoredKey: true,
        });
        const listModels = vi.fn();

        await expect(
            listWorkflowLlmRouteCandidatesPayload(
                harness.db,
                config,
                PROJECT_ID,
                "bifrost",
                context,
                { listModels },
            ),
        ).rejects.toMatchObject({ code: "not_found" });
        expect(listModels).not.toHaveBeenCalled();
    });

    it("does not use the Bifrost env key for other providers", async () => {
        const harness = createHarness({ noStoredKey: true });
        const listModels = vi.fn();

        await expect(
            listWorkflowLlmRouteCandidatesPayload(
                harness.db,
                envConfig,
                PROJECT_ID,
                "openrouter",
                context,
                { listModels },
            ),
        ).rejects.toMatchObject({ code: "not_found" });
        expect(listModels).not.toHaveBeenCalled();
    });

    it("refuses a saved route with the env key in plain words and writes nothing", async () => {
        const harness = createHarness({
            provider: "bifrost",
            noStoredKey: true,
        });

        await expect(
            createWorkflowLlmRouteVersionPayload(
                harness.db,
                envConfig,
                bifrostInput,
                context,
                {
                    listModels: vi.fn(async () => [
                        { id: "openrouter/google/gemma-4-26b-a4b-it" },
                    ]),
                },
            ),
        ).rejects.toMatchObject({
            code: "bad_request",
            message: expect.stringMatching(/saved in Settings.*Simple mode/),
        });
        expect(harness.writes).toEqual([]);
    });

    it("reports Bifrost's key as available when it comes from the env", async () => {
        const row = {
            id: VERSION_ID,
            team_id: TEAM_ID,
            project_id: PROJECT_ID,
            transport: "bifrost",
            capability_digest: "digest",
            capability_snapshot: {},
            captured_at: NOW,
            expires_at: NOW,
            credential_available: false,
        };
        const db = {
            query: vi.fn(async (sql: string) =>
                String(sql).includes("from projects")
                    ? { rows: [{ ok: 1 }] }
                    : { rows: [row, { ...row, transport: "openrouter" }] },
            ),
        } as unknown as IDb;

        const withEnv = await listWorkflowLlmCapabilitiesPayload(
            db,
            TEAM_ID,
            PROJECT_ID,
            envConfig,
        );
        const withoutEnv = await listWorkflowLlmCapabilitiesPayload(
            db,
            TEAM_ID,
            PROJECT_ID,
        );

        expect(withEnv.map((c) => c.credentialAvailable)).toEqual([
            true,
            false,
        ]);
        expect(withoutEnv.map((c) => c.credentialAvailable)).toEqual([
            false,
            false,
        ]);
    });
});

describe("workflow LLM routing with the Vercel AI Gateway key from the server's .env", () => {
    const gatewayEnvConfig = {
        flashEvalsSecretsEncKey: ENC_KEY,
        aiGatewayApiKey: "env-gateway-key",
    } as never;

    it("lists the gateway's models with the env key when no key is saved in Settings", async () => {
        const harness = createHarness({
            provider: "gateway",
            noStoredKey: true,
        });
        const listModels = vi.fn(async () => [{ id: "openai/gpt-4o" }]);

        await listWorkflowLlmRouteCandidatesPayload(
            harness.db,
            gatewayEnvConfig,
            PROJECT_ID,
            "gateway",
            context,
            { listModels },
        );

        expect(listModels).toHaveBeenCalledWith(
            { gateway: "env-gateway-key" },
            { provider: "gateway" },
        );
        expect(harness.writes).toEqual([]);
    });

    it("prefers the key saved in Settings over the env key", async () => {
        const harness = createHarness({ provider: "gateway", baseUrl: null });
        const listModels = vi.fn(async () => [{ id: "openai/gpt-4o" }]);

        await listWorkflowLlmRouteCandidatesPayload(
            harness.db,
            gatewayEnvConfig,
            PROJECT_ID,
            "gateway",
            context,
            { listModels },
        );

        expect(listModels).toHaveBeenCalledWith(
            { gateway: "stored-openrouter-key" },
            { provider: "gateway" },
        );
    });

    it("is not found when neither Settings nor the env has a gateway key", async () => {
        const harness = createHarness({
            provider: "gateway",
            noStoredKey: true,
        });
        const listModels = vi.fn();

        await expect(
            listWorkflowLlmRouteCandidatesPayload(
                harness.db,
                config,
                PROJECT_ID,
                "gateway",
                context,
                { listModels },
            ),
        ).rejects.toMatchObject({ code: "not_found" });
        expect(listModels).not.toHaveBeenCalled();
    });

    it("reports the gateway's key as available when it comes from the env", async () => {
        const row = {
            id: VERSION_ID,
            team_id: TEAM_ID,
            project_id: PROJECT_ID,
            transport: "gateway",
            capability_digest: "digest",
            capability_snapshot: {},
            captured_at: NOW,
            expires_at: NOW,
            credential_available: false,
        };
        const db = {
            query: vi.fn(async (sql: string) =>
                String(sql).includes("from projects")
                    ? { rows: [{ ok: 1 }] }
                    : {
                          rows: [
                              row,
                              { ...row, transport: "bifrost" },
                              { ...row, transport: "openrouter" },
                          ],
                      },
            ),
        } as unknown as IDb;

        const capabilities = await listWorkflowLlmCapabilitiesPayload(
            db,
            TEAM_ID,
            PROJECT_ID,
            gatewayEnvConfig,
        );

        expect(capabilities.map((c) => c.credentialAvailable)).toEqual([
            true,
            false,
            false,
        ]);
    });
});

describe("envCredential", () => {
    it("builds the gateway's keys from AI_GATEWAY_API_KEY with no address", () => {
        expect(
            envCredential("gateway", { aiGatewayApiKey: "env-gw" }, undefined),
        ).toEqual({
            providerKeyId: WORKFLOW_ENV_CREDENTIAL.providerKeyId,
            rotationVersion: WORKFLOW_ENV_CREDENTIAL.rotationVersion,
            apiKeys: { gateway: "env-gw" },
        });
    });

    it("is undefined with no env key, when a saved key is asked for, or for other providers", () => {
        expect(envCredential("gateway", {}, undefined)).toBeUndefined();
        expect(
            envCredential("gateway", { aiGatewayApiKey: "env-gw" }, KEY_ID),
        ).toBeUndefined();
        expect(
            envCredential("openai", { aiGatewayApiKey: "env-gw" }, undefined),
        ).toBeUndefined();
    });

    it("still needs Bifrost's address", () => {
        expect(() =>
            envCredential("bifrost", { bifrostApiKey: "env-bf" }, undefined),
        ).toThrow(/BIFROST_BASE_URL/);
    });
});
