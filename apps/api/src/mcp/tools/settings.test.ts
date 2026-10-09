import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    clearProviderKeyPayload: vi.fn(),
    createSttRouteProbePayload: vi.fn(),
    listProviderKeysPayload: vi.fn(),
    setProviderKeyPayload: vi.fn(),
    clearWorkflowLlmProjectDefaultPayload: vi.fn(),
    createWorkflowLlmRouteVersionPayload: vi.fn(),
    createWorkflowLlmRouteForModelPayload: vi.fn(),
    disableWorkflowLlmRoutePayload: vi.fn(),
    getWorkflowLlmProjectDefaultPayload: vi.fn(),
    listWorkflowLlmCapabilitiesPayload: vi.fn(),
    listWorkflowLlmRouteCandidatesPayload: vi.fn(),
    listWorkflowLlmRoutesPayload: vi.fn(),
    refreshWorkflowLlmCapabilitiesPayload: vi.fn(),
    setWorkflowLlmProjectDefaultPayload: vi.fn(),
}));

vi.mock("../../routes/keys.js", () => mocks);
vi.mock("../../routes/sttProbes.js", () => ({
    createSttRouteProbePayload: mocks.createSttRouteProbePayload,
}));
vi.mock("../../routes/llmRouting.js", () => ({
    assertWorkflowLlmWritesEnabled: vi.fn(),
    clearWorkflowLlmProjectDefaultPayload:
        mocks.clearWorkflowLlmProjectDefaultPayload,
    createWorkflowLlmRouteVersionPayload:
        mocks.createWorkflowLlmRouteVersionPayload,
    createWorkflowLlmRouteForModelPayload:
        mocks.createWorkflowLlmRouteForModelPayload,
    disableWorkflowLlmRoutePayload: mocks.disableWorkflowLlmRoutePayload,
    getWorkflowLlmProjectDefaultPayload:
        mocks.getWorkflowLlmProjectDefaultPayload,
    listWorkflowLlmCapabilitiesPayload:
        mocks.listWorkflowLlmCapabilitiesPayload,
    listWorkflowLlmRouteCandidatesPayload:
        mocks.listWorkflowLlmRouteCandidatesPayload,
    listWorkflowLlmRoutesPayload: mocks.listWorkflowLlmRoutesPayload,
    refreshWorkflowLlmCapabilitiesPayload:
        mocks.refreshWorkflowLlmCapabilitiesPayload,
    setWorkflowLlmProjectDefaultPayload:
        mocks.setWorkflowLlmProjectDefaultPayload,
}));

import { registerSettingsTools } from "./settings.js";
import {
    createToolHarness,
    expectConfirmationGate,
    TEST_PROJECT_ID,
    TEST_TEAM_ID,
} from "./testSupport.js";

describe("MCP provider-key tools", () => {
    beforeEach(() => vi.clearAllMocks());

    it("never returns or logs provider key material", async () => {
        const { tools } = registerTools();
        const secret = "unit-test-provider-secret";
        const consoleInfo = vi
            .spyOn(console, "info")
            .mockImplementation(() => {});
        mocks.setProviderKeyPayload.mockResolvedValue(undefined);

        const response = await tools.get("set_provider_key")!.handler({
            provider: "openai",
            key: secret,
        });

        expect(JSON.stringify(response)).not.toContain(secret);
        expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain(secret);
        expect(consoleInfo).toHaveBeenCalledWith(
            expect.stringContaining('"provider":"openai"'),
        );
        consoleInfo.mockRestore();
    });

    it("lists only the metadata returned by the shared payload", async () => {
        const { tools, runtime } = registerTools();
        mocks.listProviderKeysPayload.mockResolvedValue([
            { provider: "openai", hint: "...abcd" },
        ]);

        const response = await tools.get("list_provider_keys")!.handler({});

        expect(mocks.listProviderKeysPayload).toHaveBeenCalledWith(
            runtime.db,
            TEST_TEAM_ID,
        );
        expect(JSON.stringify(response)).not.toContain("...abcd");
        expect(response).toMatchObject({
            structuredContent: {
                data: expect.arrayContaining([
                    { provider: "openai", configured: true },
                    { provider: "soniox", configured: false },
                ]),
            },
        });
    });

    it("requires confirmation before clearing a provider key", () => {
        const tool = registerTools().tools.get("clear_provider_key")!;

        expectConfirmationGate(tool, { provider: "openai" });
    });

    it("resolves project scope and probes with the authenticated principal", async () => {
        const { tools, runtime } = registerTools();
        const result = {
            modelId: "stt:openai:whisper-1",
            routeId: "openai",
            status: "available",
            probedAt: "2026-07-21T00:00:00.000Z",
        };
        mocks.createSttRouteProbePayload.mockResolvedValue(result);

        const response = await tools.get("create_stt_route_probe")!.handler({
            projectId: TEST_PROJECT_ID,
            modelId: "stt:openai:whisper-1",
        });

        expect(mocks.createSttRouteProbePayload).toHaveBeenCalledWith(
            runtime.db,
            runtime.config,
            {
                teamId: TEST_TEAM_ID,
                projectId: TEST_PROJECT_ID,
                modelId: "stt:openai:whisper-1",
                probedBy: "user-1",
            },
        );
        expect(response).toMatchObject({
            structuredContent: { data: result },
        });
    });

    it("surfaces route errors and requires a model ID", async () => {
        const tool = registerTools().tools.get("create_stt_route_probe")!;
        mocks.createSttRouteProbePayload.mockRejectedValue(
            new Error("modelId is not a probe-enabled STT model"),
        );

        await expect(
            tool.handler({ modelId: "stt:unknown:model" }),
        ).rejects.toThrow("modelId is not a probe-enabled STT model");
        expect(() => tool.config.inputSchema!.parse({})).toThrow();
    });

    it("forwards canonical route-version input to the shared routing payload", async () => {
        const routingTeamId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
        const routingUserId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
        const { tools, runtime } = createToolHarness(registerSettingsTools, {
            config: { mosaicSecretsEncKey: "test-encryption-key" },
            teamId: routingTeamId,
            userId: routingUserId,
        });
        const routeVersionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        const route = { id: "route-1", latestVersion: { id: routeVersionId } };
        mocks.createWorkflowLlmRouteVersionPayload.mockResolvedValue(route);
        mocks.getWorkflowLlmProjectDefaultPayload.mockResolvedValue({});
        const input = {
            projectId: TEST_PROJECT_ID,
            routeId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            name: "OpenRouter exact",
            config: {
                transportConfig: {
                    transport: "openrouter" as const,
                    upstreamPolicy: {
                        mode: "exact" as const,
                        only: ["openai"],
                    },
                    requireParameters: true,
                    responseCache: "disable" as const,
                },
                modelId: "openai/gpt-4o",
                generation: { maxOutputTokens: 512 },
                structuredOutput: { mode: "text" as const },
                retry: {
                    owner: "gateway" as const,
                    timeoutMs: 30_000,
                },
                cache: {
                    mosaicReuse: "allow" as const,
                    providerCaching: "allow" as const,
                },
            },
        };

        const response = await tools
            .get("create_workflow_llm_route_version")!
            .handler(input);

        expect(mocks.createWorkflowLlmRouteVersionPayload).toHaveBeenCalledWith(
            runtime.db,
            runtime.config,
            {
                projectId: TEST_PROJECT_ID,
                routeId: input.routeId,
                name: input.name,
                config: input.config,
            },
            { teamId: routingTeamId, actorId: routingUserId },
        );
        expect(response).toMatchObject({
            structuredContent: {
                data: {
                    route,
                    routeVersionId,
                    default: {},
                    warnings: [],
                    pinning: {
                        tool: "select_workflow_llm_model",
                        input: { routeVersionId },
                    },
                },
            },
        });
    });

    it("creates a route from provider/model without credential UUID input", async () => {
        const { tools, runtime } = registerTools();
        const routeVersionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        const route = { id: "route-1", latestVersion: { id: routeVersionId } };
        mocks.createWorkflowLlmRouteForModelPayload.mockResolvedValue(route);
        mocks.getWorkflowLlmProjectDefaultPayload.mockResolvedValue({});

        const response = await tools
            .get("create_workflow_llm_route_for_model")!
            .handler({
                projectId: TEST_PROJECT_ID,
                transport: "gateway",
                modelId: "google/gemma-4-31b-it",
                name: "Gemma 4 via Gateway",
                generation: {
                    maxOutputTokens: 1024,
                    temperature: 0.2,
                    topP: 0.9,
                    seed: 42,
                    reasoningEffort: "low",
                },
                timeoutMs: 45_000,
                maxAttempts: 2,
                mosaicReuse: "force_fresh",
            });

        expect(
            mocks.createWorkflowLlmRouteForModelPayload,
        ).toHaveBeenCalledWith(
            runtime.db,
            runtime.config,
            {
                projectId: TEST_PROJECT_ID,
                name: "Gemma 4 via Gateway",
                config: {
                    transportConfig: {
                        transport: "gateway",
                        upstreamPolicy: { mode: "gateway_auto" },
                        modelFallback: "disabled",
                    },
                    modelId: "google/gemma-4-31b-it",
                    generation: {
                        maxOutputTokens: 1024,
                        temperature: 0.2,
                        topP: 0.9,
                        seed: 42,
                        reasoningEffort: "low",
                    },
                    structuredOutput: { mode: "text" },
                    retry: { owner: "gateway", timeoutMs: 45_000 },
                    cache: {
                        mosaicReuse: "force_fresh",
                        providerCaching: "allow",
                    },
                },
            },
            { teamId: TEST_TEAM_ID, actorId: "user-1" },
        );
        expect(response).toMatchObject({
            structuredContent: {
                data: { route, routeVersionId },
            },
        });
    });

    it("lists candidates only for the selected configured provider", async () => {
        const { tools, runtime } = registerTools();
        mocks.listProviderKeysPayload.mockResolvedValue([
            { id: "key-1", provider: "openrouter" },
            { id: "key-2", provider: "gateway" },
        ]);
        const candidate = {
            transport: "openrouter",
            modelId: "google/gemma-3-27b-it",
            label: "Gemma 3 27B IT",
            source: "provider_model_listing",
            availability: "provider_listed_candidate",
        };
        mocks.listWorkflowLlmRouteCandidatesPayload.mockImplementation(
            async (_db, _config, _projectId, transport) => {
                if (transport === "gateway") {
                    throw new Error("gateway is unavailable");
                }
                return {
                    transport: "openrouter",
                    coverage: "provider_model_listing",
                    candidates: [candidate],
                };
            },
        );

        const response = await tools
            .get("list_workflow_llm_provider_models")!
            .handler({
                projectId: TEST_PROJECT_ID,
                transport: "openrouter",
            });

        expect(
            mocks.listWorkflowLlmRouteCandidatesPayload,
        ).toHaveBeenCalledWith(
            runtime.db,
            runtime.config,
            TEST_PROJECT_ID,
            "openrouter",
            { teamId: TEST_TEAM_ID, actorId: "user-1" },
        );
        expect(
            mocks.listWorkflowLlmRouteCandidatesPayload,
        ).toHaveBeenCalledTimes(1);
        expect(response).toMatchObject({
            structuredContent: {
                data: [
                    {
                        provider: "openrouter",
                        label: "OpenRouter",
                        configured: true,
                        selectionContext:
                            "provider_listed_candidate_not_execution_verified",
                        models: [candidate],
                    },
                ],
            },
        });
    });

    it("rejects an unconfigured provider without live discovery", async () => {
        const { tools } = registerTools();
        mocks.listProviderKeysPayload.mockResolvedValue([
            { id: "key-1", provider: "openrouter" },
        ]);

        await expect(
            tools.get("list_workflow_llm_provider_models")!.handler({
                projectId: TEST_PROJECT_ID,
                transport: "gateway",
            }),
        ).rejects.toThrow(
            "The selected provider does not have a configured credential.",
        );
        expect(
            mocks.listWorkflowLlmRouteCandidatesPayload,
        ).not.toHaveBeenCalled();
    });

    it("returns default mutations without rereading routing state", async () => {
        const routingTeamId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
        const routingUserId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
        const { tools } = createToolHarness(registerSettingsTools, {
            config: { mosaicSecretsEncKey: "test-encryption-key" },
            teamId: routingTeamId,
            userId: routingUserId,
        });
        const routeVersionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        const newDefault = {
            projectId: TEST_PROJECT_ID,
            routeVersionId,
            updatedBy: routingUserId,
            updatedAt: "2026-07-25T00:00:00.000Z",
        };
        mocks.setWorkflowLlmProjectDefaultPayload.mockResolvedValue({
            newDefault,
            updatedBy: routingUserId,
        });
        mocks.clearWorkflowLlmProjectDefaultPayload.mockResolvedValue({
            oldDefault: newDefault,
            updatedBy: routingUserId,
        });

        const setResponse = await tools
            .get("set_workflow_llm_default")!
            .handler({
                projectId: TEST_PROJECT_ID,
                routeVersionId,
            });
        const clearResponse = await tools
            .get("clear_workflow_llm_default")!
            .handler({
                projectId: TEST_PROJECT_ID,
                confirm: true,
            });

        expect(setResponse).toMatchObject({
            structuredContent: {
                data: {
                    default: { default: newDefault },
                    warnings: [],
                },
            },
        });
        expect(clearResponse).toMatchObject({
            structuredContent: {
                data: { default: {}, warnings: [] },
            },
        });
        expect(
            mocks.getWorkflowLlmProjectDefaultPayload,
        ).not.toHaveBeenCalled();
    });

    it("keeps routing schemas strict and gates destructive mutations", () => {
        const { tools } = registerTools();
        const create = tools.get("create_workflow_llm_route_version")!;
        const candidates = tools.get("list_workflow_llm_provider_models")!;
        expect(() =>
            candidates.config.inputSchema!.parse({
                projectId: TEST_PROJECT_ID,
            }),
        ).toThrow();
        expect(() =>
            create.config.inputSchema!.parse({
                projectId: TEST_PROJECT_ID,
                name: "Invalid",
                config: {
                    transportConfig: { transport: "openai" },
                    modelId: "gpt-4o",
                    generation: { maxOutputTokens: 1, secret: "no" },
                    structuredOutput: { mode: "text" },
                    retry: { owner: "gateway", timeoutMs: 1 },
                    cache: {
                        mosaicReuse: "allow",
                        providerCaching: "allow",
                    },
                },
                providerKeyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                capabilityVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            }),
        ).toThrow();
        expectConfirmationGate(tools.get("disable_workflow_llm_route")!, {
            routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        });
        expectConfirmationGate(tools.get("clear_workflow_llm_default")!, {});
    });
});

function registerTools() {
    return createToolHarness(registerSettingsTools, {
        config: { mosaicSecretsEncKey: "test-encryption-key" },
        teamId: TEST_TEAM_ID,
    });
}
