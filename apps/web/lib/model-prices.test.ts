import { describe, expect, it } from "vitest";
import type { IModelProviderOffer } from "@flash-evals/api-contract";
import {
    cheaperOffer,
    fmtPerMillion,
    offerPrice,
    offerSummary,
    providerList,
} from "./model-prices";

const offer = (
    transport: IModelProviderOffer["transport"],
    inputPerMillion?: number,
    outputPerMillion?: number,
    keySaved = true,
): IModelProviderOffer => ({
    transport,
    modelId: "m",
    keySaved,
    ...(inputPerMillion === undefined ? {} : { inputPerMillion }),
    ...(outputPerMillion === undefined ? {} : { outputPerMillion }),
});

describe("model prices", () => {
    it("formats prices per 1M tokens without float noise", () => {
        expect(fmtPerMillion(0.8)).toBe("$0.80");
        expect(fmtPerMillion(0.006)).toBe("$0.006");
        expect(fmtPerMillion(0.30000000000000004)).toBe("$0.30");
        expect(fmtPerMillion(0.0999994)).toBe("$0.10");
        expect(offerPrice(offer("gateway", 0.8, 2.55))).toBe("$0.80 / $2.55");
        expect(offerPrice(offer("gateway"))).toBeUndefined();
    });

    it("says which provider, the price, and when there's no key", () => {
        expect(offerSummary(offer("openrouter", 0.006, 6.8, false))).toBe(
            "OpenRouter · $0.006 / $6.80 per 1M tokens in / out · no key",
        );
        expect(offerSummary(offer("gateway"))).toBe(
            "Vercel AI Gateway · no price listed",
        );
    });

    it("marks a provider cheaper only when it is no dearer on input and output", () => {
        expect(
            cheaperOffer([
                offer("gateway", 0.14, 0.4),
                offer("openrouter", 0.2, 0.4),
            ]),
        ).toBe("gateway");
        // GLM 5.2: OpenRouter is cheaper in, Vercel cheaper out.
        expect(
            cheaperOffer([
                offer("gateway", 0.8, 2.55),
                offer("openrouter", 0.006, 6.8),
            ]),
        ).toBeUndefined();
        expect(
            cheaperOffer([offer("gateway", 2, 10), offer("openrouter", 2, 10)]),
        ).toBeUndefined();
        expect(cheaperOffer([offer("gateway", 1, 1)])).toBeUndefined();
    });

    it("lists provider names in plain English", () => {
        expect(providerList(["gateway"])).toBe("Vercel AI Gateway");
        expect(providerList(["gateway", "openrouter"])).toBe(
            "Vercel AI Gateway and OpenRouter",
        );
    });
});
