import { Buffer } from "node:buffer";
import type * as LlmCore from "@mosaic/llm-core";
import { encryptSecret } from "@mosaic/secrets";
import { describe, expect, it, vi } from "vitest";

const providerComplete = vi.hoisted(() => vi.fn(async () => ({ text: "ok" })));
vi.mock("@mosaic/llm-core", async (importOriginal) => ({
    ...(await importOriginal<typeof LlmCore>()),
    OpenAIEvalProvider: vi.fn(function () {
        return { complete: providerComplete };
    }),
}));
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import {
    assertTeamBaseUrl,
    resolveApiKeys,
    teamBaseUrlListingGuard,
    teamBaseUrlProviderOptions,
} from "./resolveApiKeys.js";

const KEY = Buffer.alloc(32, 4).toString("base64");
const TEAM_ID = "11111111-1111-4111-8111-111111111111";

function config(): IApiConfig {
    return {
        nodeEnv: "test",
        port: 1,
        databaseUrl: "postgres://test",
        storageAdapter: "local",
        supabaseUrl: "",
        supabaseServiceRoleKey: "",
        supabaseStorageBucket: "",
        clerkSecretKey: "test",
        mosaicTenancyMode: "single-org",
        mosaicAllowedEmailDomain: "example.com",
        corsOrigins: [],
        mosaicLlmProvider: "auto",
        openaiApiKey: "env-openai",
        aiGatewayApiKey: "env-gateway",
        sonioxApiKey: "env-soniox",
        openrouterApiKey: "env-openrouter",
        bifrostApiKey: "env-bifrost",
        sttCapabilityProbes: {},
        profilingEnabled: false,
        featureFlags: {},
        mosaicSecretsEncKey: KEY,
    } as unknown as IApiConfig;
}

function dbRows(rows: unknown[]): IDb {
    return { query: vi.fn(async () => ({ rows }) as never) };
}

function row(provider: string, secret: string, baseUrl: string | null = null) {
    return {
        provider,
        ...encryptSecret(secret, { teamId: TEAM_ID, provider }, KEY),
        baseUrl,
    };
}

describe("resolveApiKeys", () => {
    it("prefers team database keys over environment keys", async () => {
        const resolved = await resolveApiKeys(
            dbRows([row("openai", "db-openai")]),
            config(),
            TEAM_ID,
        );
        expect(resolved.apiKeys.openai).toBe("db-openai");
        expect(resolved.sttProviderKeys.openai).toBe("db-openai");
    });

    it("preserves environment fallback when the team has no key", async () => {
        const resolved = await resolveApiKeys(dbRows([]), config(), TEAM_ID);
        expect(resolved.apiKeys).toMatchObject({
            openai: "env-openai",
            gateway: "env-gateway",
        });
        expect(resolved.sttProviderKeys.soniox).toBe("env-soniox");
    });

    it("fails configuration when stored keys exist without a master key", async () => {
        await expect(
            resolveApiKeys(
                dbRows([row("openai", "db-openai")]),
                { ...config(), mosaicSecretsEncKey: undefined },
                TEAM_ID,
            ),
        ).rejects.toThrow(/MOSAIC_SECRETS_ENC_KEY/);
    });

    it("mixes a database OpenRouter key and URL with other environment keys", async () => {
        const resolved = await resolveApiKeys(
            dbRows([
                row("openrouter", "db-openrouter", "https://db.example/v1"),
            ]),
            config(),
            TEAM_ID,
        );
        expect(resolved.apiKeys).toMatchObject({
            openai: "env-openai",
            openrouter: "db-openrouter",
            openrouterBaseUrl: "https://db.example/v1",
        });
        expect([...resolved.storedBaseUrls]).toEqual(["https://db.example/v1"]);
    });

    it("does not treat operator env base URLs as team-saved", async () => {
        const resolved = await resolveApiKeys(
            dbRows([]),
            {
                ...config(),
                bifrostBaseUrl: "https://bifrost.internal/v1",
            } as IApiConfig,
            TEAM_ID,
        );
        const resolveHost = vi.fn(async () => ["10.0.0.5"]);

        expect(resolved.storedBaseUrls.size).toBe(0);
        await expect(
            assertTeamBaseUrl(
                resolved,
                resolved.apiKeys.bifrostBaseUrl,
                resolveHost,
            ),
        ).resolves.toBeUndefined();
        expect(resolveHost).not.toHaveBeenCalled();
    });

    it("falls back to environment router URLs when stored rows omit them", async () => {
        const resolved = await resolveApiKeys(
            dbRows([
                row("openrouter", "db-openrouter"),
                row("bifrost", "db-bifrost"),
            ]),
            {
                ...config(),
                openrouterBaseUrl: "https://env-openrouter.example/v1",
                bifrostBaseUrl: "https://env-bifrost.example/v1",
            },
            TEAM_ID,
        );
        expect(resolved.apiKeys.openrouterBaseUrl).toBe(
            "https://env-openrouter.example/v1",
        );
        expect(resolved.apiKeys.bifrostBaseUrl).toBe(
            "https://env-bifrost.example/v1",
        );
    });
});

describe("team base URL re-validation at use time", () => {
    const privateHost = async () => ["10.0.0.5"];
    const publicHost = async () => ["203.1.1.1"];

    async function teamKeys() {
        return resolveApiKeys(
            dbRows([
                row("openai", "db-openai"),
                row("bifrost", "db-bifrost", "https://bifrost.example/v1"),
            ]),
            config(),
            TEAM_ID,
        );
    }

    it("resolves keys without looking up any stored host", async () => {
        const lookup = vi.fn(privateHost);
        const resolved = await teamKeys();

        expect(resolved.apiKeys).toMatchObject({
            openai: "db-openai",
            bifrost: "db-bifrost",
            bifrostBaseUrl: "https://bifrost.example/v1",
        });
        // Only the transport that is actually listed gets checked.
        await expect(
            teamBaseUrlListingGuard(resolved, lookup)("openai"),
        ).resolves.toBeUndefined();
        expect(lookup).not.toHaveBeenCalled();
    });

    it("refuses a stored URL that now resolves to a private address with a 400", async () => {
        const resolved = await teamKeys();

        await expect(
            teamBaseUrlListingGuard(resolved, privateHost)("bifrost"),
        ).rejects.toMatchObject({
            status: 400,
            message: expect.stringMatching(/no longer allowed/),
        });
        await expect(
            assertTeamBaseUrl(
                {
                    ...resolved,
                    storedBaseUrls: new Set(["https://169.254.169.254/v1"]),
                },
                "https://169.254.169.254/v1",
                publicHost,
            ),
        ).rejects.toMatchObject({ status: 400 });
    });

    it("returns a retryable 503 when the stored host cannot be resolved", async () => {
        const resolved = await teamKeys();

        await expect(
            assertTeamBaseUrl(
                resolved,
                resolved.apiKeys.bifrostBaseUrl,
                async () => {
                    throw new Error("ENOTFOUND");
                },
            ),
        ).rejects.toMatchObject({ status: 503, code: "service_unavailable" });
    });

    it("checks the stored URL before each OpenAI-compatible completion", async () => {
        const resolved = await teamKeys();
        providerComplete.mockClear();
        const request = { model: "gpt-4o", messages: [] } as never;
        const baseURLOptions = {
            baseURL: "https://bifrost.example/v1",
            providerLabel: "Bifrost",
            transport: "bifrost" as const,
        };

        const blocked = teamBaseUrlProviderOptions(resolved, privateHost)
            .createOpenAICompatibleProvider!("db-bifrost", baseURLOptions);
        await expect(blocked.complete(request)).rejects.toMatchObject({
            status: 400,
        });
        expect(providerComplete).not.toHaveBeenCalled();

        const allowed = teamBaseUrlProviderOptions(resolved, publicHost)
            .createOpenAICompatibleProvider!("db-bifrost", baseURLOptions);
        await expect(allowed.complete(request)).resolves.toEqual({
            text: "ok",
        });
        expect(providerComplete).toHaveBeenCalledWith(request);
    });
});
