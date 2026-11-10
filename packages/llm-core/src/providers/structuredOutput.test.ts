import { describe, expect, it, vi } from "vitest";
import { extractJsonObject } from "./structuredOutput.js";
import { OpenAIEvalProvider } from "./openai.js";
import { GatewayEvalProvider } from "./gateway.js";

describe("extractJsonObject", () => {
    it("reads a bare object, a fenced block or an object inside prose", () => {
        expect(extractJsonObject('{"a":1}')).toEqual({ value: { a: 1 } });
        expect(extractJsonObject('Here:\n```json\n{"a":2}\n```\nDone')).toEqual(
            { value: { a: 2 } },
        );
        expect(extractJsonObject('Sure! {"a":3} Hope it helps.')).toEqual({
            value: { a: 3 },
        });
    });

    it("says why there is no object", () => {
        expect(extractJsonObject("")).toEqual({
            error: "The reply was empty.",
        });
        expect(extractJsonObject("no json here")).toEqual({
            error: "No JSON object was found in the reply.",
        });
        expect(extractJsonObject("[1,2]")).toEqual({
            error: "The reply's JSON is not an object.",
        });
    });
});

describe("JSON mode", () => {
    it("asks OpenAI-compatible routes for json_object without a schema", async () => {
        const response = {
            id: "gen-1",
            model: "m",
            choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
        const create = vi.fn((..._args: unknown[]) => {
            const request = Promise.resolve(response) as Promise<
                typeof response
            > & { withResponse(): Promise<unknown> };
            request.withResponse = async () => ({
                data: response,
                response: new Response(null),
            });
            return request;
        });
        const parse = vi.fn();
        const provider = new OpenAIEvalProvider("secret", {
            transport: "openrouter",
            client: { chat: { completions: { create, parse } } } as never,
        });
        await provider.complete({
            model: "openai/gpt-4o",
            prompt: "hi",
            maxTokens: 10,
            jsonMode: true,
        });
        expect(create.mock.calls[0]?.[0]).toMatchObject({
            response_format: { type: "json_object" },
        });
        expect(parse).not.toHaveBeenCalled();
    });

    it("asks the gateway for JSON output without a schema", async () => {
        const generate = vi.fn().mockResolvedValue({
            text: "{}",
            output: {},
            usage: {
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
                inputTokenDetails: {},
                outputTokenDetails: {},
            },
        });
        const provider = new GatewayEvalProvider("secret", {
            generateText: generate,
            modelFor: () => ({}) as never,
        });
        await provider.complete({
            model: "gpt-4o",
            prompt: "hi",
            maxTokens: 10,
            jsonMode: true,
        });
        expect(generate.mock.calls[0]?.[0].output).toBeDefined();
    });
});
