import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createJudgePromptPayload: vi.fn(),
    deletePromptPayload: vi.fn(),
    duplicatePromptVersionPayload: vi.fn(),
}));

vi.mock("../../routes/prompts.js", () => ({
    ...mocks,
    generatePromptSchemaPayload: vi.fn(),
    listPromptsPayload: vi.fn(),
    optimizePromptPayload: vi.fn(),
    promptDetailPayload: vi.fn(),
    saveRunnablePromptPayload: vi.fn(),
    testJudgeDraftPayload: vi.fn(),
    testPromptDraftPayload: vi.fn(),
    validateRunnablePromptPayload: vi.fn(),
}));
vi.mock("../../routes/runs.js", () => ({
    generateJudgeForRunPayload: vi.fn(),
}));

import { registerPromptTools } from "./prompts.js";
import {
    createToolHarness,
    expectConfirmationGate,
    TEST_PROJECT_ID,
} from "./testSupport.js";

const PROJECT_ID = TEST_PROJECT_ID;
const PROMPT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

describe("MCP prompt management tools", () => {
    beforeEach(() => vi.clearAllMocks());

    it("registers judge creation, version duplication, and prompt deletion", () => {
        const { tools } = registerTools();

        expect([...tools.keys()].slice(-3)).toEqual([
            "create_judge_prompt",
            "duplicate_prompt_version",
            "delete_prompt",
        ]);
    });

    it("creates a judge prompt in the principal-owned project", async () => {
        const { tools, runtime } = registerTools();
        mocks.createJudgePromptPayload.mockResolvedValue({
            promptId: PROMPT_ID,
            promptVersionId: VERSION_ID,
        });

        await tools.get("create_judge_prompt")!.handler({
            projectId: PROJECT_ID,
            name: "Quality judge",
            modelId: "gpt-4o",
            rubricPrompt: "Score the answer.",
            declaredInputs: ["task_input", "candidate_output"],
            reasoningEffort: "medium",
        });

        expect(mocks.createJudgePromptPayload).toHaveBeenCalledWith(
            runtime.db,
            {
                teamId: "team-1",
                projectId: PROJECT_ID,
                name: "Quality judge",
                modelId: "gpt-4o",
                rubricPrompt: "Score the answer.",
                judgeSpec: {
                    modelId: "gpt-4o",
                    declaredInputs: ["task_input", "candidate_output"],
                },
                reasoningConfig: { effort: "medium" },
                createdBy: "user-1",
            },
        );
    });

    it("duplicates a version without accepting client-owned scope", async () => {
        const { tools, runtime } = registerTools();
        mocks.duplicatePromptVersionPayload.mockResolvedValue({
            sourcePromptVersionId: VERSION_ID,
            promptId: PROMPT_ID,
            promptVersionId: "33333333-3333-4333-8333-333333333333",
        });

        const result = (await tools.get("duplicate_prompt_version")!.handler({
            projectId: PROJECT_ID,
            sourcePromptVersionId: VERSION_ID,
        })) as { structuredContent: { data: Record<string, unknown> } };

        expect(result.structuredContent.data).toEqual({
            sourcePromptVersionId: VERSION_ID,
            promptId: PROMPT_ID,
            promptVersionId: "33333333-3333-4333-8333-333333333333",
        });

        expect(mocks.duplicatePromptVersionPayload).toHaveBeenCalledWith(
            runtime.db,
            {
                teamId: "team-1",
                projectId: PROJECT_ID,
                sourcePromptVersionId: VERSION_ID,
                createdBy: "user-1",
            },
        );
    });

    it("requires confirmation and destructive annotations for prompt deletion", () => {
        const tool = registerTools().tools.get("delete_prompt")!;

        expectConfirmationGate(tool, {
            projectId: PROJECT_ID,
            promptId: PROMPT_ID,
        });
    });

    it.each([
        [
            "test_prompt_draft",
            {
                prompt: "Answer the question.",
                jsonSchema: { type: "object" },
                targetModelId: "gpt-4o",
            },
        ],
        [
            "validate_runnable_prompt",
            {
                projectId: PROJECT_ID,
                prompt: "Answer the question.",
                jsonSchema: { type: "object" },
                targetModelId: "gpt-4o",
            },
        ],
        [
            "create_runnable_prompt",
            {
                projectId: PROJECT_ID,
                name: "Answer prompt",
                content: "Answer the question.",
                jsonSchema: { type: "object" },
                fieldConfigs: [],
                targetModelId: "gpt-4o",
            },
        ],
    ] as const)("requires an input for each sample in %s", (name, base) => {
        const schema = registerTools().tools.get(name)!.config.inputSchema!;
        const withText = {
            ...base,
            samples: [{ name: "Question", inputText: "What is 2+2?" }],
        };
        const withImage = {
            ...base,
            samples: [
                { name: "Receipt", imageStorageKey: "datasets/item/image.png" },
            ],
        };
        const withoutInput = {
            ...base,
            samples: [{ name: "Empty" }],
        };

        expect(schema.safeParse(withText).success).toBe(true);
        expect(schema.safeParse(withImage).success).toBe(true);
        expect(
            schema.safeParse({
                ...base,
                samples: [{ name: "Blank text", inputText: "" }],
            }).success,
        ).toBe(true);
        expect(schema.safeParse(withoutInput).success).toBe(false);
    });
});

function registerTools() {
    return createToolHarness(registerPromptTools);
}
