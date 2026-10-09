import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import { resolveApiFeatureFlags } from "../featureFlags.js";
import {
    createSttRouteProbePayload,
    listSttRouteProbesPayload,
    teamSttCapabilityProbes,
} from "./sttProbes.js";

const mocks = vi.hoisted(() => ({
    gatewayTranscription: vi.fn(),
}));

vi.mock("@ai-sdk/gateway", () => ({
    createGateway: vi.fn(() => ({
        transcription: vi.fn(() => ({
            doGenerate: mocks.gatewayTranscription,
        })),
    })),
}));

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function config(overrides: Partial<IApiConfig> = {}): IApiConfig {
    return {
        nodeEnv: "test",
        port: 3001,
        databaseUrl: "postgres://test",
        storageAdapter: "local",
        supabaseUrl: "",
        supabaseServiceRoleKey: "",
        supabaseStorageBucket: "",
        clerkSecretKey: "clerk-secret",
        mosaicTenancyMode: "single-org",
        mosaicAllowedEmailDomain: "example.com",
        corsOrigins: [],
        mosaicLlmProvider: "auto",
        sttCapabilityProbes: {},
        profilingEnabled: false,
        featureFlags: resolveApiFeatureFlags({}),
        ...overrides,
    };
}

function database(probeRows: unknown[] = []): IDb {
    return {
        query: vi.fn(async (sql: string) => {
            if (sql.includes("from projects p"))
                return { rows: [{ exists: 1 }] } as never;
            if (sql.includes("from projects where"))
                return { rows: [{ exists: 1 }] } as never;
            if (sql.includes("from provider_keys"))
                return { rows: [] } as never;
            if (sql.includes("from stt_route_probes"))
                return { rows: probeRows } as never;
            if (sql.includes("insert into stt_route_probes"))
                return { rows: [] } as never;
            throw new Error(`Unexpected query: ${sql}`);
        }),
    };
}

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mocks.gatewayTranscription.mockReset();
});

describe("STT route probes", () => {
    it("lists probe-enabled models from the requested team and project only", async () => {
        const db = database([
            {
                modelId: "openrouter:whisper-large-v3-turbo",
                routeId: "openrouter-audio-transcriptions",
                status: "available",
                reason: null,
                probedAt: new Date("2026-07-14T00:00:00.000Z"),
            },
        ]);

        const models = await listSttRouteProbesPayload(
            db,
            config({ openrouterApiKey: "or-test" }),
            TEAM_ID,
            PROJECT_ID,
        );

        expect(models).toContainEqual(
            expect.objectContaining({
                modelId: "openrouter:whisper-large-v3-turbo",
                availabilityStatus: "available",
                probe: expect.objectContaining({ status: "available" }),
            }),
        );
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("where team_id = $1 and project_id = $2"),
            [TEAM_ID, PROJECT_ID],
        );
    });

    it("runs the real OpenRouter request shape and persists a successful probe", async () => {
        const db = database();
        vi.mocked(fetch).mockResolvedValue(
            new Response(
                JSON.stringify({ text: "Flash Evals route verification." }),
                {
                    status: 200,
                },
            ),
        );

        const result = await createSttRouteProbePayload(
            db,
            config({ openrouterApiKey: "or-test" }),
            {
                teamId: TEAM_ID,
                projectId: PROJECT_ID,
                modelId: "openrouter:whisper-large-v3-turbo",
                probedBy: USER_ID,
            },
        );

        expect(result).toEqual(
            expect.objectContaining({
                status: "available",
                transcript: "Flash Evals route verification.",
            }),
        );
        const requestForm = vi.mocked(fetch).mock.calls[0]?.[1]
            ?.body as FormData;
        expect(requestForm.get("model")).toBe("openai/whisper-large-v3-turbo");
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("insert into stt_route_probes"),
            expect.arrayContaining([TEAM_ID, PROJECT_ID, "available", USER_ID]),
        );
    });

    it("returns and persists a safe provider error without exposing raw JSON", async () => {
        const db = database();
        vi.mocked(fetch).mockResolvedValue(
            new Response('{"error":"route denied"}', { status: 403 }),
        );

        const result = await createSttRouteProbePayload(
            db,
            config({ openrouterApiKey: "or-test" }),
            {
                teamId: TEAM_ID,
                projectId: PROJECT_ID,
                modelId: "openrouter:whisper-large-v3-turbo",
                probedBy: USER_ID,
            },
        );

        expect(result).toEqual(
            expect.objectContaining({
                status: "failed",
                error: "The provider rejected the stored API key for this transcription route.",
            }),
        );
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("insert into stt_route_probes"),
            expect.arrayContaining([
                "failed",
                "The provider rejected the stored API key for this transcription route.",
            ]),
        );
    });

    it("verifies Vercel Gateway through the AI SDK transcription transport", async () => {
        const db = database();
        mocks.gatewayTranscription.mockResolvedValue({
            text: "Flash Evals route verification.",
        });

        const result = await createSttRouteProbePayload(
            db,
            config({ aiGatewayApiKey: "gateway-test" }),
            {
                teamId: TEAM_ID,
                projectId: PROJECT_ID,
                modelId: "vercel:openai/gpt-4o-transcribe",
                probedBy: USER_ID,
            },
        );

        expect(result).toEqual(
            expect.objectContaining({
                status: "available",
                transcript: "Flash Evals route verification.",
            }),
        );
        expect(mocks.gatewayTranscription).toHaveBeenCalledWith({
            audio: expect.any(Uint8Array),
            mediaType: "audio/wav",
        });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("classifies unsupported audio responses separately", async () => {
        const db = database();
        vi.mocked(fetch).mockResolvedValue(
            new Response("unsupported audio type", { status: 415 }),
        );

        const result = await createSttRouteProbePayload(
            db,
            config({ openrouterApiKey: "or-test" }),
            {
                teamId: TEAM_ID,
                projectId: PROJECT_ID,
                modelId: "openrouter:whisper-large-v3-turbo",
                probedBy: USER_ID,
            },
        );

        expect(result).toEqual(
            expect.objectContaining({
                status: "unsupported_input",
                error: "The provider does not accept the built-in non-speech audio probe.",
            }),
        );
    });

    it("verifies Gemini with the structured-output contract used by runs", async () => {
        const db = database();
        vi.mocked(fetch).mockResolvedValue(
            new Response(
                JSON.stringify({
                    candidates: [
                        {
                            content: {
                                parts: [
                                    {
                                        text: JSON.stringify({
                                            text: "Flash Evals route verification.",
                                            segments: [],
                                        }),
                                    },
                                ],
                            },
                        },
                    ],
                }),
                { status: 200 },
            ),
        );

        const result = await createSttRouteProbePayload(
            db,
            config({ geminiApiKey: "gemini-test" }),
            {
                teamId: TEAM_ID,
                projectId: PROJECT_ID,
                modelId: "gemini:gemini-2.5-flash",
                probedBy: USER_ID,
            },
        );

        const request = vi.mocked(fetch).mock.calls[0];
        const body = JSON.parse(String(request[1]?.body)) as {
            generationConfig: Record<string, unknown>;
        };
        expect(body.generationConfig).toEqual(
            expect.objectContaining({
                responseMimeType: "application/json",
                responseSchema: expect.any(Object),
                maxOutputTokens: 32_768,
            }),
        );
        expect(result).toEqual(
            expect.objectContaining({
                status: "available",
                transcript: "Flash Evals route verification.",
            }),
        );
    });

    it("lets environment probe configuration override persisted state", async () => {
        const probes = await teamSttCapabilityProbes(
            database([
                {
                    modelId: "gemini:gemini-2.5-flash",
                    routeId: "gemini-generate-content-audio",
                    status: "failed",
                    reason: "old failure",
                    probedAt: new Date(),
                },
            ]),
            config({
                sttCapabilityProbes: {
                    "gemini:gemini-2.5-flash": { status: "available" },
                },
            }),
            TEAM_ID,
            PROJECT_ID,
        );

        expect(probes["gemini:gemini-2.5-flash"]).toEqual({
            status: "available",
        });
    });

    it("omits environment-managed routes from manual verification", async () => {
        const managed = config({
            geminiApiKey: "gemini-test",
            sttCapabilityProbes: {
                "gemini:gemini-2.5-flash": { status: "provider_error" },
            },
        });

        const models = await listSttRouteProbesPayload(
            database(),
            managed,
            TEAM_ID,
            PROJECT_ID,
        );

        expect(models).not.toContainEqual(
            expect.objectContaining({ modelId: "gemini:gemini-2.5-flash" }),
        );
        await expect(
            createSttRouteProbePayload(database(), managed, {
                teamId: TEAM_ID,
                projectId: PROJECT_ID,
                modelId: "gemini:gemini-2.5-flash",
                probedBy: USER_ID,
            }),
        ).rejects.toThrow(
            "This STT route is managed by MOSAIC_STT_CAPABILITY_PROBES.",
        );
        expect(fetch).not.toHaveBeenCalled();
    });

    it("does not persist a probe if its provider key changes in flight", async () => {
        const changing = config();
        let keyRead = 0;
        Object.defineProperty(changing, "openrouterApiKey", {
            get: () => (++keyRead === 1 ? "old-key" : "new-key"),
        });
        const db = database();
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ text: "old key worked" }), {
                status: 200,
            }),
        );

        await expect(
            createSttRouteProbePayload(db, changing, {
                teamId: TEAM_ID,
                projectId: PROJECT_ID,
                modelId: "openrouter:whisper-large-v3-turbo",
                probedBy: USER_ID,
            }),
        ).rejects.toThrow(
            "The provider key changed during route verification. Verify the route again.",
        );
        expect(db.query).not.toHaveBeenCalledWith(
            expect.stringContaining("insert into stt_route_probes"),
            expect.anything(),
        );
    });
});
