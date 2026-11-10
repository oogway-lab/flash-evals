import { afterEach, describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@flash-evals/llm-core";
import type { CompletionResult } from "@flash-evals/llm-core";
import { getEvalProvider } from "@flash-evals/llm-core";

vi.mock("@flash-evals/llm-core", async (importOriginal) => {
    const actual = await importOriginal<typeof LlmCore>();
    return { ...actual, getEvalProvider: vi.fn() };
});

import {
    DEFAULT_PROVIDER_CONCURRENCY,
    getLimitedEvalProvider,
    parseProviderConcurrency,
    providerConcurrencyWarnings,
} from "./providerConcurrency";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

const RESULT: CompletionResult = {
    text: "{}",
    usage: {},
    latencyMs: 1,
};

/** A provider whose calls wait until released; counts calls in flight. */
function gatedProvider() {
    const gates: Array<() => void> = [];
    const state = { inFlight: 0, maxInFlight: 0, calls: 0 };
    const complete = vi.fn(async () => {
        state.calls += 1;
        state.inFlight += 1;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
        const gate = deferred();
        gates.push(gate.resolve);
        await gate.promise;
        state.inFlight -= 1;
        return RESULT;
    });
    vi.mocked(getEvalProvider).mockReturnValue({ complete });
    return {
        state,
        complete,
        releaseAll: () => gates.splice(0).forEach((release) => release()),
    };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getEvalProvider).mockReset();
});

describe("parseProviderConcurrency", () => {
    it("reads a default and per-provider overrides, ignoring bad values", () => {
        expect(parseProviderConcurrency(undefined)).toEqual({
            defaultLimit: DEFAULT_PROVIDER_CONCURRENCY,
            byTransport: {},
        });
        expect(
            parseProviderConcurrency("3, openrouter=8, anthropic=0, google=x"),
        ).toEqual({ defaultLimit: 3, byTransport: { openrouter: 8 } });
        expect(parseProviderConcurrency("-1")).toMatchObject({
            defaultLimit: DEFAULT_PROVIDER_CONCURRENCY,
        });
    });
});

describe("parseProviderConcurrency strictness", () => {
    it("ignores partial or fractional numbers and reads names in any case", () => {
        expect(
            parseProviderConcurrency("10abc, OpenRouter=7, gateway=2.5"),
        ).toEqual({
            defaultLimit: DEFAULT_PROVIDER_CONCURRENCY,
            byTransport: { openrouter: 7 },
        });
    });

    it("reports ignored values and unknown provider names", () => {
        expect(
            providerConcurrencyWarnings("3, openruter=4, OPENAI=2, gateway=x"),
        ).toEqual([
            expect.stringContaining('"openruter" is not a known provider'),
            expect.stringContaining('"gateway=x" is not a whole positive'),
        ]);
        expect(providerConcurrencyWarnings("5,openrouter=10")).toEqual([]);
    });
});

describe("getLimitedEvalProvider", () => {
    it("keeps calls to one provider under its limit, generation and judges alike", async () => {
        vi.stubEnv("FLASH_EVALS_PROVIDER_CONCURRENCY", "2");
        const provider = gatedProvider();
        const keys = { openrouter: "or-test" };
        const generation = getLimitedEvalProvider(keys, {
            transport: "openrouter",
        });
        const judge = getLimitedEvalProvider(keys, {
            transport: "openrouter",
        });

        const calls = [
            generation.complete({
                model: "a/model",
                prompt: "1",
                maxTokens: 100,
            }),
            generation.complete({
                model: "a/model",
                prompt: "2",
                maxTokens: 100,
            }),
            judge.complete({ model: "a/judge", prompt: "3", maxTokens: 100 }),
            judge.complete({ model: "a/judge", prompt: "4", maxTokens: 100 }),
        ];
        await flush();
        expect(provider.state.calls).toBe(2);

        while (provider.state.calls < 4 || provider.state.inFlight > 0) {
            provider.releaseAll();
            await flush();
        }
        await Promise.all(calls);
        expect(provider.state.maxInFlight).toBe(2);
    });

    it("gives each provider its own slots", async () => {
        vi.stubEnv("FLASH_EVALS_PROVIDER_CONCURRENCY", "1");
        const provider = gatedProvider();
        const calls = [
            getLimitedEvalProvider(
                { openrouter: "or-test" },
                { transport: "openrouter" },
            ).complete({ model: "a/model", prompt: "1", maxTokens: 100 }),
            getLimitedEvalProvider(
                { anthropic: "ant-test" },
                { transport: "anthropic" },
            ).complete({ model: "claude-model", prompt: "2", maxTokens: 100 }),
        ];
        await flush();
        expect(provider.state.inFlight).toBe(2);
        provider.releaseAll();
        await Promise.all(calls);
    });

    it("does not retry a call cut off by the output limit, and frees its slot", async () => {
        vi.stubEnv("FLASH_EVALS_PROVIDER_CONCURRENCY", "1");
        const complete = vi
            .fn()
            .mockRejectedValueOnce(
                new Error(
                    "OpenRouter reached the output token limit for a/model. Increase max output tokens and try again.",
                ),
            )
            .mockResolvedValue(RESULT);
        vi.mocked(getEvalProvider).mockReturnValue({ complete });
        const provider = getLimitedEvalProvider(
            { openrouter: "or-test" },
            { transport: "openrouter" },
        );

        await expect(
            provider.complete({
                model: "a/model",
                prompt: "long",
                maxTokens: 100,
            }),
        ).rejects.toThrow("output token limit");
        expect(complete).toHaveBeenCalledOnce();
        await expect(
            provider.complete({
                model: "a/model",
                prompt: "next",
                maxTokens: 100,
            }),
        ).resolves.toBe(RESULT);
    });
});
