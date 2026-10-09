import { Buffer } from "node:buffer";
import { encryptSecret } from "@mosaic/secrets";
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
            ...encryptSecret("db-soniox", { teamId: TEAM_ID, provider: "soniox" }, KEY),
            baseUrl: null,
        });
        const resolved = await resolveApiKeys(TEAM_ID, {
            encryptionKey: KEY,
            env: { OPENAI_API_KEY: "env-openai", SONIOX_API_KEY: "env-soniox" },
        });
        expect(resolved.apiKeys.openai).toBe("env-openai");
        expect(resolved.sttProviderKeys.soniox).toBe("db-soniox");
    });

    it("fails when stored keys exist without a master key", async () => {
        rows.splice(0, rows.length, {
            provider: "openai",
            ...encryptSecret("db-openai", { teamId: TEAM_ID, provider: "openai" }, KEY),
            baseUrl: null,
        });

        await expect(
            resolveApiKeys(TEAM_ID, {
                env: { OPENAI_API_KEY: "env-openai" },
            }),
        ).rejects.toThrow(/MOSAIC_SECRETS_ENC_KEY/);
    });

    it("falls back to environment router URLs when stored rows omit them", async () => {
        rows.splice(0, rows.length,
            { provider: "openrouter", ...encryptSecret("db-openrouter", { teamId: TEAM_ID, provider: "openrouter" }, KEY), baseUrl: null },
            { provider: "bifrost", ...encryptSecret("db-bifrost", { teamId: TEAM_ID, provider: "bifrost" }, KEY), baseUrl: null },
        );
        const resolved = await resolveApiKeys(TEAM_ID, {
            encryptionKey: KEY,
            env: { OPENROUTER_BASE_URL: "https://env-openrouter.example/v1", BIFROST_BASE_URL: "https://env-bifrost.example/v1" },
        });
        expect(resolved.apiKeys.openrouterBaseUrl).toBe("https://env-openrouter.example/v1");
        expect(resolved.apiKeys.bifrostBaseUrl).toBe("https://env-bifrost.example/v1");
    });
});
