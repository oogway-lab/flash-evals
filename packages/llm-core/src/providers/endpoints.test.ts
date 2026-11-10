import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEvalProvider } from "./factory.js";
import { listAvailableModels } from "./models.js";

interface ISentRequest {
    url: string;
    headers: Headers;
}

/**
 * Every call fails at the network layer after its address and headers are
 * recorded, so no request leaves the test.
 */
function captureFetch(): ISentRequest[] {
    const sent: ISentRequest[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input instanceof Request ? input.url : String(input);
            const headers = new Headers(
                input instanceof Request ? input.headers : init?.headers,
            );
            sent.push({ url, headers });
            return new Response(JSON.stringify({ error: "stub" }), {
                status: 400,
                headers: { "content-type": "application/json" },
            });
        }),
    );
    return sent;
}

describe("provider addresses ignore the shell environment", () => {
    beforeEach(() => {
        vi.stubEnv("OPENAI_BASE_URL", "https://shell-openai.invalid/v1");
        vi.stubEnv("ANTHROPIC_BASE_URL", "https://shell-anthropic.invalid/v1");
        vi.stubEnv("OPENAI_ORG_ID", "org-from-shell");
        vi.stubEnv("OPENAI_PROJECT_ID", "proj-from-shell");
        vi.stubEnv("OPENAI_CUSTOM_HEADERS", "x-from-shell: 1");
        vi.stubEnv("OPENAI_ADMIN_KEY", "sk-admin-from-shell");
        vi.stubEnv("FLASH_EVALS_LLM_PROVIDER", "");
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    const request = {
        model: "gpt-4o-mini",
        prompt: "hi",
        maxTokens: 16,
        maxRetries: 0,
    };

    it("openai transport calls api.openai.com without org or project", async () => {
        const sent = captureFetch();
        await expect(
            getEvalProvider(
                { openai: "sk-test" },
                { transport: "openai" },
            ).complete(request),
        ).rejects.toThrow();
        expect(sent.length).toBeGreaterThan(0);
        for (const { url, headers } of sent) {
            expect(new URL(url).host).toBe("api.openai.com");
            expect(headers.get("openai-organization")).toBeNull();
            expect(headers.get("openai-project")).toBeNull();
            expect(headers.get("x-from-shell")).toBeNull();
            expect(headers.get("authorization")).toBe("Bearer sk-test");
        }
    });

    it("vercel-ai mode calls api.openai.com", async () => {
        const sent = captureFetch();
        await expect(
            getEvalProvider(
                { openai: "sk-test" },
                { provider: "vercel-ai" },
            ).complete(request),
        ).rejects.toThrow();
        expect(sent.length).toBeGreaterThan(0);
        for (const { url } of sent)
            expect(new URL(url).host).toBe("api.openai.com");
    });

    it("direct Anthropic calls api.anthropic.com", async () => {
        const sent = captureFetch();
        await expect(
            getEvalProvider(
                { anthropic: "sk-ant-test" },
                { transport: "anthropic" },
            ).complete({ ...request, model: "anthropic/claude-sonnet-4.6" }),
        ).rejects.toThrow();
        expect(sent.length).toBeGreaterThan(0);
        for (const { url } of sent)
            expect(new URL(url).host).toBe("api.anthropic.com");
    });

    it("listing OpenAI models calls api.openai.com", async () => {
        const sent = captureFetch();
        await expect(
            listAvailableModels({ openai: "sk-test" }, { provider: "openai" }),
        ).rejects.toThrow();
        expect(sent.length).toBeGreaterThan(0);
        for (const { url, headers } of sent) {
            expect(new URL(url).host).toBe("api.openai.com");
            expect(headers.get("openai-organization")).toBeNull();
        }
    });
});
