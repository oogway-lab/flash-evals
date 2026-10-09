import { describe, expect, it } from "vitest";
import { sttProviderKeysFromEnv } from "./providerKeys";

describe("sttProviderKeysFromEnv", () => {
    it("maps optional STT provider keys without preserving blank values", () => {
        expect(
            sttProviderKeysFromEnv({
                OPENAI_API_KEY: " sk-test ",
                AI_GATEWAY_API_KEY: "vck-test",
                SONIOX_API_KEY: "soniox-test",
                OPENROUTER_API_KEY: "",
                OPENROUTER_BASE_URL: " https://openrouter.example/api ",
                BIFROST_API_KEY: "   ",
                BIFROST_BASE_URL: "https://bifrost.example/api",
            }),
        ).toEqual({
            openai: "sk-test",
            vercelGateway: "vck-test",
            soniox: "soniox-test",
            openrouter: undefined,
            openrouterBaseUrl: "https://openrouter.example/api",
            bifrost: undefined,
            bifrostBaseUrl: "https://bifrost.example/api",
        });
    });
});
