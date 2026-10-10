import type { IWorkflowNodeInput } from "@mosaic/api-contract";
import { z } from "zod";
import { WorkflowLlmSelection } from "../routes/llmRoutingSchemas.js";

export const JsonObject = z.record(z.string(), z.unknown());
export const ProjectId = z.string().uuid().describe("Project to operate in.");
export const WorkspaceId = z
    .string()
    .uuid()
    .describe("Workspace that contains the project.");
export const ImageFile = z.object({
    name: z.string().min(1),
    mimeType: z.string().min(1),
    size: z.number().int().nonnegative(),
    base64Data: z.string().min(1),
});
export const AudioFile = ImageFile;
const FieldMatcherSpec = z.union([
    z.object({ matcher: z.literal("exact") }),
    z.object({
        matcher: z.literal("numeric_tolerance"),
        tolerance: z.number().nonnegative(),
        relative: z.boolean().optional(),
    }),
    z.object({ matcher: z.literal("set_overlap") }),
]);
export const FieldConfig = z.union([
    z.object({
        field: z.string().min(1),
        kind: z.literal("factual"),
        spec: FieldMatcherSpec.optional(),
    }),
    z.object({
        field: z.string().min(1),
        kind: z.literal("generative"),
        rubric: z.string().min(1),
        modelId: z.string().min(1),
    }),
]);
export const ReasoningEffort = z.enum([
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
]);
export const ReasoningConfig = z.object({ effort: ReasoningEffort });
export const ProviderTransport = z.enum([
    "openai",
    "gateway",
    "openrouter",
    "bifrost",
]);
export const JudgeDeclaredInput = z.enum([
    "task_input",
    "candidate_output",
    "reference",
]);
export const PromptSampleInput = z
    .object({
        name: z.string().min(1),
        inputText: z.string().optional(),
        imageStorageKey: z.string().min(1).optional(),
        imageMimeType: z.string().optional(),
    })
    .refine(
        (sample) =>
            sample.inputText !== undefined ||
            sample.imageStorageKey !== undefined,
        { message: "Provide inputText or imageStorageKey for each sample." },
    );

const WorkflowNodeEvalConfig = z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({
        type: z.literal("judge"),
        judgeConfigId: z.string().uuid().optional(),
        judgePromptVersionId: z.string().uuid().optional(),
    }),
    z.object({
        type: z.literal("field_diff"),
        fieldConfigs: z.array(FieldConfig),
    }),
]);

export const WorkflowEdgeInput = z.object({
    fromNodeKey: z.string().min(1),
    toNodeKey: z.string().min(1),
    carryOriginalInput: z.boolean(),
});

export const SttRunConfig = z.object({
    modelId: z.string().min(1),
    providerId: z
        .enum([
            "openai",
            "vercel-gateway",
            "soniox",
            "openrouter",
            "bifrost",
            "gemini",
        ])
        .optional(),
    routeId: z.string().optional(),
    canonicalModelId: z.string().optional(),
    language: z.string().optional(),
    config: JsonObject.optional(),
    transcriptVariant: z.enum(["raw", "latin"]).optional(),
    transliteration: z
        .object({
            enabled: z.boolean(),
            targetScript: z.literal("latin"),
            targetLanguage: z.string().optional(),
            modelId: z.string().min(1),
            providerMode: z
                .enum([
                    "auto",
                    "vercel-ai",
                    "openai",
                    "gateway",
                    "openrouter",
                    "bifrost",
                ])
                .optional(),
            providerBaseUrl: z.string().optional(),
            prompt: z.string().optional(),
            temperature: z.number().optional(),
        })
        .optional(),
    evaluator: z
        .object({
            enabled: z.boolean(),
            modelId: z.string().min(1),
            rubricPrompt: z.string().min(1),
            reasoningEffort: ReasoningEffort.optional(),
        })
        .optional(),
});

const WorkflowNodeBase = {
    // Echoed back by `get_workflow` and meaningless on write. Accepted and
    // ignored so an agent can edit a graph it just read without stripping the
    // API's own identity fields first.
    id: z.string().optional(),
    workflowId: z.string().optional(),
    nodeKey: z.string().min(1),
    label: z.string().min(1),
    reasoningConfig: ReasoningConfig.optional(),
    evalConfig: WorkflowNodeEvalConfig,
    position: z
        .object({ x: z.number().finite(), y: z.number().finite() })
        .nullable()
        .optional(),
};

const WorkflowLlmNodeBase = {
    ...WorkflowNodeBase,
    llmExecutionSelection: WorkflowLlmSelection.optional(),
};

const WorkflowNodeUnion = z.discriminatedUnion("nodeType", [
    z
        .object({
            ...WorkflowLlmNodeBase,
            nodeType: z.literal("prompt").optional(),
            nodeConfig: z
                .object({ type: z.literal("prompt") })
                .strict()
                .optional(),
            promptVersionId: z.string().uuid(),
            modelId: z.string().min(1),
        })
        .strict(),
    z
        .object({
            ...WorkflowNodeBase,
            nodeType: z.literal("input"),
            nodeConfig: z
                .object({
                    type: z.literal("input"),
                    modality: z.enum(["audio", "image", "text"]),
                    datasetId: z.string().optional(),
                })
                .strict(),
        })
        .strict(),
    z
        .object({
            ...WorkflowNodeBase,
            nodeType: z.literal("stt"),
            nodeConfig: z
                .object({ type: z.literal("stt"), sttConfig: SttRunConfig })
                .strict(),
        })
        .strict(),
    z
        .object({
            ...WorkflowLlmNodeBase,
            nodeType: z.literal("llm_text"),
            nodeConfig: z
                .object({ type: z.literal("llm_text"), promptText: z.string() })
                .strict(),
            modelId: z.string().min(1),
        })
        .strict(),
    z
        .object({
            ...WorkflowLlmNodeBase,
            nodeType: z.literal("transliterate"),
            nodeConfig: z
                .object({
                    type: z.literal("transliterate"),
                    transliteration:
                        SttRunConfig.shape.transliteration.unwrap(),
                })
                .strict(),
            modelId: z.string().min(1).optional(),
        })
        .strict(),
    z
        .object({
            ...WorkflowLlmNodeBase,
            nodeType: z.literal("judge"),
            nodeConfig: z
                .object({ type: z.literal("judge"), rubricPrompt: z.string() })
                .strict(),
            modelId: z.string().min(1),
        })
        .strict(),
    z
        .object({
            ...WorkflowNodeBase,
            nodeType: z.literal("metric_compare"),
            nodeConfig: z
                .object({
                    type: z.literal("metric_compare"),
                    referenceField: z.enum([
                        "expectedTranscript",
                        "expectedTranscriptLatin",
                    ]),
                })
                .strict(),
        })
        .strict(),
]);

export const WorkflowNodeInput = z.preprocess((value) => {
    if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        !("nodeType" in value)
    ) {
        return { ...value, nodeType: "prompt" };
    }
    return value;
}, WorkflowNodeUnion);

type IsAssignable<T, U> = T extends U ? true : false;
type Assert<T extends true> = T;
export type WorkflowNodeInputContractCheck = Assert<
    IsAssignable<z.infer<typeof WorkflowNodeInput>, IWorkflowNodeInput>
>;
export type WorkflowNodeInputSchemaCheck = Assert<
    IsAssignable<IWorkflowNodeInput, z.infer<typeof WorkflowNodeInput>>
>;
