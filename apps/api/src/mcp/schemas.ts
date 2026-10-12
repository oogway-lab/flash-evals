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
export const ReviewVerdict = z.enum([
    "unreviewed",
    "approved",
    "needs_review",
    "issue",
]);
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

export const SchemaCompatibilityIssue = z.object({
    path: z.string(),
    code: z.string(),
    message: z.string(),
});

export const PromptValidationEvidence = z.object({
    staticChecks: z.array(SchemaCompatibilityIssue),
    schemaValidation: z.object({
        localValid: z.boolean(),
        openaiCompatible: z.boolean(),
        errors: z.array(SchemaCompatibilityIssue),
    }),
    sampleResults: z.array(
        z.object({
            sampleName: z.string(),
            status: z.enum(["passed", "failed", "provider_error", "cancelled"]),
            rawOutput: z.string().optional(),
            parsedOutput: z.unknown().optional(),
            errors: z.array(SchemaCompatibilityIssue),
        }),
    ),
});

export const RunnablePromptCreateOutcome = z.discriminatedUnion("outcome", [
    z.object({
        outcome: z.literal("saved"),
        promptId: z.string().uuid(),
        promptVersionId: z.string().uuid(),
        promptVersion: z.number().int(),
        schemaVersionId: z.string().uuid(),
    }),
    z.object({
        outcome: z.literal("validation_failed"),
        passed: z.literal(false),
        evidence: PromptValidationEvidence,
        failureMessage: z.string().optional(),
    }),
    z.object({
        outcome: z.literal("provider_error"),
        passed: z.literal(false),
        evidence: PromptValidationEvidence,
        failureMessage: z.string().optional(),
    }),
]);

export const McpRecoverableError = z.object({
    code: z.string(),
    message: z.string(),
    status: z.number().int(),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().nonnegative().optional(),
    field: z.string().optional(),
    remediation: z.string().optional(),
    requestId: z.string().uuid(),
});

export function mcpToolOutput(data: z.ZodType) {
    return z
        .object({
            data: data.optional(),
            error: McpRecoverableError.optional(),
        })
        .superRefine(({ data: result, error }, ctx) => {
            if ((result === undefined) === (error === undefined)) {
                ctx.addIssue({
                    code: "custom",
                    message: "Provide either data or error, but not both.",
                });
            }
        });
}

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
