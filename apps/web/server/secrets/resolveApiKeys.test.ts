import { Buffer } from "node:buffer";
import { encryptSecret } from "@flash-evals/secrets";
import { getEvalProvider } from "@flash-evals/llm-core";
import { describe, expect, it, vi } from "vitest";

const KEY = Buffer.alloc(32, 6).toString("base64");
const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const rows: unknown[] = [];
vi.mock("../db/client", () => ({
    db: {
        select: () => ({ from: () => ({ where: async () => rows }) }),
    },
}));

import { resolveApiKeys } from "./resolveApiKeys";

describe("resolveApiKeys", () => {
    it("overrides Soniox from the team database while retaining env fallbacks", async () => {
        rows.splice(0, rows.length, {
            provider: "soniox",
            ...encryptSecret(
                "db-soniox",
                { teamId: TEAM_ID, provider: "soniox" },
                KEY,
            ),
            baseUrl: null,
        });
        const resolved = await resolveApiKeys(TEAM_ID, {
            encryptionKey: KEY,
            env: { OPENAI_API_KEY: "env-openai", SONIOX_API_KEY: "env-soniox" },
        });
        expect(resolved.apiKeys.openai).toBe("env-openai");
        expect(resolved.sttProviderKeys.soniox).toBe("db-soniox");
    });

    it("takes the ElevenLabs key from Settings first, then .env", async () => {
        const env = { ELEVENLABS_API_KEY: "env-elevenlabs" };
        rows.splice(0, rows.length);
        const fallback = await resolveApiKeys(TEAM_ID, {
            encryptionKey: KEY,
            env,
        });
        expect(fallback.sttProviderKeys.elevenlabs).toBe("env-elevenlabs");
        rows.splice(0, rows.length, {
            provider: "elevenlabs",
            ...encryptSecret(
                "db-elevenlabs",
                { teamId: TEAM_ID, provider: "elevenlabs" },
                KEY,
            ),
            baseUrl: null,
        });
        const saved = await resolveApiKeys(TEAM_ID, {
            encryptionKey: KEY,
            env,
        });
        expect(saved.sttProviderKeys.elevenlabs).toBe("db-elevenlabs");
    });

    it("takes direct maker keys from Settings only", async () => {
        const env = {
            ANTHROPIC_API_KEY: "env-anthropic",
            GEMINI_API_KEY: "env-gemini",
        };
        rows.splice(0, rows.length);
        const none = await resolveApiKeys(TEAM_ID, { encryptionKey: KEY, env });
        expect(none.apiKeys.anthropic).toBeUndefined();
        expect(none.apiKeys.google).toBeUndefined();

        rows.splice(
            0,
            rows.length,
            ...["anthropic", "gemini"].map((provider) => ({
                provider,
                ...encryptSecret(
                    `db-${provider}`,
                    { teamId: TEAM_ID, provider },
                    KEY,
                ),
                baseUrl: null,
            })),
        );
        const saved = await resolveApiKeys(TEAM_ID, {
            encryptionKey: KEY,
            env,
        });
        expect(saved.apiKeys).toMatchObject({
            anthropic: "db-anthropic",
            google: "db-gemini",
        });
        expect(saved.sttProviderKeys.gemini).toBe("db-gemini");
    });

    it("fails when stored keys exist without a master key", async () => {
        rows.splice(0, rows.length, {
            provider: "openai",
            ...encryptSecret(
                "db-openai",
                { teamId: TEAM_ID, provider: "openai" },
                KEY,
            ),
            baseUrl: null,
        });

        await expect(
            resolveApiKeys(TEAM_ID, {
                env: { OPENAI_API_KEY: "env-openai" },
            }),
        ).rejects.toThrow(/FLASH_EVALS_SECRETS_ENC_KEY/);
    });

    it("never pairs a saved key with the .env router URL", async () => {
        rows.splice(
            0,
            rows.length,
            {
                provider: "openrouter",
                ...encryptSecret(
                    "db-openrouter",
                    { teamId: TEAM_ID, provider: "openrouter" },
                    KEY,
                ),
                baseUrl: null,
            },
            {
                provider: "bifrost",
                ...encryptSecret(
                    "db-bifrost",
                    { teamId: TEAM_ID, provider: "bifrost" },
                    KEY,
                ),
                baseUrl: null,
            },
        );
        const resolved = await resolveApiKeys(TEAM_ID, {
            encryptionKey: KEY,
            env: {
                OPENROUTER_BASE_URL: "https://env-openrouter.example/v1",
                BIFROST_API_KEY: "env-bifrost",
                BIFROST_BASE_URL: "https://env-bifrost.example/v1",
            },
        });
        // OpenRouter's saved key goes to the public default, not .env's URL.
        expect(resolved.apiKeys.openrouter).toBe("db-openrouter");
        expect(resolved.apiKeys.openrouterBaseUrl).toBeUndefined();
        expect(resolved.sttProviderKeys.openrouterBaseUrl).toBeUndefined();
        // Bifrost has no public default: neither key is used.
        expect(resolved.apiKeys.bifrost).toBeUndefined();
        expect(resolved.apiKeys.bifrostBaseUrl).toBeUndefined();
        expect(resolved.sttProviderKeys.bifrost).toBeUndefined();
        expect(resolved.apiKeys.unusable?.bifrost).toMatch(/no base URL/);
    });

    it("checks a saved base URL again before the worker uses it", async () => {
        const savedBifrost = (baseUrl: string) => ({
            provider: "bifrost",
            ...encryptSecret(
                "db-bifrost",
                { teamId: TEAM_ID, provider: "bifrost" },
                KEY,
            ),
            baseUrl,
        });
        const env = {
            BIFROST_API_KEY: "env-bifrost",
            BIFROST_BASE_URL: "https://env-bifrost.example/v1",
        };
        rows.splice(0, rows.length, savedBifrost("https://bifrost.example"));
        // DNS now points the saved host at a private address: Bifrost is
        // left out (no .env fallback) and a Bifrost call says why.
        const rebound = await resolveApiKeys(TEAM_ID, {
            encryptionKey: KEY,
            env,
            resolveHost: async () => ["10.0.0.5"],
        });
        expect(rebound.apiKeys.bifrost).toBeUndefined();
        expect(rebound.apiKeys.bifrostBaseUrl).toBeUndefined();
        expect(rebound.sttProviderKeys.bifrost).toBeUndefined();
        expect(rebound.apiKeys.unusable?.bifrost).toBe(
            "The saved provider base URL is no longer allowed (baseUrl hostname must resolve only to public addresses). Update it in Settings, then try again.",
        );
        expect(() =>
            getEvalProvider(rebound.apiKeys, { provider: "bifrost" }),
        ).toThrow("no longer allowed");
        const lookupFailed = await resolveApiKeys(TEAM_ID, {
            encryptionKey: KEY,
            env: {},
            resolveHost: async () => {
                throw new Error("ENOTFOUND");
            },
        });
        expect(lookupFailed.apiKeys.unusable?.bifrost).toMatch(
            "could not be resolved right now",
        );
        const resolved = await resolveApiKeys(TEAM_ID, {
            encryptionKey: KEY,
            env: {},
            resolveHost: async () => ["203.0.114.7"],
        });
        expect(resolved.apiKeys.bifrostBaseUrl).toBe("https://bifrost.example");
        expect(resolved.apiKeys.unusable).toBeUndefined();
        rows.splice(0, rows.length, savedBifrost("http://127.0.0.1:8080"));
        expect(
            (await resolveApiKeys(TEAM_ID, { encryptionKey: KEY, env: {} }))
                .apiKeys.unusable?.bifrost,
        ).toMatch("no longer allowed");
    });

    it("does not fail a run over an unused provider's saved base URL", async () => {
        rows.splice(
            0,
            rows.length,
            {
                provider: "bifrost",
                ...encryptSecret(
                    "db-bifrost",
                    { teamId: TEAM_ID, provider: "bifrost" },
                    KEY,
                ),
                baseUrl: "https://bifrost.example",
            },
            {
                provider: "gateway",
                ...encryptSecret(
                    "db-gateway",
                    { teamId: TEAM_ID, provider: "gateway" },
                    KEY,
                ),
                baseUrl: null,
            },
        );
        const resolved = await resolveApiKeys(TEAM_ID, {
            encryptionKey: KEY,
            env: {},
            resolveHost: async () => ["10.0.0.5"],
        });
        expect(resolved.apiKeys.gateway).toBe("db-gateway");
        expect(resolved.apiKeys.bifrost).toBeUndefined();
    });
});
