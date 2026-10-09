import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@mosaic/llm-core";
import {
    listAvailableModelMetadata,
    providerModeFromEnv,
} from "@mosaic/llm-core";
import { pricingFor, resolvePricingFor } from "./pricing";

vi.mock("@mosaic/llm-core", async (importOriginal) => {
    const actual = await importOriginal<typeof LlmCore>();
    return {
        ...actual,
        listAvailableModelMetadata: vi.fn(),
        providerModeFromEnv: vi.fn(() => "openai"),
    };
});

const mockListAvailableModelMetadata = vi.mocked(listAvailableModelMetadata);
const mockProviderModeFromEnv = vi.mocked(providerModeFromEnv);

const M = 1_000_000;

describe("pricingFor", () => {
    beforeEach(() => {
        mockListAvailableModelMetadata.mockReset();
        mockProviderModeFromEnv.mockReset();
        mockProviderModeFromEnv.mockReturnValue("openai");
    });

    const EXPECTED: Record<string, [number, number]> = {
        "gpt-4o": [2.5, 10],
        "gpt-4o-mini": [0.15, 0.6],
        "gpt-4.1": [2, 8],
        "gpt-4.1-mini": [0.4, 1.6],
        "gpt-4.1-nano": [0.1, 0.4],
        "gpt-5.5": [5, 30],
        "gpt-5.4": [2.5, 15],
        "gpt-5.4-mini": [0.75, 4.5],
        "gpt-5.4-nano": [0.2, 1.25],
    };

    for (const [modelId, [promptPerM, completionPerM]] of Object.entries(
        EXPECTED,
    )) {
        it(`prices ${modelId} at the carried-over rate`, () => {
            const pricing = pricingFor(modelId);
            expect(pricing).toBeDefined();
            expect(pricing?.promptPricePerToken).toBeCloseTo(
                promptPerM / M,
                12,
            );
            expect(pricing?.completionPricePerToken).toBeCloseTo(
                completionPerM / M,
                12,
            );
        });
    }

    it("bills gpt-4o-mini at its own rate, not the gpt-4o prefix rate", () => {
        expect(pricingFor("gpt-4o-mini")?.promptPricePerToken).toBeCloseTo(
            0.15 / M,
            12,
        );
    });

    it("bills gpt-5.4-mini at its own rate, not the gpt-5.4 prefix rate", () => {
        expect(pricingFor("gpt-5.4-mini")?.promptPricePerToken).toBeCloseTo(
            0.75 / M,
            12,
        );
    });

    it("prices dated snapshot variants via prefix match", () => {
        expect(
            pricingFor("gpt-4o-2024-08-06")?.promptPricePerToken,
        ).toBeCloseTo(2.5 / M, 12);
    });

    it("returns undefined for unknown models so cost is recorded unavailable", () => {
        expect(pricingFor("nonexistent-model")).toBeUndefined();
    });

    it("returns undefined for known Gateway models without static pricing", () => {
        expect(pricingFor("anthropic/claude-sonnet-4.5")).toBeUndefined();
    });

    it("returns undefined for removed legacy models", () => {
        expect(pricingFor("gpt-5")).toBeUndefined();
        expect(pricingFor("o3")).toBeUndefined();
    });

    it("returns undefined for fine-tune ids (unchanged behavior — cost unavailable)", () => {
        expect(pricingFor("ft:gpt-4o-mini:acme:abc123")).toBeUndefined();
    });

    it("resolves static pricing before trying Gateway metadata", async () => {
        await expect(resolvePricingFor("gpt-4o", {})).resolves.toEqual(
            pricingFor("gpt-4o"),
        );
        expect(mockListAvailableModelMetadata).not.toHaveBeenCalled();
    });

    it("resolves live Gateway pricing when no static price exists", async () => {
        mockProviderModeFromEnv.mockReturnValue("gateway");
        mockListAvailableModelMetadata.mockResolvedValue([
            {
                id: "anthropic/claude-sonnet-4.5",
                pricing: {
                    promptPricePerToken: 3 / M,
                    completionPricePerToken: 15 / M,
                },
            },
        ]);

        await expect(
            resolvePricingFor("anthropic/claude-sonnet-4.5", {
                gateway: "vck-test-live",
            }),
        ).resolves.toMatchObject({
            promptPricePerToken: 3 / M,
            completionPricePerToken: 15 / M,
        });
    });

    it("keeps unresolved models unavailable outside Gateway mode", async () => {
        await expect(
            resolvePricingFor("anthropic/claude-sonnet-4.5", {
                gateway: "vck-test-unused",
            }),
        ).resolves.toBeUndefined();
        expect(mockListAvailableModelMetadata).not.toHaveBeenCalled();
    });
});
