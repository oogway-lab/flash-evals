import type { IWorkflowNodeInput } from "@flash-evals/api-contract";
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
    "anthropic",
    "google",
]);
const BenchmarkSource = z.enum(["model", "labels"]);
const BenchmarkTaskBase = {
    key: z.string().min(1).describe('Lowercase id, e.g. "competitors".'),
    name: z.string().min(1),
    description: z.string().optional(),
    source: BenchmarkSource.optional().describe(
        "This task's yardstick; the run's benchmark.source when absent.",
    ),
};
export const BenchmarkConfig = z
    .object({
        source: BenchmarkSource.optional().describe(
            '"model" (default): referenceModel is the benchmark. "labels": the dataset\'s stored answers are the benchmark and every model is a candidate. A task\'s own source overrides it, e.g. one hand-checked field against the stored answers and the rest against referenceModel.',
        ),
        taskMap: z.object({
            tasks: z
                .array(
                    z.discriminatedUnion("method", [
                        z.object({
                            ...BenchmarkTaskBase,
                            method: z.literal("agreement"),
                            fields: z
                                .array(
                                    z.intersection(
                                        z.object({ path: z.string().min(1) }),
                                        FieldMatcherSpec,
                                    ),
                                )
                                .min(1),
                            judgeDisagreements: z.boolean().optional(),
                            textMatching: z
                                .object({
                                    aliases: z
                                        .record(
                                            z.string().min(1),
                                            z.array(z.string().min(1)),
                                        )
                                        .optional(),
                                    fuzzy: z.number().gt(0).max(1).optional(),
                                })
                                .optional()
                                .describe(
                                    "Text is always compared ignoring case, accents, spaces and punctuation. aliases maps a canonical name to other spellings; fuzzy (0-1, e.g. 0.85) also matches close spellings.",
                                ),
                        }),
                        z.object({
                            ...BenchmarkTaskBase,
                            method: z.literal("head_to_head"),
                            paths: z.array(z.string().min(1)).min(1),
                            rubric: z.string().optional(),
                        }),
                        z.object({
                            ...BenchmarkTaskBase,
                            method: z.literal("rules"),
                            rules: z
                                .array(
                                    z.object({
                                        key: z.string().min(1),
                                        name: z.string().min(1),
                                        kind: z.enum([
                                            "pattern_absent",
                                            "in_list",
                                            "contains_all",
                                            "word_count",
                                        ]),
                                        paths: z
                                            .array(z.string().min(1))
                                            .min(1),
                                        patterns: z
                                            .array(z.string().min(1))
                                            .optional()
                                            .describe(
                                                "pattern_absent: case-insensitive regular expressions (JavaScript syntax, no lookarounds or backreferences) that must not appear.",
                                            ),
                                        allowed: z
                                            .array(z.string())
                                            .optional()
                                            .describe(
                                                "in_list: every value in the fields must be one of these.",
                                            ),
                                        required: z
                                            .array(z.string())
                                            .optional()
                                            .describe(
                                                "contains_all: text the fields must contain (an empty field passes).",
                                            ),
                                        min: z
                                            .number()
                                            .int()
                                            .min(0)
                                            .optional()
                                            .describe(
                                                "word_count: fewest words each field may hold (words are runs of non-whitespace; a list of strings counts as one text; a missing or non-text field fails). Set min, max or both. Put length limits here, not in a head_to_head rubric or rubric criteria: LLM judges miscount words.",
                                            ),
                                        max: z
                                            .number()
                                            .int()
                                            .min(0)
                                            .optional()
                                            .describe(
                                                "word_count: most words each field may hold.",
                                            ),
                                    }),
                                )
                                .min(1),
                        }),
                        z.object({
                            ...BenchmarkTaskBase,
                            method: z.literal("rubric"),
                            paths: z.array(z.string().min(1)).min(1),
                            criteria: z
                                .array(
                                    z.object({
                                        key: z.string().min(1),
                                        name: z.string().min(1),
                                        description: z.string().optional(),
                                    }),
                                )
                                .min(1)
                                .describe(
                                    "The judge scores every model's answer, the reference's included, 1-5 on each criterion.",
                                ),
                            instructions: z
                                .string()
                                .optional()
                                .describe(
                                    "Extra context for the judge, e.g. official product names.",
                                ),
                        }),
                    ]),
                )
                .min(1),
        }),
        judge: z
            .object({
                modelId: z.string().min(1),
                transport: ProviderTransport.optional(),
                reasoningEffort: ReasoningEffort.optional(),
            })
            .optional(),
        policy: z
            .object({
                minAgreement: z.number().min(0).max(1).optional(),
                minWinOrTieRate: z.number().min(0).max(1).optional(),
                maxRelativeCost: z.number().positive().optional(),
                tasks: z
                    .record(
                        z.string(),
                        z.object({
                            minAgreement: z.number().min(0).max(1).optional(),
                            minWinOrTieRate: z
                                .number()
                                .min(0)
                                .max(1)
                                .optional(),
                        }),
                    )
                    .optional(),
            })
            .optional()
            .describe(
                "Verdict limits. Rates are 0 to 1; maxRelativeCost is cost as a share of the benchmark's (0.4 = 40%). Defaults: 0.9 agreement, 0.9 won-or-tied, no cost limit.",
            ),
    })
    .describe(
        "Score every model against referenceModel, task by task. Agreement tasks compare output fields at JSON paths like $.competitors; head_to_head tasks ask the judge model, blind, which answer is better; rules tasks run fixed checks on each model's own answer (no yardstick, no model call).",
    );
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
    orderOnly: z
        .boolean()
        .optional()
        .describe(
            "Order only: the target step runs after the source (so its run condition can check it) but reads the original input, not the source's answer.",
        ),
});

export const RunDataPolicy = z
    .object({
        onlyHosts: z
            .array(z.string().min(1).max(63))
            .max(30)
            .optional()
            .describe(
                'Hosting companies allowed to serve calls, in the gateway\'s own names (Vercel: "vertex", "bedrock"; OpenRouter: "google-vertex", "together").',
            ),
        zeroDataRetention: z
            .boolean()
            .optional()
            .describe("Only hosts with a zero-data-retention agreement."),
        disallowPromptTraining: z
            .boolean()
            .optional()
            .describe("Only hosts that don't train on prompts."),
    })
    .strict();

export const SttRunConfig = z.object({
    modelId: z.string().min(1),
    providerId: z
        .enum([
            "openai",
            "vercel-gateway",
            "soniox",
            "elevenlabs",
            "openrouter",
            "bifrost",
            "gemini",
        ])
        .optional(),
    routeId: z.string().optional(),
    canonicalModelId: z.string().optional(),
    language: z.string().optional(),
    config: JsonObject.optional(),
    levelVolume: z
        .boolean()
        .optional()
        .describe(
            "Level volume first: normalise loudness with FFmpeg (loudnorm I=-23, TP=-2, LRA=11; 16 kHz mono WAV) before the audio goes to the provider. Use for quiet recordings or when transcripts come back empty. Off by default.",
        ),
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

const WorkflowStepCondition = z
    .object({
        stepKey: z.string().min(1),
        path: z.string(),
        operator: z.enum(["equals", "one_of"]),
        values: z
            .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
            .min(1),
        ignoreCase: z
            .boolean()
            .optional()
            .describe('Compare text ignoring case ("Sales" matches "sales").'),
    })
    .strict();

const WorkflowStepSettings = z
    .object({
        temperature: z
            .number()
            .min(0)
            .max(2)
            .optional()
            .describe("0 to 2; not sent to models that refuse temperature."),
        maxOutputTokens: z
            .number()
            .int()
            .min(1)
            .max(200_000)
            .optional()
            .describe("Most output tokens per call, thinking included."),
        outputMode: z
            .enum(["json_schema", "json_object", "text"])
            .optional()
            .describe(
                "Steps with an output schema: json_schema (default) has the provider enforce it; json_object asks for any JSON object; text asks for nothing and reads the JSON object from the reply. The schema checks the parsed answer in the last two.",
            ),
        inputTemplate: z
            .string()
            .max(20_000)
            .optional()
            .describe(
                "Builds the step's user message instead of the default <input>/<from node> blocks. Placeholders: {{input}} (the whole item), {{input.<name>}} (the item's <name>…</name> section, or a JSON item's field), {{input.<name>.<field>}} (a field of the JSON inside that section), {{Step.$.path}} (an earlier step's answer, by label or key; only steps upstream of this one), {{Step.$ | pick:a,b}} (some fields as one JSON object).",
            ),
    })
    .strict();

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
    runCondition: z
        .union([
            WorkflowStepCondition,
            z
                .object({ all: z.array(WorkflowStepCondition).min(1).max(20) })
                .strict(),
        ])
        .nullable()
        .optional()
        .describe(
            'Run this step only when fields of earlier steps\' answers match: one condition, or { "all": [...] } for several that must all hold. Otherwise it and later steps are skipped for that item.',
        ),
    stepSettings: WorkflowStepSettings.nullable()
        .optional()
        .describe(
            "Prompt and LLM text steps only: settings sent on every call of this step, on every provider. Unset values keep the route's (Simple mode: 4,096 output tokens, no temperature).",
        ),
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
