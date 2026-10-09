import type {
    IImportFailure,
    IPromptOptimizerGuidanceSource,
    IPromptSampleInput,
    IPromptTestRunResponse,
    ISchemaCompatibilityIssue,
} from "@mosaic/api-contract";

export interface IActionState {
    ok?: boolean;
    resetKey?: number;
    formError?: string;
    fieldErrors?: Record<string, string[]>;
    importedCount?: number;
    failures?: IImportFailure[];
    rejected?: boolean;
}

export interface IPromptWorkbenchState extends IActionState {
    promptId?: string;
    promptKind?: "eval" | "judge";
    promptVersionId?: string;
    schemaVersionId?: string;
    optimizerAttemptId?: string;
    validationSummary?: string;
    originalPrompt?: string;
    optimizedPrompt?: string;
    optimizationRationale?: string;
    optimizationGuidanceSource?: IPromptOptimizerGuidanceSource;
    optimizerModelId?: string;
    optimizationTargetModelId?: string;
    structuredOutputNotes?: string[];
    fitTags?: string[];
}

export interface IPromptTestRunActionState extends IActionState {
    result?: IPromptTestRunResponse;
}

export interface IGenerateSchemaActionState extends IActionState {
    /** Pretty-printed generated schema, ready to fill the editor. */
    schema?: string;
    openaiCompatible?: boolean;
    compatibilityErrors?: ISchemaCompatibilityIssue[];
}

export interface IPromptJudgeTestActionState extends IActionState {
    result?: {
        score: number;
        rationale: string;
    };
}

export interface IPromptSampleSetActionState extends IActionState {
    promptId?: string;
    draftId?: string;
    sampleInputs?: IPromptSampleInput[];
}
