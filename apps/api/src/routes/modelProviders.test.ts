import { Buffer } from "node:buffer";
import { encryptSecret } from "@flash-evals/secrets";
import { describe, expect, it, vi } from "vitest";
import {
    registryEntryFor,
    type IModelRegistryEntry,
} from "@flash-evals/llm-core";
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import {
    defaultProvider,
    modelPriceListPayload,
    preferredOffer,
    providerOffers,
    savedKeyProviders,
    providerStatusPayload,
} from "./modelProviders.js";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const perToken = (input: number, output: number) => ({
    promptPricePerToken: input / 1e6,
    completionPricePerToken: output / 1e6,
});

const glm: IModelRegistryEntry = {
    id: "zai/glm-5.2",
    gatewayModelId: "zai/glm-5.2",
    label: "GLM 5.2",
    family: "glm",
    provider: "zai",
    providerLabel: "Z.ai",
    reasoning: false,
    vision: false,
    structuredOutput: true,
    judgeSuitable: true,
    supportsOpenAI: false,
    supportsGateway: true,
    transports: {
        gateway: "zai/glm-5.2",
        openrouter: "z-ai/glm-5.2",
        bifrost: "zai/glm-5.2",
    },
    pricingByTransport: {
        gateway: perToken(0.8, 2.55),
        openrouter: perToken(0.006, 6.8),
    },
};

function fakeDb(rows: (sql: string) => unknown[] = () => []): IDb {
    return {
        query: vi.fn(async (sql: string) => ({ rows: rows(sql) })),
    } as unknown as IDb;
}

describe("savedKeyProviders", () => {
    it("lists providers with a key, in the order the app offers them", () => {
        expect(
            savedKeyProviders({ openrouter: "or", openai: "sk", gateway: "" }),
        ).toEqual(["openrouter", "openai"]);
        expect(savedKeyProviders({ bifrost: "bf" })).toEqual([]);
        expect(
            savedKeyProviders({ google: "gm", anthropic: "an", gateway: "gw" }),
        ).toEqual(["gateway", "anthropic", "google"]);
    });
});

describe("providerOffers", () => {
    it("shows both price lists, keys or not, with each provider's own ID", () => {
        expect(providerOffers(glm, ["gateway"])).toEqual([
            {
                transport: "gateway",
                modelId: "zai/glm-5.2",
                inputPerMillion: 0.8,
                outputPerMillion: 2.55,
                keySaved: true,
            },
            {
                transport: "openrouter",
                modelId: "z-ai/glm-5.2",
                inputPerMillion: 0.006,
                outputPerMillion: 6.8,
                keySaved: false,
            },
        ]);
    });

    it("adds Bifrost or OpenAI only when their key is saved", () => {
        expect(
            providerOffers(glm, ["bifrost"]).map((offer) => offer.transport),
        ).toEqual(["gateway", "openrouter", "bifrost"]);
    });

    it("offers a maker's own API at its list price once its key is saved", () => {
        const sonnet = registryEntryFor("anthropic/claude-sonnet-5.5")!;
        expect(
            providerOffers(sonnet, []).some(
                (offer) => offer.transport === "anthropic",
            ),
        ).toBe(false);
        expect(
            providerOffers(sonnet, ["anthropic"]).find(
                (offer) => offer.transport === "anthropic",
            ),
        ).toEqual({
            transport: "anthropic",
            modelId: "claude-sonnet-5-5",
            inputPerMillion: 2,
            outputPerMillion: 10,
            keySaved: true,
        });
    });

    it("prefers the live price the provider returned", () => {
        const [gateway] = providerOffers(glm, ["gateway"], {
            gateway: perToken(1, 3),
        });
        expect(gateway).toMatchObject({
            inputPerMillion: 1,
            outputPerMillion: 3,
        });
    });
});

describe("preferredOffer", () => {
    const offers = providerOffers(glm, ["gateway", "openrouter"]);
    it("uses the preferred provider when it has a key", () => {
        expect(preferredOffer(offers, "openrouter")).toBe("openrouter");
    });
    it("ignores a preferred provider without a key or the model", () => {
        expect(
            preferredOffer(providerOffers(glm, ["gateway"]), "openrouter"),
        ).toBeUndefined();
        expect(preferredOffer(offers, "openai")).toBeUndefined();
    });
});

describe("defaultProvider", () => {
    it("follows FLASH_EVALS_LLM_PROVIDER from .env", () => {
        expect(defaultProvider({ flashEvalsLlmProvider: "gateway" })).toBe(
            "gateway",
        );
        expect(defaultProvider({ flashEvalsLlmProvider: "vercel-ai" })).toBe(
            "gateway",
        );
        expect(defaultProvider({ flashEvalsLlmProvider: "openrouter" })).toBe(
            "openrouter",
        );
        expect(defaultProvider({ flashEvalsLlmProvider: "auto" })).toBe(
            undefined,
        );
    });
});

describe("providerStatusPayload", () => {
    it("says where each key comes from, Settings winning over .env", async () => {
        const db = fakeDb((sql) =>
            sql.includes("select provider from provider_keys")
                ? [{ provider: "openrouter" }]
                : [],
        );
        const config = {
            flashEvalsLlmProvider: "gateway",
            aiGatewayApiKey: "from-env",
            openrouterApiKey: "also-in-env",
        } as IApiConfig;
        // The stored OpenRouter row can't be decrypted by the fake database,
        // so resolve keys from config alone and check only the labels.
        expect(await providerStatusPayload(db, config, TEAM_ID)).toEqual({
            defaultProvider: "gateway",
            keys: [
                { provider: "gateway", source: "env" },
                { provider: "openrouter", source: "settings" },
            ],
        });
    });

    it("shows the saved Gemini key as the Gemini API provider", async () => {
        const encKey = Buffer.alloc(32, 7).toString("base64");
        const stored = {
            provider: "gemini",
            ...encryptSecret(
                "test-gemini",
                { teamId: TEAM_ID, provider: "gemini" },
                encKey,
            ),
            baseUrl: null,
        };
        const db = fakeDb((sql) =>
            sql.includes("select provider from provider_keys")
                ? [{ provider: "gemini" }]
                : [stored],
        );
        const config = {
            flashEvalsLlmProvider: "auto",
            flashEvalsSecretsEncKey: encKey,
        } as IApiConfig;
        expect(await providerStatusPayload(db, config, TEAM_ID)).toEqual({
            keys: [{ provider: "google", source: "settings" }],
        });
    });

    it("re-checks a saved Bifrost address before fetching its model list", async () => {
        const encKey = Buffer.alloc(32, 7).toString("base64");
        const stored = {
            provider: "bifrost",
            ...encryptSecret(
                "test-bifrost",
                { teamId: TEAM_ID, provider: "bifrost" },
                encKey,
            ),
            baseUrl: "https://bifrost.example",
        };
        const db = fakeDb((sql) =>
            sql.includes("select provider from provider_keys")
                ? [{ provider: "bifrost" }]
                : [stored],
        );
        const config = {
            flashEvalsLlmProvider: "auto",
            flashEvalsSecretsEncKey: encKey,
        } as IApiConfig;
        const list = vi.fn(async () => []);

        const status = await providerStatusPayload(
            db,
            config,
            TEAM_ID,
            { list },
            async () => ["10.0.0.5"],
        );

        expect(list).not.toHaveBeenCalled();
        expect(status.bifrost).toEqual({
            baseUrlHost: "bifrost.example",
            modelListError: expect.stringMatching(/no longer allowed/),
        });
    });

    it("rejects a bad team ID", async () => {
        await expect(
            providerStatusPayload(fakeDb(), {} as IApiConfig, "team-1"),
        ).rejects.toThrow("teamId must be a valid UUID");
    });
});

describe("modelPriceListPayload", () => {
    it("lists both price lists with when they were fetched and which keys are saved", async () => {
        const db = fakeDb((sql) => {
            if (sql.includes("model_catalog_snapshots"))
                return [
                    {
                        source: "gateway",
                        fetchedAt: "2026-11-04T02:17:00.000Z",
                        modelCount: "310",
                    },
                ];
            return [];
        });
        const result = await modelPriceListPayload(
            db,
            { flashEvalsLlmProvider: "gateway" } as IApiConfig,
            TEAM_ID,
        );
        expect(result.lists).toEqual([
            {
                provider: "gateway",
                fetchedAt: "2026-11-04T02:17:00.000Z",
                modelCount: 310,
            },
            { provider: "openrouter", modelCount: 0 },
        ]);
        expect(result.savedKeyProviders).toEqual([]);
        expect(result.preferredProvider).toBe("gateway");
        expect(result.models.length).toBeGreaterThan(0);
        for (const row of result.models)
            for (const offer of row.providers) {
                expect(["gateway", "openrouter"]).toContain(offer.transport);
                expect(offer.keySaved).toBe(false);
            }
    });
});
