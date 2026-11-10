import { describe, expect, it } from "vitest";
import {
    describeWorkflowEnvKey,
    isWorkflowLlmTransport,
    providerKeyForWorkflowTransport,
    WORKFLOW_LLM_TRANSPORTS,
    workflowEnvKeySource,
    workflowTransportAcceptsEnvKey,
} from "./workflows.js";

describe("workflow LLM transports", () => {
    it("lets workflow steps call Anthropic and the Gemini API directly", () => {
        expect(WORKFLOW_LLM_TRANSPORTS).toEqual([
            "openai",
            "gateway",
            "openrouter",
            "bifrost",
            "anthropic",
            "google",
        ]);
        expect(isWorkflowLlmTransport("anthropic")).toBe(true);
        expect(isWorkflowLlmTransport("google")).toBe(true);
        expect(isWorkflowLlmTransport("gemini")).toBe(false);
        expect(isWorkflowLlmTransport(undefined)).toBe(false);
    });

    it("authenticates Gemini API steps with the saved Gemini key", () => {
        expect(providerKeyForWorkflowTransport("google")).toBe("gemini");
        expect(providerKeyForWorkflowTransport("anthropic")).toBe("anthropic");
        expect(providerKeyForWorkflowTransport("openrouter")).toBe(
            "openrouter",
        );
    });
});

describe("pipeline steps' keys from the server's .env", () => {
    it("accepts the env key for Vercel AI Gateway and Bifrost only", () => {
        expect(
            WORKFLOW_LLM_TRANSPORTS.filter(workflowTransportAcceptsEnvKey),
        ).toEqual(["gateway", "bifrost"]);
    });

    it("names the env variables each transport reads", () => {
        expect(workflowEnvKeySource("gateway")).toEqual({
            label: "Vercel AI Gateway",
            apiKeyEnv: "AI_GATEWAY_API_KEY",
        });
        expect(workflowEnvKeySource("openrouter")).toBeUndefined();
        expect(describeWorkflowEnvKey(workflowEnvKeySource("gateway")!)).toBe(
            "the Vercel AI Gateway key from the server's .env (AI_GATEWAY_API_KEY)",
        );
        expect(describeWorkflowEnvKey(workflowEnvKeySource("bifrost")!)).toBe(
            "the Bifrost key from the server's .env (BIFROST_API_KEY and BIFROST_BASE_URL)",
        );
    });
});
