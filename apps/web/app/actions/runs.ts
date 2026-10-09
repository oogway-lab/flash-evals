"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveProject as requirePrincipal } from "@/server/projects/activeProject";
import { clientErrorMessage, UserFacingError } from "@/server/lib/errors";
import { serverApiClient } from "@/server/api/client";
import {
    type AudioRunMode,
    type ICreateRunFromSelectionRequest,
    type IPipelineFieldConfig,
    type IPromptAssignment,
    type IReasoningConfigAssignment,
    type ITransportAssignment,
    type ReasoningEffort,
    type ISttRunConfig,
    type ISttRunEvaluation,
    type ISttRunVariant,
    type ProviderTransport,
} from "@mosaic/api-contract";
import { actionErrorState, parseJsonField } from "./shared";
import type { IActionState } from "./types";

export type IGenerateJudgeResult =
    { ok: true; rubricPrompt: string } | { ok: false; error: string };

// Draft a run-scoped judge rubric from the dataset + prompt the user has
// selected in New Run, before any output exists. The result is editable.
export async function generateJudgeForRunAction(
    promptVersionId: string,
    datasetId: string,
): Promise<IGenerateJudgeResult> {
    const p = await requirePrincipal();
    try {
        const result = await serverApiClient().generateJudgeForRun(
            {
                teamId: p.teamId,
                projectId: p.projectId,
                promptVersionId,
                datasetId,
            },
            { teamId: p.teamId, actorId: p.userId },
        );
        return { ok: true, rubricPrompt: result.rubricPrompt };
    } catch (err) {
        return { ok: false, error: clientErrorMessage(err) };
    }
}

export async function deleteRunAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const p = await requirePrincipal();
    const runId = String(formData.get("runId"));
    try {
        await serverApiClient().deleteRun({
            teamId: p.teamId,
            projectId: p.projectId,
            runId,
        });
    } catch (err) {
        return actionErrorState(err);
    }
    revalidatePath("/runs");
    revalidatePath(`/runs/${runId}`);
    return { ok: true, resetKey: Date.now() };
}

// API rejections a user can act on: validation, missing references, conflicts
// (e.g. the team spend cap), and rate limits.
export async function createRunAction(
    stateOrFormData: IActionState | FormData,
    submittedFormData?: FormData,
): Promise<IActionState> {
    const formData = submittedFormData ?? (stateOrFormData as FormData);
    const p = await requirePrincipal();
    const sharedResult = parseSharedRunInput(formData);
    if (!sharedResult.ok) return sharedResult.state;

    const buildResult =
        sharedResult.value.mode === "stt_metrics"
            ? buildSttMetricsRunRequest(sharedResult.value, p)
            : buildPromptEvalRunRequest(formData, sharedResult.value, p);
    if (!buildResult.ok) return buildResult.state;

    let runId: string;
    try {
        const created = await serverApiClient().createRunFromSelection(
            buildResult.request,
        );
        runId = created.runId;
    } catch (err) {
        const message = clientErrorMessage(err);
        const variantError = sttVariantErrorState(
            buildResult.request.sttVariants,
            message,
        );
        if (variantError) return variantError;
        if (
            message.includes("does not support the") &&
            message.includes("transport")
        ) {
            return {
                fieldErrors: { models: [message] },
                formError: message,
            };
        }
        if (message.includes("generative-field scoring")) {
            return {
                fieldErrors: { judgePromptVersionId: [message] },
                formError: message,
            };
        }
        if (
            message.includes("STT model") ||
            message.includes("STT variant") ||
            message.includes("audio transcription") ||
            message.includes("transcription")
        ) {
            return {
                fieldErrors: { sttModelId: [message] },
                formError: message,
            };
        }
        // Anything else (5xx included) stays on the form; clientErrorMessage
        // has already hidden internal details behind a generic message.
        return { formError: message };
    }
    redirect(`/runs/${runId}`);
    return { ok: true };
}

function sttVariantErrorState(
    variants: ISttRunVariant[] | undefined,
    message: string,
): IActionState | undefined {
    const variant = variants?.find((candidate) =>
        message.includes(`Variant '${candidate.label}'`),
    );
    if (!variant) return undefined;
    const field = `stt-${variant.variantKey}-model`;
    return { fieldErrors: { [field]: [message] }, formError: message };
}

interface ISharedRunInput {
    mode: AudioRunMode;
    audioRunMode?: AudioRunMode;
    datasetId: string;
    maxTokens: number;
    judgeModelId: string;
    sourceRunId?: string;
    sttConfig?: ISttRunConfig;
    sttVariants?: ISttRunVariant[];
    sttEvaluation?: ISttRunEvaluation;
}

type ICreateRunBuildResult =
    | { ok: true; request: ICreateRunFromSelectionRequest }
    | { ok: false; state: IActionState };

type ISttConfigParseResult =
    { ok: true; value?: ISttRunConfig } | { ok: false; state: IActionState };

type ISttVariantsParseResult =
    | {
          ok: true;
          variants?: ISttRunVariant[];
          evaluation?: ISttRunEvaluation;
      }
    | { ok: false; state: IActionState };

interface IPromptEvalInput {
    promptVersionId: string;
    pipelineId?: string;
    judgeConfigId?: string;
    judgeRubric: string;
    judgeReasoningEffort?: ReasoningEffort;
    judgeTransport?: ProviderTransport;
    judgePromptVersionId?: string;
    referenceModel: string;
    modelIds: string[];
    promptAssignments: IPromptAssignment[];
    reasoningConfigs: IReasoningConfigAssignment[];
    transportAssignments: ITransportAssignment[];
    fieldConfigs: IPipelineFieldConfig[];
}

function parseSharedRunInput(
    formData: FormData,
): { ok: true; value: ISharedRunInput } | { ok: false; state: IActionState } {
    const sttConfigResult = parseSttConfig(formData);
    if (!sttConfigResult.ok) return sttConfigResult;
    const sttVariantsResult = parseSttVariants(formData);
    if (!sttVariantsResult.ok) return sttVariantsResult;

    const audioRunMode = readAudioRunMode(formData);
    const value: ISharedRunInput = {
        mode: audioRunMode ?? "prompt_eval",
        datasetId: String(formData.get("datasetId")),
        maxTokens: Number(formData.get("maxTokens") || 500),
        judgeModelId: readString(formData, "judgeModelId") || "gpt-5.4-mini",
    };
    assignDefined(value, "audioRunMode", audioRunMode);
    assignDefined(value, "sourceRunId", readString(formData, "sourceRunId"));
    if (sttVariantsResult.variants !== undefined) {
        value.sttVariants = sttVariantsResult.variants;
        assignDefined(value, "sttEvaluation", sttVariantsResult.evaluation);
    } else {
        assignDefined(value, "sttConfig", sttConfigResult.value);
    }

    return {
        ok: true,
        value,
    };
}

function parseSttVariants(formData: FormData): ISttVariantsParseResult {
    const rawVariants = readString(formData, "sttVariants");
    if (!rawVariants) return { ok: true };
    assertPayloadSize(
        rawVariants,
        64_000,
        "STT variants payload is too large.",
    );
    const variants = parseJsonField<ISttRunVariant[]>(
        rawVariants,
        "sttVariants",
        [],
    );
    if (!variants.ok) {
        return { ok: false, state: fieldError("sttModelId", variants.error) };
    }
    const rawEvaluation = readString(formData, "sttEvaluation");
    assertPayloadSize(
        rawEvaluation,
        32_000,
        "STT evaluation payload is too large.",
    );
    if (!rawEvaluation) return { ok: true, variants: variants.value };
    const evaluation = parseJsonField<ISttRunEvaluation>(
        rawEvaluation,
        "sttEvaluation",
        {},
    );
    if (!evaluation.ok) {
        return { ok: false, state: fieldError("sttModelId", evaluation.error) };
    }
    return {
        ok: true,
        variants: variants.value,
        evaluation: evaluation.value,
    };
}

function parseSttConfig(formData: FormData): ISttConfigParseResult {
    const rawConfig = readString(formData, "sttConfig");
    assertPayloadSize(rawConfig, 32_000, "STT config payload is too large.");

    const modelId = readString(formData, "sttModelId");
    if (!rawConfig)
        return { ok: true, value: legacySttConfig(formData, modelId) };

    const result = parseJsonField<ISttRunConfig>(rawConfig, "sttConfig", {
        modelId,
    });
    if (result.ok) return result;
    return { ok: false, state: fieldError("sttModelId", result.error) };
}

function legacySttConfig(
    formData: FormData,
    modelId: string,
): ISttRunConfig | undefined {
    if (!modelId) return undefined;
    const config: ISttRunConfig = { modelId };
    assignDefined(config, "language", readString(formData, "sttLanguage"));
    return config;
}

function readAudioRunMode(formData: FormData): AudioRunMode | undefined {
    const value = readString(formData, "audioRunMode");
    return isAudioRunMode(value) ? value : undefined;
}

function buildSttMetricsRunRequest(
    shared: ISharedRunInput,
    principal: { teamId: string; projectId: string; userId: string },
): ICreateRunBuildResult {
    return {
        ok: true,
        request: {
            ...sharedRequestFields(shared, principal),
            modelIds: [],
            promptAssignments: [],
            reasoningConfigs: [],
            transportAssignments: [],
            fieldConfigs: [],
        },
    };
}

function buildPromptEvalRunRequest(
    formData: FormData,
    shared: ISharedRunInput,
    principal: { teamId: string; projectId: string; userId: string },
): ICreateRunBuildResult {
    const inputResult = parsePromptEvalInput(formData);
    if (!inputResult.ok) return inputResult;

    const input = inputResult.value;
    const request: ICreateRunFromSelectionRequest = {
        ...sharedRequestFields(shared, principal),
        modelIds: input.modelIds,
        promptAssignments: completePromptAssignments(input),
        reasoningConfigs: input.reasoningConfigs,
        transportAssignments: input.transportAssignments,
        fieldConfigs: input.fieldConfigs,
    };
    addPromptOptions(request, input);

    return {
        ok: true,
        request,
    };
}

function parsePromptEvalInput(
    formData: FormData,
): { ok: true; value: IPromptEvalInput } | { ok: false; state: IActionState } {
    const fieldConfigsRaw = String(formData.get("fieldConfigs") || "");
    try {
        assertPayloadSize(
            fieldConfigsRaw,
            64_000,
            "Scoring config payload is too large.",
        );
    } catch (err) {
        return { ok: false, state: actionErrorState(err) };
    }

    const modelIds = parseModelIds(formData);
    if (modelIds.length === 0) {
        const message = "Select at least one model before starting a run.";
        return { ok: false, state: fieldError("models", message) };
    }

    const promptVersionId = readString(formData, "promptVersionId");
    const value = parsePromptFields(
        formData,
        modelIds,
        promptVersionId,
        fieldConfigsRaw,
    );
    const judgeError = validateJudgeCompatibility(value);
    return judgeError ? { ok: false, state: judgeError } : { ok: true, value };
}

function parsePromptFields(
    formData: FormData,
    modelIds: string[],
    promptVersionId: string,
    fieldConfigsRaw: string,
): IPromptEvalInput {
    return {
        promptVersionId,
        modelIds,
        promptAssignments: parseJsonOrThrow(
            String(formData.get("promptAssignments") || ""),
            "promptAssignments",
            modelIds.map((modelId) => ({ modelId, promptVersionId })),
        ),
        reasoningConfigs: parseJsonOrThrow(
            String(formData.get("reasoningConfigs") || ""),
            "reasoningConfigs",
            [],
        ),
        transportAssignments: parseJsonOrThrow(
            String(formData.get("transportAssignments") || ""),
            "transportAssignments",
            [],
        ),
        fieldConfigs: parseJsonOrThrow(fieldConfigsRaw, "fieldConfigs", []),
        pipelineId: readChoice(formData, "pipelineId", "__prompt__"),
        judgeConfigId: readChoice(formData, "judgeConfigId", "none"),
        judgeRubric: readString(formData, "judgeRubric"),
        judgeReasoningEffort: readString(
            formData,
            "judgeReasoningEffort",
        ) as ReasoningEffort,
        judgeTransport: readString(
            formData,
            "judgeTransport",
        ) as ProviderTransport,
        judgePromptVersionId: readChoice(
            formData,
            "judgePromptVersionId",
            "none",
        ),
        referenceModel: readString(formData, "referenceModel"),
    };
}

function validateJudgeCompatibility(
    input: IPromptEvalInput,
): IActionState | undefined {
    const hasJudge = Boolean(input.judgePromptVersionId || input.judgeRubric);
    const hasGenerativeScoring = input.fieldConfigs.some(
        (config) => config.kind === "generative",
    );
    if (!hasJudge || !hasGenerativeScoring) return undefined;

    const message =
        "A judge cannot be combined with generative-field scoring; remove one.";
    return fieldError("judgePromptVersionId", message);
}

function completePromptAssignments(
    input: IPromptEvalInput,
): IPromptAssignment[] {
    if (input.promptAssignments.length > 0) return input.promptAssignments;
    return input.modelIds.map((modelId) => ({
        modelId,
        promptVersionId: input.promptVersionId,
    }));
}

function addPromptOptions(
    request: ICreateRunFromSelectionRequest,
    input: IPromptEvalInput,
): void {
    assignDefined(request, "promptVersionId", input.promptVersionId);
    assignDefined(request, "pipelineId", input.pipelineId);
    assignDefined(request, "judgeConfigId", input.judgeConfigId);
    assignDefined(request, "judgeRubric", input.judgeRubric);
    assignDefined(request, "judgeReasoningEffort", input.judgeReasoningEffort);
    assignDefined(request, "judgeTransport", input.judgeTransport);
    assignDefined(request, "judgePromptVersionId", input.judgePromptVersionId);
    assignDefined(request, "referenceModel", input.referenceModel);
}

function parseModelIds(formData: FormData): string[] {
    return String(formData.get("models") || "")
        .split(/[\n,]/)
        .map((modelId) => modelId.trim())
        .filter(Boolean);
}

function parseJsonOrThrow<T>(raw: string, field: string, fallback: T): T {
    const result = parseJsonField<T>(raw, field, fallback);
    if (!result.ok) throw new UserFacingError(result.error);
    return result.value;
}

function readString(formData: FormData, field: string): string {
    return String(formData.get(field) || "").trim();
}

function readChoice(
    formData: FormData,
    field: string,
    excludedValue: string,
): string | undefined {
    const value = readString(formData, field);
    return value && value !== excludedValue ? value : undefined;
}

function assertPayloadSize(raw: string, max: number, message: string): void {
    if (raw.length > max) throw new UserFacingError(message);
}

function fieldError(field: string, message: string): IActionState {
    return { fieldErrors: { [field]: [message] }, formError: message };
}

function assignDefined<T extends object, K extends keyof T>(
    target: T,
    key: K,
    value: T[K] | undefined,
): void {
    if (value !== undefined && value !== "") target[key] = value;
}

function sharedRequestFields(
    shared: ISharedRunInput,
    principal: { teamId: string; projectId: string; userId: string },
): Pick<
    ICreateRunFromSelectionRequest,
    | "teamId"
    | "projectId"
    | "datasetId"
    | "maxTokens"
    | "judgeModelId"
    | "createdBy"
    | "sourceRunId"
    | "sttConfig"
    | "sttVariants"
    | "sttEvaluation"
    | "audioRunMode"
> {
    return {
        teamId: principal.teamId,
        projectId: principal.projectId,
        datasetId: shared.datasetId,
        maxTokens: shared.maxTokens,
        judgeModelId: shared.judgeModelId,
        createdBy: principal.userId,
        ...(shared.sourceRunId ? { sourceRunId: shared.sourceRunId } : {}),
        ...(shared.sttConfig ? { sttConfig: shared.sttConfig } : {}),
        ...(shared.sttVariants ? { sttVariants: shared.sttVariants } : {}),
        ...(shared.sttEvaluation
            ? { sttEvaluation: shared.sttEvaluation }
            : {}),
        ...(shared.audioRunMode ? { audioRunMode: shared.audioRunMode } : {}),
    };
}

function isAudioRunMode(value: string): value is AudioRunMode {
    return value === "stt_metrics" || value === "prompt_eval";
}

export async function retryRunAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const p = await requirePrincipal();
    const runId = String(formData.get("runId"));
    try {
        await serverApiClient().retryRun(
            { teamId: p.teamId, projectId: p.projectId, runId },
            { teamId: p.teamId, actorId: p.userId },
        );
    } catch (err) {
        return { formError: clientErrorMessage(err) };
    }
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
}
