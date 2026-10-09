import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@mosaic/llm-core";
import {
    MosaicApiClient,
    type ICreateWorkflowLlmRouteVersionRequest,
} from "@mosaic/api-contract";

vi.mock("@mosaic/llm-core", async (importOriginal) => {
    const actual = await importOriginal<typeof LlmCore>();
    return {
        ...actual,
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

import { handleRequest } from "./server.js";
import type { IApiConfig } from "./config.js";
import type { IDb } from "./db.js";
import { resolveApiFeatureFlags } from "./featureFlags.js";

const config: IApiConfig = {
    nodeEnv: "test",
    port: 3001,
    databaseUrl: "postgres://user:pass@example.supabase.co:5432/postgres",
    storageAdapter: "supabase",
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role",
    supabaseStorageBucket: "mosaic-images",
    clerkSecretKey: "sk_test",
    mosaicTenancyMode: "single-org",
    mosaicAllowedEmailDomain: "example.com",
    corsOrigins: ["https://web.example.com"],
    mosaicLlmProvider: "openai",
    openaiApiKey: "test-openai",
    internalApiToken: "internal-secret",
    sttCapabilityProbes: {},
    profilingEnabled: false,
    mosaicMcpEnabled: false,
    mosaicMcpAllowedOrigins: [],
    featureFlags: resolveApiFeatureFlags({}),
};

const ROUTING_TEAM_ID = "11111111-1111-4111-8111-111111111111";
const ROUTING_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ROUTING_ACTOR_ID = "33333333-3333-4333-8333-333333333333";

function semanticRouteBody(): ICreateWorkflowLlmRouteVersionRequest {
    return {
        projectId: ROUTING_PROJECT_ID,
        name: "Live discovered route",
        config: {
            modelId: "gpt-4o",
            transportConfig: {
                transport: "openrouter",
                upstreamPolicy: { mode: "auto" },
                requireParameters: true,
                responseCache: "allow",
            },
            generation: { maxOutputTokens: 256 },
            structuredOutput: { mode: "text" },
            retry: { owner: "gateway", timeoutMs: 30_000 },
            cache: {
                mosaicReuse: "allow",
                providerCaching: "allow",
            },
        },
    };
}

function dbWithRows(rows: unknown[][] = []): IDb {
    return {
        query: vi.fn(async () => ({ rows: rows.shift() ?? [] }) as never),
    };
}

// Rejected requests log a structured `request.failed` line (warn for 4xx, error
// for 5xx). Capture it so expected rejections don't flood the test output.
beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("handleRequest", () => {
    it("sends routing identity as internal headers instead of public JSON", async () => {
        const fetcher = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) =>
                Response.json({
                    id: "route-id",
                    teamId: ROUTING_TEAM_ID,
                    projectId: ROUTING_PROJECT_ID,
                    name: "Live discovered route",
                    createdAt: "2026-07-27T00:00:00.000Z",
                }),
        );
        const client = new MosaicApiClient({
            baseUrl: "https://api.example.com",
            internalToken: "internal-secret",
            fetcher: fetcher as typeof fetch,
        });
        const body = semanticRouteBody();

        await client.createWorkflowLlmRouteVersion(body, {
            teamId: ROUTING_TEAM_ID,
            actorId: ROUTING_ACTOR_ID,
        });

        const [, init] = fetcher.mock.calls[0]!;
        expect(JSON.parse(String(init?.body))).toEqual(body);
        expect(JSON.parse(String(init?.body))).not.toHaveProperty("teamId");
        expect(init?.headers).toMatchObject({
            "X-Mosaic-Internal-Token": "internal-secret",
            "X-Mosaic-Team-Id": ROUTING_TEAM_ID,
            "X-Mosaic-Actor-Id": ROUTING_ACTOR_ID,
        });
    });

    it("rate limits LLM-cost routes per user with 429 and Retry-After", async () => {
        const db = {
            query: vi.fn(async (sql: string) =>
                sql.includes("insert into api_rate_limits")
                    ? { rows: [{ requestCount: 21, retryAfterSeconds: 12 }] }
                    : { rows: [] },
            ),
        } as unknown as IDb;
        const response = await handleRequest(
            new Request("https://api.example.com/api/prompts/optimize", {
                method: "POST",
                headers: {
                    "x-mosaic-internal-token": "internal-secret",
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    teamId: ROUTING_TEAM_ID,
                    projectId: ROUTING_PROJECT_ID,
                    createdBy: ROUTING_ACTOR_ID,
                }),
            }),
            { config, db },
        );

        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("12");
        await expect(response.json()).resolves.toMatchObject({
            error: "rate_limited",
            message: expect.stringContaining("the limit is 20 per minute"),
        });
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(db.query).toHaveBeenCalledWith(expect.any(String), [
            `llm:${ROUTING_TEAM_ID}:${ROUTING_ACTOR_ID}`,
            60,
        ]);
    });

    it("surfaces 429s to the typed client with the retry delay and actor bucket", async () => {
        const db = {
            query: vi.fn(async (sql: string) =>
                sql.includes("insert into api_rate_limits")
                    ? { rows: [{ requestCount: 11, retryAfterSeconds: 7 }] }
                    : { rows: [] },
            ),
        } as unknown as IDb;
        const client = new MosaicApiClient({
            baseUrl: "https://api.example.com",
            internalToken: "internal-secret",
            fetcher: (async (input: RequestInfo | URL, init?: RequestInit) =>
                handleRequest(new Request(input, init), {
                    config,
                    db,
                })) as typeof fetch,
        });

        const rejection = client.retryRun(
            {
                teamId: ROUTING_TEAM_ID,
                projectId: ROUTING_PROJECT_ID,
                runId: "run-1",
            },
            { teamId: ROUTING_TEAM_ID, actorId: ROUTING_ACTOR_ID },
        );

        await expect(rejection).rejects.toMatchObject({
            name: "MosaicApiError",
            status: 429,
            code: "rate_limited",
            retryAfterSeconds: 7,
            message: expect.stringContaining("Too many run requests"),
        });
        expect(db.query).toHaveBeenCalledWith(expect.any(String), [
            `runs:${ROUTING_TEAM_ID}:${ROUTING_ACTOR_ID}`,
            60,
        ]);
    });

    it("rejects unauthenticated LLM-cost calls before counting them", async () => {
        const db = dbWithRows();
        const response = await handleRequest(
            new Request("https://api.example.com/api/prompts/optimize", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ teamId: ROUTING_TEAM_ID }),
            }),
            { config, db },
        );

        expect(response.status).toBe(401);
        expect(db.query).not.toHaveBeenCalled();
    });

    it("requires trusted route-authoring scope outside the public JSON body", async () => {
        const db = dbWithRows();
        const response = await handleRequest(
            new Request("https://api.example.com/api/llm-routing/routes", {
                method: "POST",
                headers: {
                    "x-mosaic-internal-token": "internal-secret",
                    "content-type": "application/json",
                },
                body: JSON.stringify(semanticRouteBody()),
            }),
            { config, db },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: "bad_request",
            message: expect.stringContaining("trusted routing context"),
        });
        expect(db.query).not.toHaveBeenCalled();
    });

    it("derives route-authoring scope from authenticated internal headers", async () => {
        const db = dbWithRows([[]]);
        const response = await handleRequest(
            new Request("https://api.example.com/api/llm-routing/routes", {
                method: "POST",
                headers: {
                    "x-mosaic-internal-token": "internal-secret",
                    "x-mosaic-team-id": ROUTING_TEAM_ID,
                    "x-mosaic-actor-id": ROUTING_ACTOR_ID,
                    "content-type": "application/json",
                },
                body: JSON.stringify(semanticRouteBody()),
            }),
            { config, db },
        );

        expect(response.status).toBe(404);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("join users u"),
            [ROUTING_TEAM_ID, ROUTING_PROJECT_ID, ROUTING_ACTOR_ID],
        );
    });

    it("applies the route write gate before scope lookup or provider discovery", async () => {
        const db = dbWithRows();
        const response = await handleRequest(
            new Request("https://api.example.com/api/llm-routing/routes", {
                method: "POST",
                headers: {
                    "x-mosaic-internal-token": "internal-secret",
                    "x-mosaic-team-id": ROUTING_TEAM_ID,
                    "x-mosaic-actor-id": ROUTING_ACTOR_ID,
                    "content-type": "application/json",
                },
                body: JSON.stringify(semanticRouteBody()),
            }),
            {
                config: {
                    ...config,
                    workflowLlmWritesEnabled: false,
                },
                db,
            },
        );

        expect(response.status).toBe(409);
        expect(db.query).not.toHaveBeenCalled();
    });

    it("exposes live route candidates only with trusted routing context", async () => {
        const db = dbWithRows();
        const response = await handleRequest(
            new Request(
                `https://api.example.com/api/llm-routing/route-candidates?projectId=${ROUTING_PROJECT_ID}&transport=openrouter`,
                {
                    headers: {
                        "x-mosaic-internal-token": "internal-secret",
                    },
                },
            ),
            { config, db },
        );

        expect(response.status).toBe(400);
        expect(db.query).not.toHaveBeenCalled();
    });

    it("rejects unknown nested LLM routing fields before persistence", async () => {
        const db = dbWithRows();
        const id = "11111111-1111-4111-8111-111111111111";
        const response = await handleRequest(
            new Request("https://api.example.com/api/llm-routing/routes", {
                method: "POST",
                headers: {
                    "x-mosaic-internal-token": "internal-secret",
                    "x-mosaic-team-id": ROUTING_TEAM_ID,
                    "x-mosaic-actor-id": ROUTING_ACTOR_ID,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    teamId: id,
                    projectId: id,
                    name: "Invalid route",
                    config: {
                        modelId: "gpt-4o",
                        transportConfig: {
                            transport: "openrouter",
                            upstreamPolicy: {
                                mode: "exact",
                                only: ["openai"],
                            },
                            requireParameters: true,
                            responseCache: "disable",
                            hiddenFallback: true,
                        },
                        generation: { maxOutputTokens: 256 },
                        structuredOutput: { mode: "text" },
                        retry: { owner: "gateway", timeoutMs: 30_000 },
                        cache: {
                            mosaicReuse: "allow",
                            providerCaching: "allow",
                        },
                    },
                    providerKeyId: id,
                    capabilityVersionId: id,
                    createdBy: id,
                }),
            }),
            { config, db },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: "invalid_llm_routing",
            path: "config.transportConfig.hiddenFallback",
            remediation: expect.any(String),
            message: expect.stringContaining(
                "config.transportConfig.hiddenFallback",
            ),
        });
        expect(db.query).not.toHaveBeenCalled();
    });

    it("passes the multi kind filter to workflow listing", async () => {
        const db = dbWithRows([[]]);
        const response = await handleRequest(
            new Request(
                "https://api.example.com/api/workflows?teamId=team-1&projectId=project-1&kind=multi",
                {
                    headers: {
                        "x-mosaic-internal-token": "internal-secret",
                    },
                },
            ),
            { config, db },
        );

        expect(response.status).toBe(200);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("w.kind = $3"),
            ["team-1", "project-1", "multi"],
        );
    });

    it("rejects a workflow update whose body ID differs from the route", async () => {
        const db = dbWithRows();
        const response = await handleRequest(
            new Request("https://api.example.com/api/workflows/workflow-a", {
                method: "PUT",
                headers: {
                    "x-mosaic-internal-token": "internal-secret",
                    "content-type": "application/json",
                },
                body: JSON.stringify({ workflowId: "workflow-b" }),
            }),
            { config, db },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            message: expect.stringContaining("must match"),
        });
        expect(db.query).not.toHaveBeenCalled();
    });

    it("rejects workflow-run creation whose body workflow differs from the route", async () => {
        const db = dbWithRows();
        const response = await handleRequest(
            new Request(
                "https://api.example.com/api/workflows/workflow-a/runs",
                {
                    method: "POST",
                    headers: {
                        "x-mosaic-internal-token": "internal-secret",
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({ workflowId: "workflow-b" }),
                },
            ),
            { config, db },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            message: expect.stringContaining("must match"),
        });
        expect(db.query).not.toHaveBeenCalled();
    });

    it("returns only liveness status on the public health endpoint", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("[]", { status: 200 })),
        );
        const response = await handleRequest(
            new Request("https://api.example.com/health", {
                headers: {
                    origin: "https://web.example.com",
                    "x-mosaic-internal-token": "wrong-token",
                },
            }),
            { config, db: dbWithRows() },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ status: "ok" });
    });

    it("reports degraded public health without exposing detail", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("[]", { status: 500 })),
        );
        const response = await handleRequest(
            new Request("https://api.example.com/health"),
            { config, db: dbWithRows() },
        );

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ status: "degraded" });
    });

    it("returns health payload without touching mutable services", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("[]", { status: 200 })),
        );
        const response = await handleRequest(
            new Request("https://api.example.com/health", {
                headers: {
                    origin: "https://web.example.com",
                    "x-mosaic-internal-token": "internal-secret",
                },
            }),
            { config, db: dbWithRows() },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("access-control-allow-origin")).toBe(
            "https://web.example.com",
        );
        await expect(response.json()).resolves.toMatchObject({
            status: "ok",
            service: "mosaic-api",
            storage: "supabase",
            database: "supabase-postgres",
            checks: { database: "ok", storage: "ok" },
            railwayVolumeRequired: false,
            observability: {
                errorTracking: "disabled",
                analytics: "disabled",
                alerting: "disabled",
                profiling: "disabled",
            },
            stt: {
                probesConfigured: 0,
                providers: expect.arrayContaining([
                    expect.objectContaining({
                        providerId: "openai",
                        keyConfigured: true,
                        availableModels: expect.any(Number),
                    }),
                    expect.objectContaining({
                        providerId: "soniox",
                        keyConfigured: false,
                        missingKeyModels: expect.any(Number),
                    }),
                ]),
            },
        });
    });

    it("reports STT provider probe readiness without exposing key values", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("[]", { status: 200 })),
        );
        const response = await handleRequest(
            new Request("https://api.example.com/health", {
                headers: { "x-mosaic-internal-token": "internal-secret" },
            }),
            {
                config: {
                    ...config,
                    aiGatewayApiKey: "vck-test",
                    sonioxApiKey: "soniox-test",
                    sttCapabilityProbes: {
                        "vercel:openai/whisper-1": { status: "available" },
                    },
                },
                db: dbWithRows(),
            },
        );

        const body = await response.json();
        expect(body.stt).toMatchObject({
            probesConfigured: 1,
            providers: expect.arrayContaining([
                expect.objectContaining({
                    providerId: "vercel-gateway",
                    keyConfigured: true,
                    availableModels: 1,
                }),
                expect.objectContaining({
                    providerId: "soniox",
                    keyConfigured: true,
                    availableModels: 1,
                }),
            ]),
        });
        expect(JSON.stringify(body)).not.toContain("vck-test");
        expect(JSON.stringify(body)).not.toContain("soniox-test");
    });

    it("preserves safe inbound request IDs on responses", async () => {
        const response = await handleRequest(
            new Request("https://api.example.com/nope", {
                headers: { "x-request-id": "run_12345678" },
            }),
            { config, db: dbWithRows() },
        );

        expect(response.status).toBe(404);
        expect(response.headers.get("x-request-id")).toBe("run_12345678");
    });

    it("replaces unsafe inbound request IDs", async () => {
        const response = await handleRequest(
            new Request("https://api.example.com/nope", {
                headers: { "x-request-id": "bad id with spaces" },
            }),
            { config, db: dbWithRows() },
        );

        expect(response.status).toBe(404);
        expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
    });

    it("returns not found for unknown routes", async () => {
        const response = await handleRequest(
            new Request("https://api.example.com/nope"),
            { config, db: dbWithRows() },
        );

        expect(response.status).toBe(404);
    });

    it("returns dashboard payload for authorized internal web requests", async () => {
        const response = await handleRequest(
            new Request(
                "https://api.example.com/api/dashboard?teamId=team-1&projectId=project-1",
                {
                    headers: {
                        origin: "https://web.example.com",
                        "x-mosaic-internal-token": "internal-secret",
                    },
                },
            ),
            {
                config,
                db: dbWithRows([
                    [{ count: 0 }],
                    [{ count: 0 }],
                    [{ total: 0, active: 0 }],
                    [{ count: 0 }],
                    [{ count: 0 }],
                    [],
                ]),
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            stats: {
                datasetCount: 0,
                promptCount: 0,
                runCount: 0,
                runningCount: 0,
                hasDatasetWithSchema: false,
                hasDatasetWithItems: false,
                hasPrompt: false,
            },
            recentRuns: [],
        });
    });

    it("rejects dashboard requests without the internal token", async () => {
        const fetchSpy = vi.fn(async () => new Response(null, { status: 202 }));
        vi.stubGlobal("fetch", fetchSpy);
        const response = await handleRequest(
            new Request(
                "https://api.example.com/api/dashboard?teamId=team-1&projectId=project-1",
            ),
            {
                config: {
                    ...config,
                    alertWebhookUrl: "https://alerts.example/webhook",
                },
                db: dbWithRows(),
            },
        );

        expect(response.status).toBe(401);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects provider-key requests without the internal token", async () => {
        const response = await handleRequest(
            new Request(
                `https://api.example.com/api/provider-keys?teamId=11111111-1111-4111-8111-111111111111`,
            ),
            { config, db: dbWithRows() },
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            error: "unauthorized",
        });
    });

    it("dispatches alerts for server faults only", async () => {
        const fetchSpy = vi.fn(async () => new Response(null, { status: 202 }));
        vi.stubGlobal("fetch", fetchSpy);
        const response = await handleRequest(
            new Request(
                "https://api.example.com/api/dashboard?teamId=team-1&projectId=project-1",
                {
                    headers: { "x-mosaic-internal-token": "internal-secret" },
                },
            ),
            {
                config: {
                    ...config,
                    alertWebhookUrl: "https://alerts.example/webhook",
                },
                db: {
                    query: vi.fn(async () => {
                        throw new Error("database down");
                    }),
                },
            },
        );

        expect(response.status).toBe(500);
        expect(fetchSpy).toHaveBeenCalledWith(
            "https://alerts.example/webhook",
            expect.objectContaining({ method: "POST" }),
        );
    });

    it("returns authorized image bytes from Supabase Storage", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("image-bytes", { status: 200 })),
        );
        const key = "11111111-1111-4111-8111-111111111111";

        const response = await handleRequest(
            new Request(
                `https://api.example.com/api/images/${key}?teamId=team-1&projectId=project-1`,
                {
                    headers: { "x-mosaic-internal-token": "internal-secret" },
                },
            ),
            {
                config,
                db: dbWithRows([
                    [
                        {
                            team_id: "team-1",
                            project_id: "project-1",
                            mime_type: "image/png",
                        },
                    ],
                ]),
            },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/png");
        await expect(response.text()).resolves.toBe("image-bytes");
        expect(fetch).toHaveBeenCalledWith(
            `https://example.supabase.co/storage/v1/object/mosaic-images/${key}`,
            expect.objectContaining({
                method: "GET",
                headers: {
                    apikey: "service-role",
                    Authorization: "Bearer service-role",
                },
            }),
        );
    });

    it("hides image bytes from another project in the same team", async () => {
        const key = "11111111-1111-4111-8111-111111111111";
        const response = await handleRequest(
            new Request(
                `https://api.example.com/api/images/${key}?teamId=team-1&projectId=project-2`,
                { headers: { "x-mosaic-internal-token": "internal-secret" } },
            ),
            {
                config,
                db: dbWithRows([
                    [
                        {
                            team_id: "team-1",
                            project_id: "project-1",
                            mime_type: "image/png",
                        },
                    ],
                ]),
            },
        );

        expect(response.status).toBe(404);
    });

    it("returns run progress for authorized internal web requests", async () => {
        const response = await handleRequest(
            new Request(
                "https://api.example.com/api/runs/run-1/progress?teamId=team-1&projectId=project-1",
                {
                    headers: { "x-mosaic-internal-token": "internal-secret" },
                },
            ),
            {
                config,
                db: dbWithRows([
                    [{ status: "running" }],
                    [{ status: "succeeded", count: 1 }],
                ]),
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            status: "running",
            total: 1,
            done: 1,
            failed: 0,
            pending: 0,
        });
    });

    it("returns runs for authorized internal web requests", async () => {
        const response = await handleRequest(
            new Request(
                "https://api.example.com/api/runs?teamId=team-1&projectId=project-1",
                {
                    headers: { "x-mosaic-internal-token": "internal-secret" },
                },
            ),
            {
                config,
                db: dbWithRows([
                    [
                        {
                            id: "run-1",
                            status: "completed",
                            created_at: new Date("2026-07-06T08:00:00.000Z"),
                            dataset_id: "dataset-1",
                            dataset_name: "Food",
                            models: ["gpt-4o"],
                            total: 1,
                            done: 1,
                            failed: 0,
                            pending: 0,
                        },
                    ],
                ]),
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual([
            {
                id: "run-1",
                status: "completed",
                createdAt: "2026-07-06T08:00:00.000Z",
                datasetId: "dataset-1",
                datasetName: "Food",
                models: ["gpt-4o"],
                progress: {
                    total: 1,
                    done: 1,
                    failed: 0,
                    pending: 0,
                },
            },
        ]);
    });

    it("returns run setup options for authorized internal web requests", async () => {
        const response = await handleRequest(
            new Request(
                "https://api.example.com/api/runs/setup?teamId=team-1&projectId=project-1",
                {
                    headers: { "x-mosaic-internal-token": "internal-secret" },
                },
            ),
            {
                config,
                db: dbWithRows([[], [], [], []]),
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            datasets: [],
            bundles: [],
            versionOptions: [],
            judgePrompts: [],
            hasPrompt: false,
            modelsDegraded: false,
        });
    });

    it("returns datasets for authorized internal web requests", async () => {
        const response = await handleRequest(
            new Request(
                "https://api.example.com/api/datasets?teamId=team-1&projectId=project-1&includeArchived=true",
                {
                    headers: { "x-mosaic-internal-token": "internal-secret" },
                },
            ),
            {
                config,
                db: dbWithRows([
                    [
                        {
                            id: "dataset-1",
                            name: "Golden",
                            purpose: "golden",
                            modality: "image",
                            created_at: new Date("2026-07-06T08:00:00.000Z"),
                            item_count: 1,
                            labeled_item_count: 1,
                            archived_at: null,
                        },
                    ],
                ]),
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual([
            {
                id: "dataset-1",
                name: "Golden",
                purpose: "golden",
                modality: "image",
                createdAt: "2026-07-06T08:00:00.000Z",
                itemCount: 1,
                labeledItemCount: 1,
                isRunnable: true,
                archived: false,
            },
        ]);
    });

    it("returns dataset detail for authorized internal web requests", async () => {
        const response = await handleRequest(
            new Request(
                "https://api.example.com/api/datasets/dataset-1?teamId=team-1&projectId=project-1",
                {
                    headers: { "x-mosaic-internal-token": "internal-secret" },
                },
            ),
            {
                config,
                db: dbWithRows([
                    [
                        {
                            id: "dataset-1",
                            team_id: "team-1",
                            name: "Food",
                            purpose: "evaluation",
                            modality: "text",
                            pipeline_id: null,
                            description: null,
                            archived_at: null,
                        },
                    ],
                    [],
                    [],
                ]),
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            dataset: {
                id: "dataset-1",
                teamId: "team-1",
                name: "Food",
                purpose: "evaluation",
                modality: "text",
            },
            items: [],
            labels: [],
            itemCount: 0,
            labeledItemCount: 0,
            labelMode: "evaluation",
            freeformLabel: true,
            isRunnable: false,
        });
    });

    it("returns prompts for authorized internal web requests", async () => {
        const response = await handleRequest(
            new Request(
                "https://api.example.com/api/prompts?teamId=team-1&projectId=project-1",
                {
                    headers: { "x-mosaic-internal-token": "internal-secret" },
                },
            ),
            {
                config,
                db: dbWithRows([
                    [
                        {
                            id: "prompt-1",
                            name: "Meal prompt",
                            description: null,
                            kind: "eval",
                            latest_version: 1,
                            latest_status: "legacy",
                            latest_created_at: new Date(
                                "2026-07-06T08:00:00.000Z",
                            ),
                            latest_optimizer_attempt_id: null,
                        },
                    ],
                ]),
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual([
            {
                id: "prompt-1",
                name: "Meal prompt",
                description: null,
                kind: "eval",
                latest: {
                    version: 1,
                    status: "legacy",
                    createdAt: "2026-07-06T08:00:00.000Z",
                    optimizedWithAi: false,
                },
            },
        ]);
    });

    it("returns prompt detail for authorized internal web requests", async () => {
        const response = await handleRequest(
            new Request(
                "https://api.example.com/api/prompts/prompt-1?teamId=team-1&projectId=project-1",
                {
                    headers: { "x-mosaic-internal-token": "internal-secret" },
                },
            ),
            {
                config,
                db: dbWithRows([
                    [
                        {
                            id: "prompt-1",
                            name: "Meal prompt",
                            description: null,
                            kind: "eval",
                        },
                    ],
                    [],
                ]),
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            prompt: {
                id: "prompt-1",
                name: "Meal prompt",
                description: null,
                kind: "eval",
            },
            latestVersion: undefined,
            schemaVersion: undefined,
            versions: [],
        });
    });
});
