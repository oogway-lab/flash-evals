import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPromptTools } from "./prompts.js";
import { createToolHarness, TEST_PROJECT_ID } from "./testSupport.js";

const schema = {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false,
};
const draft = {
    prompt: "Return an answer as JSON.",
    targetModelId: "gpt-4o-mini",
    jsonSchema: schema,
    samples: [{ name: "one", inputText: "hello" }],
};

function registerTools(defaultProvider = "openrouter") {
    const harness = createToolHarness(registerPromptTools, {
        config: {
            mosaicLlmProvider: defaultProvider,
            openaiApiKey: "synthetic-openai",
            openrouterApiKey: "synthetic-openrouter",
        },
    });
    vi.mocked(harness.runtime.db.query).mockImplementation(async (sql) => {
        if (sql.includes("from provider_keys")) return { rows: [] } as never;
        if (sql.includes("from projects")) {
            return { rows: [{ id: TEST_PROJECT_ID }] } as never;
        }
        if (sql.includes("max(version)")) return { rows: [] } as never;
        if (sql.trimStart().startsWith("insert into")) {
            return {
                rows: [
                    { id: "22222222-2222-4222-8222-222222222222", version: 1 },
                ],
            } as never;
        }
        throw new Error(`Unexpected database query: ${sql}`);
    });
    return harness;
}

afterEach(() => vi.unstubAllGlobals());

describe("MCP prompt provider parity", () => {
    it.each([
        {
            transport: "openai",
            defaultProvider: "openrouter",
            origin: "https://api.openai.com",
            model: "gpt-4o-mini",
        },
        {
            transport: "openrouter",
            defaultProvider: "openai",
            origin: "https://openrouter.ai",
            model: "openai/gpt-4o-mini",
        },
        {
            transport: undefined,
            defaultProvider: "openrouter",
            origin: "https://openrouter.ai",
            model: "gpt-4o-mini",
        },
    ])(
        "keeps $transport with default $defaultProvider through test, validation and creation",
        async ({ transport, defaultProvider, origin, model }) => {
            // Exercise the real provider factory and transports. Only HTTP responses
            // and persistence are synthetic; different provider URLs are observable.
            const requests: { url: string; model: string }[] = [];
            vi.stubGlobal(
                "fetch",
                vi.fn(async (url: string, init: RequestInit) => {
                    const body = JSON.parse(String(init.body));
                    requests.push({ url: String(url), model: body.model });
                    return new Response(
                        JSON.stringify({
                            id: "synthetic-completion",
                            choices: [
                                {
                                    message: { content: '{"answer":"ok"}' },
                                    finish_reason: "stop",
                                },
                            ],
                            usage: { prompt_tokens: 2, completion_tokens: 2 },
                        }),
                        {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        },
                    );
                }),
            );
            const { tools } = registerTools(defaultProvider);
            const inputs = [
                ["test_prompt_draft", { ...draft, transport }],
                [
                    "validate_runnable_prompt",
                    { ...draft, transport, projectId: TEST_PROJECT_ID },
                ],
                [
                    "create_runnable_prompt",
                    {
                        ...draft,
                        transport,
                        projectId: TEST_PROJECT_ID,
                        name: "Provider parity",
                        content: draft.prompt,
                        fieldConfigs: [],
                    },
                ],
            ] as const;
            for (const [name, input] of inputs) {
                const tool = tools.get(name)!;
                // Match the MCP SDK's parsing behavior, including stripping unknown
                // fields. Calling a handler with the raw input hid the original bug.
                const parsed = tool.config.inputSchema!.parse(input) as Record<
                    string,
                    unknown
                >;
                const result = await tool.handler(parsed);
                expect(result).toMatchObject({
                    structuredContent: {
                        data:
                            name === "test_prompt_draft"
                                ? { status: "success" }
                                : name === "validate_runnable_prompt"
                                  ? { passed: true }
                                  : { promptVersion: 1 },
                    },
                });
            }
            expect(requests).toHaveLength(3);
            expect(
                requests.map((request) => new URL(request.url).origin),
            ).toEqual([origin, origin, origin]);
            expect(requests.map((request) => request.model)).toEqual([
                model,
                model,
                model,
            ]);
        },
    );

    it("does not fall back to OpenRouter when explicit OpenAI credentials are missing", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const { tools, runtime } = registerTools();
        runtime.config.openaiApiKey = undefined;
        for (const name of [
            "test_prompt_draft",
            "validate_runnable_prompt",
            "create_runnable_prompt",
        ]) {
            const tool = tools.get(name)!;
            const input = tool.config.inputSchema!.parse({
                ...draft,
                transport: "openai",
                projectId: TEST_PROJECT_ID,
                name: "Explicit provider",
                content: draft.prompt,
                fieldConfigs: [],
            }) as Record<string, unknown>;
            const result = await tool.handler(input);
            expect(JSON.stringify(result)).toContain(
                "Please add your OpenAI API key",
            );
        }
        expect(fetchMock).not.toHaveBeenCalled();
        expect(
            vi
                .mocked(runtime.db.query)
                .mock.calls.some(([sql]) =>
                    sql.trimStart().startsWith("insert into prompts"),
                ),
        ).toBe(false);
    });

    it.each(["openai", "gateway", "openrouter", "bifrost"])(
        "accepts the same %s transport for all prompt tools",
        (transport) => {
            const { tools } = registerTools();
            for (const name of [
                "test_prompt_draft",
                "validate_runnable_prompt",
                "create_runnable_prompt",
            ]) {
                expect(
                    tools.get(name)!.config.inputSchema!.parse({
                        ...draft,
                        transport,
                        projectId: TEST_PROJECT_ID,
                        name: "Schema parity",
                        content: draft.prompt,
                        fieldConfigs: [],
                    }),
                ).toHaveProperty("transport", transport);
            }
        },
    );

    it("rejects an unsupported explicit transport instead of silently using the default", () => {
        const { tools } = registerTools();
        for (const name of [
            "test_prompt_draft",
            "validate_runnable_prompt",
            "create_runnable_prompt",
        ]) {
            expect(() =>
                tools.get(name)!.config.inputSchema!.parse({
                    ...draft,
                    transport: "not-a-provider",
                    projectId: TEST_PROJECT_ID,
                    name: "Schema parity",
                    content: draft.prompt,
                    fieldConfigs: [],
                }),
            ).toThrow();
        }
    });
});
