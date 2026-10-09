import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    runSetupPayload: vi.fn(),
    listProviderKeysPayload: vi.fn(),
    listWorkflowLlmCapabilitiesPayload: vi.fn(),
    listWorkflowLlmRoutesPayload: vi.fn(),
    getWorkflowLlmProjectDefaultPayload: vi.fn(),
}));

vi.mock("../../routes/runs.js", () => ({
    runSetupPayload: mocks.runSetupPayload,
}));
vi.mock("../../routes/keys.js", () => ({
    listProviderKeysPayload: mocks.listProviderKeysPayload,
}));
vi.mock("../../routes/llmRouting.js", () => ({
    listWorkflowLlmCapabilitiesPayload:
        mocks.listWorkflowLlmCapabilitiesPayload,
    listWorkflowLlmRoutesPayload: mocks.listWorkflowLlmRoutesPayload,
    getWorkflowLlmProjectDefaultPayload:
        mocks.getWorkflowLlmProjectDefaultPayload,
}));

import { registerContextTools } from "./context.js";
import {
    createToolHarness,
    TEST_PROJECT_ID,
    TEST_TEAM_ID,
} from "./testSupport.js";

describe("MCP eval context", () => {
    beforeEach(() => vi.clearAllMocks());

    it("loads setup context without contacting live providers", async () => {
        const { tools, runtime } = createToolHarness(registerContextTools);
        mocks.runSetupPayload.mockResolvedValue({ datasets: [] });
        mocks.listWorkflowLlmCapabilitiesPayload.mockResolvedValue([]);
        mocks.listWorkflowLlmRoutesPayload.mockResolvedValue([]);
        mocks.getWorkflowLlmProjectDefaultPayload.mockResolvedValue({
            default: { routeVersionId: "version-1" },
        });
        mocks.listProviderKeysPayload.mockResolvedValue([
            {
                id: "key-1",
                provider: "openrouter",
                baseUrl: "https://openrouter.ai/api/v1",
                hint: "…1234",
                encryptedKey: "must-not-leak",
            },
        ]);
        const response = await tools.get("list_eval_context")!.handler({
            projectId: TEST_PROJECT_ID,
        });

        expect(mocks.listWorkflowLlmCapabilitiesPayload).toHaveBeenCalledWith(
            runtime.db,
            TEST_TEAM_ID,
            TEST_PROJECT_ID,
        );
        expect(response).toMatchObject({
            structuredContent: {
                data: {
                    datasets: [],
                    llmRouting: {
                        capabilities: [],
                        routes: [],
                        default: {
                            default: { routeVersionId: "version-1" },
                        },
                        credentials: [
                            {
                                provider: "openrouter",
                                configured: true,
                                baseUrl: "https://openrouter.ai/api/v1",
                            },
                        ],
                    },
                },
            },
        });
        expect(JSON.stringify(response)).not.toContain('"providerModels"');
        expect(JSON.stringify(response)).not.toMatch(
            /must-not-leak|encryptedKey|…1234/,
        );
    });
});
