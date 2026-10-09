import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    setProviderKey: vi.fn(),
    clearProviderKey: vi.fn(),
    createSttRouteProbe: vi.fn(),
    listWorkflowLlmRouteCandidates: vi.fn(),
    createWorkflowLlmRouteVersion: vi.fn(),
    disableWorkflowLlmRoute: vi.fn(),
    setWorkflowLlmProjectDefault: vi.fn(),
    clearWorkflowLlmProjectDefault: vi.fn(),
    revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/auth/session", () => ({
    requirePrincipal: vi.fn(async () => ({
        userId: "user-1",
        teamId: "team-1",
    })),
}));
vi.mock("@/server/projects/activeProject", () => ({
    requireActiveProject: vi.fn(async () => ({
        userId: "user-1",
        teamId: "team-1",
        projectId: "project-1",
    })),
}));
vi.mock("@/server/api/client", () => ({
    serverApiClient: () => ({
        setProviderKey: mocks.setProviderKey,
        clearProviderKey: mocks.clearProviderKey,
        createSttRouteProbe: mocks.createSttRouteProbe,
        listWorkflowLlmRouteCandidates: mocks.listWorkflowLlmRouteCandidates,
        createWorkflowLlmRouteVersion: mocks.createWorkflowLlmRouteVersion,
        disableWorkflowLlmRoute: mocks.disableWorkflowLlmRoute,
        setWorkflowLlmProjectDefault: mocks.setWorkflowLlmProjectDefault,
        clearWorkflowLlmProjectDefault: mocks.clearWorkflowLlmProjectDefault,
    }),
}));

import {
    clearWorkflowLlmDefaultAction,
    clearProviderKeyAction,
    createSttRouteProbeAction,
    disableWorkflowLlmRouteAction,
    loadWorkflowLlmRouteCandidatesAction,
    saveWorkflowLlmRouteAction,
    createWorkflowLlmRouteForNode,
    setWorkflowLlmDefaultAction,
    setProviderKeyAction,
} from "./settings";

beforeEach(() => vi.clearAllMocks());

describe("provider key settings actions", () => {
    it("sets a provider key for the current team", async () => {
        const form = new FormData();
        form.set("provider", "openai");
        form.set("key", "sk-secret");
        await expect(setProviderKeyAction({}, form)).resolves.toMatchObject({
            ok: true,
        });
        expect(mocks.setProviderKey).toHaveBeenCalledWith({
            teamId: "team-1",
            provider: "openai",
            key: "sk-secret",
        });
        expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
        expect(mocks.revalidatePath).toHaveBeenCalledWith("/runs/new");
        expect(mocks.revalidatePath).toHaveBeenCalledWith("/prompts", "layout");
    });

    it("passes base URLs only for OpenRouter and Bifrost", async () => {
        const form = new FormData();
        form.set("provider", "openrouter");
        form.set("key", "or-secret");
        form.set("baseUrl", " https://router.example/v1 ");
        await setProviderKeyAction({}, form);
        expect(mocks.setProviderKey).toHaveBeenCalledWith(
            expect.objectContaining({ baseUrl: "https://router.example/v1" }),
        );
    });

    it("requires a Bifrost base URL before calling the API", async () => {
        const form = new FormData();
        form.set("provider", "bifrost");
        form.set("key", "bifrost-secret");

        await expect(setProviderKeyAction({}, form)).resolves.toMatchObject({
            error: expect.stringMatching(/Bifrost OpenAI-compatible endpoint/i),
        });
        expect(mocks.setProviderKey).not.toHaveBeenCalled();
    });

    it("does not return raw database errors to the client", async () => {
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        const pgError = Object.assign(
            new Error(
                'duplicate key value violates unique constraint "provider_keys_pkey"',
            ),
            { code: "23505", table: "provider_keys" },
        );
        mocks.setProviderKey.mockRejectedValue(pgError);
        const form = new FormData();
        form.set("provider", "openai");
        form.set("key", "sk-secret");

        const result = await setProviderKeyAction({}, form);

        expect(result).toEqual({
            error: "Something went wrong. Please try again.",
        });
        expect(JSON.stringify(result)).not.toContain("provider_keys");
        expect(consoleError).toHaveBeenCalledWith(
            "Unhandled server action error:",
            pgError,
        );
        consoleError.mockRestore();
    });

    it("clears a provider key for the current team", async () => {
        const form = new FormData();
        form.set("provider", "soniox");
        await expect(clearProviderKeyAction({}, form)).resolves.toMatchObject({
            ok: true,
        });
        expect(mocks.clearProviderKey).toHaveBeenCalledWith({
            teamId: "team-1",
            provider: "soniox",
        });
        expect(mocks.revalidatePath).toHaveBeenCalledWith("/runs/new");
        expect(mocks.revalidatePath).toHaveBeenCalledWith("/prompts", "layout");
    });

    it("probes a route for the active team and project", async () => {
        mocks.createSttRouteProbe.mockResolvedValue({
            modelId: "gemini:gemini-2.5-flash",
            routeId: "gemini-generate-content-audio",
            status: "available",
            transcript: "Flash Evals route verification.",
            probedAt: "2026-07-14T00:00:00.000Z",
        });
        const form = new FormData();
        form.set("projectId", "project-1");
        form.set("modelId", "gemini:gemini-2.5-flash");

        await expect(
            createSttRouteProbeAction({}, form),
        ).resolves.toMatchObject({
            result: { status: "available" },
        });
        expect(mocks.createSttRouteProbe).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            modelId: "gemini:gemini-2.5-flash",
            probedBy: "user-1",
        });
        expect(mocks.revalidatePath).toHaveBeenCalledWith(
            "/multiworkflow",
            "layout",
        );
    });
});

describe("workflow LLM routing settings actions", () => {
    it("creates a provider/model route without exposing credential IDs", async () => {
        mocks.createWorkflowLlmRouteVersion.mockResolvedValue({
            id: "route-1",
        });

        await expect(
            createWorkflowLlmRouteForNode({
                transport: "gateway",
                modelId: "google/gemma-4-31b-it",
                name: "Gemma 4 via Gateway",
                generation: {
                    maxOutputTokens: 1024,
                    temperature: 0.2,
                    seed: 42,
                },
                timeoutMs: 45_000,
                mosaicReuse: "force_fresh",
            }),
        ).resolves.toMatchObject({ route: { id: "route-1" } });
        expect(mocks.createWorkflowLlmRouteVersion).toHaveBeenCalledWith(
            {
                projectId: "project-1",
                name: "Gemma 4 via Gateway",
                config: expect.objectContaining({
                    modelId: "google/gemma-4-31b-it",
                    generation: {
                        maxOutputTokens: 1024,
                        temperature: 0.2,
                        seed: 42,
                    },
                    transportConfig: {
                        transport: "gateway",
                        upstreamPolicy: { mode: "gateway_auto" },
                        modelFallback: "disabled",
                    },
                }),
            },
            { teamId: "team-1", actorId: "user-1" },
        );
    });
    it("loads safe live candidates with trusted scope outside the query", async () => {
        mocks.listWorkflowLlmRouteCandidates.mockResolvedValue({
            transport: "openrouter",
            coverage: "provider_model_listing",
            candidates: [],
        });
        await expect(
            loadWorkflowLlmRouteCandidatesAction("project-1", "openrouter"),
        ).resolves.toMatchObject({
            result: { candidates: [] },
        });
        expect(mocks.listWorkflowLlmRouteCandidates).toHaveBeenCalledWith(
            "project-1",
            "openrouter",
            { teamId: "team-1", actorId: "user-1" },
        );
    });

    it("creates an evaluation-safe route with explicit OpenRouter policy", async () => {
        const form = new FormData();
        form.set("projectId", "project-1");
        form.set("name", "Gemma exact");
        form.set("transport", "openrouter");
        form.set("modelId", "google/gemma-3-27b-it");
        form.set("maxOutputTokens", "2048");
        form.set("upstreamMode", "exact");
        form.set("upstreamProviders", "google-vertex, google");
        form.set("requireParameters", "on");

        await expect(
            saveWorkflowLlmRouteAction({}, form),
        ).resolves.toMatchObject({ ok: true });
        expect(mocks.createWorkflowLlmRouteVersion).toHaveBeenCalledWith(
            {
                projectId: "project-1",
                name: "Gemma exact",
                config: expect.objectContaining({
                    modelId: "google/gemma-3-27b-it",
                    transportConfig: {
                        transport: "openrouter",
                        upstreamPolicy: {
                            mode: "exact",
                            only: ["google-vertex", "google"],
                        },
                        requireParameters: true,
                        responseCache: "disable",
                    },
                    cache: {
                        mosaicReuse: "force_fresh",
                        providerCaching: "allow",
                    },
                }),
            },
            { teamId: "team-1", actorId: "user-1" },
        );
    });

    it("sets, clears, and disables scoped route state", async () => {
        const form = new FormData();
        form.set("projectId", "project-1");
        form.set("routeVersionId", "version-1");
        await setWorkflowLlmDefaultAction({}, form);
        expect(mocks.setWorkflowLlmProjectDefault).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            routeVersionId: "version-1",
            updatedBy: "user-1",
        });

        await clearWorkflowLlmDefaultAction({}, form);
        expect(mocks.clearWorkflowLlmProjectDefault).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            updatedBy: "user-1",
        });

        form.set("routeId", "route-1");
        await disableWorkflowLlmRouteAction({}, form);
        expect(mocks.disableWorkflowLlmRoute).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            routeId: "route-1",
            disabledBy: "user-1",
        });
    });

    it("creates the same structured-output route shape exposed by MCP", async () => {
        const form = new FormData();
        form.set("projectId", "project-1");
        form.set("name", "Judge route");
        form.set("transport", "openrouter");
        form.set("modelId", "openai/gpt-4o");
        form.set("structuredOutputMode", "json_schema");
        form.set("schemaName", "workflow_judge");
        form.set("schemaDigest", "sha256:judge");
        form.set("schemaStrict", "on");

        await saveWorkflowLlmRouteAction({}, form);

        expect(mocks.createWorkflowLlmRouteVersion).toHaveBeenCalledWith(
            expect.objectContaining({
                config: expect.objectContaining({
                    structuredOutput: {
                        mode: "json_schema",
                        schemaName: "workflow_judge",
                        schemaDigest: "sha256:judge",
                        strict: true,
                    },
                }),
            }),
            { teamId: "team-1", actorId: "user-1" },
        );
    });
});
