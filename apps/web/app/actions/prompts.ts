"use server";

import { clientErrorMessage, UserFacingError } from "@/server/lib/errors";
import { revalidatePath } from "next/cache";
import { requireActiveProject as requirePrincipal } from "@/server/projects/activeProject";
import { resolveReasoningEffort } from "@/server/llm/reasoningConfig";
import { registryEntryFor } from "@/server/llm/modelRegistry";
import { serverApiClient } from "@/server/api/client";
import {
    ALLOWED_IMAGE_TYPES,
    MAX_IMAGE_BYTES,
    type IEvalImage,
    type IJudgeSpec,
    type IPipelineFieldConfig,
    type IPromptSampleInput,
    type JudgeDeclaredInput,
    type IJsonSchemaObject,
    type ReasoningEffort,
    type ProviderTransport,
} from "@mosaic/api-contract";
import { actionErrorState, jsonFieldError, parseJsonField } from "./shared";
import type {
    IGenerateSchemaActionState,
    IPromptJudgeTestActionState,
    IPromptTestRunActionState,
    IPromptWorkbenchState,
} from "./types";

function promptSampleFromForm(formData: FormData): IPromptSampleInput[] {
    const inputText = String(formData.get("sampleInput") || "").trim();
    if (!inputText) return [];
    return [{ name: "Sample", inputText }];
}

function promptTestSamplesFromForm(formData: FormData): IPromptSampleInput[] {
    const mode = String(formData.get("testMode") || "single");
    if (mode === "samples") {
        const samplesResult = parseJsonField<IPromptSampleInput[]>(
            String(formData.get("sampleInputs") || ""),
            "sampleInputs",
            [],
        );
        if (!samplesResult.ok) throw new UserFacingError(samplesResult.error);
        return samplesResult.value
            .map((sample, idx) => ({
                name: sample.name?.trim() || `Sample ${idx + 1}`,
                inputText: sample.inputText ?? "",
                imageStorageKey: sample.imageStorageKey,
                imageMimeType: sample.imageMimeType,
            }))
            .filter((sample) => sample.inputText?.trim());
    }

    const inputText = String(formData.get("testInput") || "").trim();
    return inputText ? [{ name: "Single input", inputText }] : [];
}

type ImageFromForm =
    { ok: true; image?: IEvalImage } | { ok: false; error: string };

const IMAGE_MAGIC: Array<{ mime: string; matches: (b: Buffer) => boolean }> = [
    {
        mime: "image/png",
        matches: (b) =>
            b.length >= 8 &&
            b[0] === 0x89 &&
            b[1] === 0x50 &&
            b[2] === 0x4e &&
            b[3] === 0x47,
    },
    {
        mime: "image/jpeg",
        matches: (b) =>
            b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    },
    {
        mime: "image/gif",
        matches: (b) =>
            b.length >= 6 && b.toString("ascii", 0, 6).startsWith("GIF8"),
    },
    {
        mime: "image/webp",
        matches: (b) =>
            b.length >= 12 &&
            b.toString("ascii", 0, 4) === "RIFF" &&
            b.toString("ascii", 8, 12) === "WEBP",
    },
];

// Decode a transient test image to base64 in-memory. Size and declared MIME are
// checked before reading the bytes (an oversized read is a memory-DoS path under
// the Server Action body cap); magic bytes are then sniffed so a mislabelled file
// can't be forwarded to the provider. Never persisted.
async function imageFromForm(formData: FormData): Promise<ImageFromForm> {
    const file = formData.get("imageFile");
    if (!(file instanceof File) || file.size === 0) return { ok: true };
    if (file.size > MAX_IMAGE_BYTES) {
        const limitMb = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));
        return { ok: false, error: `Image exceeds the ${limitMb}MB limit.` };
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return {
            ok: false,
            error: `Unsupported image type: ${file.type || "unknown"}.`,
        };
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const sniffed = IMAGE_MAGIC.find((m) => m.matches(bytes))?.mime;
    if (sniffed !== file.type) {
        return {
            ok: false,
            error: "Image contents do not match its declared type.",
        };
    }
    return {
        ok: true,
        image: { mimeType: file.type, base64Data: bytes.toString("base64") },
    };
}

function promptSampleInputsFromForm(formData: FormData): IPromptSampleInput[] {
    const samplesResult = parseJsonField<IPromptSampleInput[]>(
        String(formData.get("sampleInputs") || ""),
        "sampleInputs",
        [],
    );
    if (!samplesResult.ok) throw new UserFacingError(samplesResult.error);
    return samplesResult.value
        .map((sample, idx) => ({
            name: sample.name?.trim() || `Sample ${idx + 1}`,
            inputText: sample.inputText ?? "",
            imageStorageKey: sample.imageStorageKey,
            imageMimeType: sample.imageMimeType,
        }))
        .filter(
            (sample) =>
                sample.inputText?.trim() ||
                sample.imageStorageKey ||
                sample.imageMimeType,
        );
}

const JUDGE_DECLARED_INPUTS = new Set<JudgeDeclaredInput>([
    "task_input",
    "candidate_output",
    "reference",
]);

function judgeDeclaredInputsFromForm(formData: FormData): JudgeDeclaredInput[] {
    const raw = String(
        formData.get("judgeDeclaredInputs") || "candidate_output",
    );
    const inputs = [...new Set(raw.split(","))]
        .map((input) => input.trim())
        .filter((input): input is JudgeDeclaredInput =>
            JUDGE_DECLARED_INPUTS.has(input as JudgeDeclaredInput),
        );
    return inputs.length > 0 ? inputs : ["candidate_output"];
}

function judgeSpecFromForm(modelId: string, formData: FormData): IJudgeSpec {
    return {
        modelId,
        ...(String(formData.get("transport") || "").trim()
            ? {
                  transport: String(
                      formData.get("transport"),
                  ) as ProviderTransport,
              }
            : {}),
        declaredInputs: judgeDeclaredInputsFromForm(formData),
    };
}

function parseMaybeJson(raw: string): unknown {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    try {
        return JSON.parse(trimmed);
    } catch {
        return trimmed;
    }
}

export async function createPromptAction(formData: FormData) {
    await requirePrincipal();
    void formData;
    throw new UserFacingError(
        "Prompts require a JSON schema and passing sample try-run before saving.",
    );
}

export async function addPromptVersionAction(formData: FormData) {
    await requirePrincipal();
    void formData;
    throw new UserFacingError(
        "Prompt versions require a JSON schema and passing sample try-run before saving.",
    );
}

export async function optimizePromptAction(
    _prevState: IPromptWorkbenchState,
    formData: FormData,
): Promise<IPromptWorkbenchState> {
    const p = await requirePrincipal();
    const content = String(formData.get("content") || "").trim();
    const targetModelId = String(
        formData.get("targetModelId") || "gpt-4o",
    ).trim();
    const optimizerModelId =
        process.env.PROMPT_OPTIMIZER_MODEL ?? "gpt-5.4-mini";
    const schemaResult = parseJsonField<IJsonSchemaObject>(
        String(formData.get("jsonSchema") || ""),
        "jsonSchema",
        {},
    );
    if (!content)
        return jsonFieldError("content", "Prompt content is required.");
    if (!targetModelId) {
        return jsonFieldError("targetModelId", "Target model is required.");
    }
    if (!schemaResult.ok)
        return jsonFieldError("jsonSchema", schemaResult.error);

    try {
        const result = await serverApiClient().optimizePrompt({
            teamId: p.teamId,
            projectId: p.projectId,
            content,
            jsonSchema: schemaResult.value,
            targetModelId,
            optimizerModelId,
            createdBy: p.userId,
        });
        return {
            ok: true,
            ...result,
        };
    } catch (err) {
        return {
            formError: clientErrorMessage(err),
        };
    }
}

export async function testPromptDraftAction(
    formData: FormData,
): Promise<IPromptTestRunActionState> {
    // "use server" exports are independently POSTable — auth is required here.
    const p = await requirePrincipal();
    const content = String(formData.get("content") || "").trim();
    const targetModelId = String(
        formData.get("targetModelId") || "gpt-4o",
    ).trim();
    const reasoningEffort =
        String(formData.get("reasoningEffort") || "").trim() || undefined;
    const transport =
        String(formData.get("transport") || "").trim() || undefined;
    const schemaResult = parseJsonField<IJsonSchemaObject>(
        String(formData.get("jsonSchema") || ""),
        "jsonSchema",
        {},
    );

    if (!content)
        return jsonFieldError("content", "Prompt content is required.");
    if (!targetModelId) {
        return jsonFieldError("targetModelId", "Target model is required.");
    }
    if (!schemaResult.ok)
        return jsonFieldError("jsonSchema", schemaResult.error);

    const imageResult = await imageFromForm(formData);
    if (!imageResult.ok) return jsonFieldError("imageFile", imageResult.error);
    const image = imageResult.image;
    if (image) {
        const entry = registryEntryFor(targetModelId);
        if (entry && !entry.vision) {
            return jsonFieldError(
                "imageFile",
                `${entry.label} does not support image input.`,
            );
        }
    }

    let samples: IPromptSampleInput[];
    try {
        samples = promptTestSamplesFromForm(formData);
    } catch (err) {
        return {
            formError: clientErrorMessage(err),
        };
    }
    // An image with no text is a valid test; synthesize a single empty sample so
    // the run proceeds. Text-only emptiness still errors below.
    if (samples.length === 0 && image) {
        samples = [{ name: "Image input", inputText: "" }];
    }
    if (samples.length === 0) {
        return {
            fieldErrors: {
                testInput: [
                    "Add text or an image, or pick a saved input, to run a test.",
                ],
            },
            formError:
                "Add text or an image, or pick a saved input, to run a test.",
        };
    }

    try {
        const result = await serverApiClient().testPromptDraft(
            {
                teamId: p.teamId,
                prompt: content,
                jsonSchema: schemaResult.value,
                targetModelId,
                ...(transport
                    ? { transport: transport as ProviderTransport }
                    : {}),
                samples,
                ...(reasoningEffort
                    ? { reasoningEffort: reasoningEffort as ReasoningEffort }
                    : {}),
                ...(image ? { image } : {}),
                timeoutMs: 120_000,
            },
            { teamId: p.teamId, actorId: p.userId },
        );
        return { ok: true, result };
    } catch (err) {
        return {
            formError: clientErrorMessage(err),
        };
    }
}

export async function generateSchemaFromPromptAction(
    formData: FormData,
): Promise<IGenerateSchemaActionState> {
    // "use server" exports are independently POSTable — auth is required here.
    const p = await requirePrincipal();
    const content = String(formData.get("content") || "").trim();
    const targetModelId = String(
        formData.get("targetModelId") || "gpt-4o",
    ).trim();
    if (!content) {
        return jsonFieldError(
            "content",
            "Add prompt content before generating a schema.",
        );
    }

    const generatorModelId =
        process.env.PROMPT_OPTIMIZER_MODEL ?? "gpt-5.4-mini";
    try {
        const result = await serverApiClient().generatePromptSchema({
            teamId: p.teamId,
            projectId: p.projectId,
            content,
            targetModelId,
            generatorModelId,
            createdBy: p.userId,
        });
        return {
            ok: true,
            schema: JSON.stringify(result.schema, null, 4),
            openaiCompatible: result.openaiCompatible,
            compatibilityErrors: result.compatibilityErrors,
        };
    } catch (err) {
        return { formError: clientErrorMessage(err) };
    }
}

export async function testJudgeDraftAction(
    formData: FormData,
): Promise<IPromptJudgeTestActionState> {
    // "use server" exports are independently POSTable — auth is required here.
    const p = await requirePrincipal();
    const content = String(formData.get("content") || "").trim();
    const targetModelId = String(
        formData.get("targetModelId") || "gpt-4o",
    ).trim();
    const reasoningEffort =
        String(formData.get("reasoningEffort") || "").trim() || undefined;
    const declaredInputs = judgeDeclaredInputsFromForm(formData);
    const taskInput = String(formData.get("judgeTaskInput") || "").trim();
    const candidateOutputRaw = String(
        formData.get("judgeCandidateOutput") || "",
    ).trim();
    const referenceRaw = String(formData.get("judgeReference") || "").trim();

    if (!content) return jsonFieldError("content", "Judge rubric is required.");
    if (!targetModelId) {
        return jsonFieldError("targetModelId", "Judge model is required.");
    }
    if (declaredInputs.includes("task_input") && !taskInput) {
        return jsonFieldError("judgeTaskInput", "Task input is required.");
    }
    if (declaredInputs.includes("candidate_output") && !candidateOutputRaw) {
        return jsonFieldError(
            "judgeCandidateOutput",
            "Candidate output is required.",
        );
    }
    if (declaredInputs.includes("reference") && !referenceRaw) {
        return jsonFieldError(
            "judgeReference",
            "Reference output is required.",
        );
    }

    const resolvedReasoningEffort = resolveReasoningEffort(
        targetModelId,
        reasoningEffort as ReasoningEffort | undefined,
    );
    try {
        const result = await serverApiClient().testJudgeDraft(
            {
                teamId: p.teamId,
                content,
                targetModelId,
                ...(resolvedReasoningEffort
                    ? { reasoningEffort: resolvedReasoningEffort }
                    : {}),
                declaredInputs,
                ...(taskInput ? { taskInput } : {}),
                candidateOutput: parseMaybeJson(candidateOutputRaw),
                ...(referenceRaw
                    ? { reference: parseMaybeJson(referenceRaw) }
                    : {}),
            },
            { teamId: p.teamId, actorId: p.userId },
        );
        return { ok: true, result };
    } catch (err) {
        return {
            formError: clientErrorMessage(err),
        };
    }
}

// The judge branch of saveRunnablePromptAction: judge prompts skip eval
// validation and save straight through the judge endpoint.
async function saveJudgePromptVersion(
    p: Awaited<ReturnType<typeof requirePrincipal>>,
    formData: FormData,
    fields: {
        promptId: string | undefined;
        name: string;
        content: string;
        targetModelId: string;
        reasoningEffort: string | undefined;
    },
): Promise<IPromptWorkbenchState> {
    const judgeSpec = judgeSpecFromForm(fields.targetModelId, formData);
    if (!judgeSpec.declaredInputs.includes("candidate_output")) {
        return jsonFieldError(
            "judgeDeclaredInputs",
            "Judge prompts must consume candidate output.",
        );
    }
    const resolvedEffort = resolveReasoningEffort(
        fields.targetModelId,
        fields.reasoningEffort as ReasoningEffort | undefined,
    );
    const reasoningConfig = resolvedEffort
        ? { effort: resolvedEffort }
        : undefined;
    let saved: Awaited<
        ReturnType<ReturnType<typeof serverApiClient>["createJudgePrompt"]>
    >;
    try {
        saved = await serverApiClient().createJudgePrompt({
            teamId: p.teamId,
            projectId: p.projectId,
            // A second save from /prompts/new, or an edit, adds a version
            // to the same judge prompt instead of creating another.
            ...(fields.promptId ? { promptId: fields.promptId } : {}),
            name: fields.name,
            modelId: fields.targetModelId,
            rubricPrompt: fields.content,
            judgeSpec,
            reasoningConfig,
            createdBy: p.userId,
        });
    } catch (err) {
        return actionErrorState(err);
    }
    revalidatePath("/prompts");
    revalidatePath("/runs/new");
    return {
        ok: true,
        promptId: saved.promptId,
        promptKind: "judge",
        promptVersionId: saved.promptVersionId,
        validationSummary: `Saved ${fields.name} judge prompt.`,
        resetKey: Date.now(),
    };
}

export async function saveRunnablePromptAction(
    _prevState: IPromptWorkbenchState,
    formData: FormData,
): Promise<IPromptWorkbenchState> {
    const p = await requirePrincipal();
    const kind =
        String(formData.get("kind") || "eval") === "judge" ? "judge" : "eval";
    const name = String(formData.get("name") || "prompt").trim();
    const content = String(formData.get("content") || "").trim();
    const description =
        String(formData.get("description") || "").trim() || undefined;
    const targetModelId = String(
        formData.get("targetModelId") || "gpt-4o",
    ).trim();
    const reasoningEffort =
        String(formData.get("reasoningEffort") || "").trim() || undefined;
    const optimizerAttemptId =
        String(formData.get("optimizerAttemptId") || "").trim() || undefined;
    const draftPromptId =
        String(formData.get("promptId") || "").trim() || undefined;
    const fitTags = String(formData.get("fitTags") || "")
        .split(/[\n,]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
    const schemaResult = parseJsonField<IJsonSchemaObject>(
        String(formData.get("jsonSchema") || ""),
        "jsonSchema",
        {},
    );
    const fieldConfigsResult = parseJsonField<IPipelineFieldConfig[]>(
        String(formData.get("fieldConfigs") || ""),
        "fieldConfigs",
        [],
    );

    if (!name) return jsonFieldError("name", "Prompt name is required.");
    if (!content)
        return jsonFieldError("content", "Prompt content is required.");
    if (!targetModelId) {
        return jsonFieldError("targetModelId", "Target model is required.");
    }

    if (kind === "judge") {
        return saveJudgePromptVersion(p, formData, {
            promptId: draftPromptId,
            name,
            content,
            targetModelId,
            reasoningEffort,
        });
    }

    if (!schemaResult.ok)
        return jsonFieldError("jsonSchema", schemaResult.error);
    if (!fieldConfigsResult.ok) {
        return jsonFieldError("fieldConfigs", fieldConfigsResult.error);
    }

    let samples: IPromptSampleInput[];
    try {
        const savedSamples = promptSampleInputsFromForm(formData);
        samples =
            savedSamples.length > 0
                ? savedSamples
                : promptSampleFromForm(formData);
    } catch (err) {
        return {
            formError: clientErrorMessage(err),
        };
    }
    const resolvedEffort = resolveReasoningEffort(
        targetModelId,
        reasoningEffort as ReasoningEffort | undefined,
    );
    const reasoningConfig = resolvedEffort
        ? { effort: resolvedEffort }
        : undefined;
    const transport =
        String(formData.get("transport") || "").trim() || undefined;
    const validation = await serverApiClient().validateRunnablePrompt({
        teamId: p.teamId,
        projectId: p.projectId,
        prompt: content,
        jsonSchema: schemaResult.value,
        samples,
        targetModelId,
        ...(transport ? { transport: transport as ProviderTransport } : {}),
        ...(reasoningConfig ? { reasoningEffort: reasoningConfig.effort } : {}),
        createdBy: p.userId,
    });
    if (!validation.passed) {
        return {
            formError:
                validation.failureMessage ??
                "Prompt did not pass structured output validation.",
            validationSummary:
                "Prompt was not saved. Resolve the issues above.",
        };
    }

    const saved = await serverApiClient().saveRunnablePrompt({
        teamId: p.teamId,
        projectId: p.projectId,
        ...(draftPromptId ? { promptId: draftPromptId } : {}),
        name,
        ...(description !== undefined ? { description } : {}),
        targetModelId,
        content,
        jsonSchema: schemaResult.value,
        fieldConfigs: fieldConfigsResult.value,
        validationEvidence: validation.evidence,
        ...(optimizerAttemptId ? { optimizerAttemptId } : {}),
        ...(reasoningConfig ? { reasoningConfig } : {}),
        fitTags: [...fitTags, targetModelId],
        createdBy: p.userId,
    });
    revalidatePath("/prompts");
    revalidatePath("/runs/new");
    return {
        ok: true,
        promptId: saved.promptId,
        promptKind: "eval",
        promptVersionId: saved.promptVersionId,
        schemaVersionId: saved.schemaVersionId,
        validationSummary: `Saved ${name} v${saved.promptVersion}.`,
        resetKey: Date.now(),
    };
}

export async function duplicatePromptVersionAction(formData: FormData) {
    const p = await requirePrincipal();
    const sourcePromptVersionId = String(formData.get("sourcePromptVersionId"));
    await serverApiClient().duplicatePromptVersion({
        teamId: p.teamId,
        projectId: p.projectId,
        sourcePromptVersionId,
        createdBy: p.userId,
    });
    revalidatePath("/prompts");
    revalidatePath("/runs/new");
}

export async function deletePromptAction(
    _prevState: { ok?: boolean; formError?: string },
    formData: FormData,
): Promise<{ ok?: boolean; formError?: string; resetKey?: number }> {
    const p = await requirePrincipal();
    const promptId = String(formData.get("promptId"));

    try {
        await serverApiClient().deletePrompt({
            teamId: p.teamId,
            projectId: p.projectId,
            promptId,
        });
    } catch (err) {
        return { formError: clientErrorMessage(err) };
    }

    revalidatePath("/prompts");
    revalidatePath("/runs/new");
    return { ok: true, resetKey: Date.now() };
}

export async function createJudgeAction(formData: FormData) {
    const p = await requirePrincipal();
    const modelId = String(formData.get("modelId") || "gpt-4o-mini").trim();
    const rubricPrompt = String(formData.get("rubricPrompt") || "").trim();
    await serverApiClient().createJudgePrompt({
        teamId: p.teamId,
        projectId: p.projectId,
        name: String(formData.get("name") || "judge").trim() || "judge",
        modelId,
        rubricPrompt,
        reasoningConfig: (() => {
            const effort = resolveReasoningEffort(
                modelId,
                (String(formData.get("reasoningEffort") || "").trim() ||
                    undefined) as ReasoningEffort | undefined,
            );
            return effort ? { effort } : undefined;
        })(),
        createdBy: p.userId,
    });
    revalidatePath("/prompts");
    revalidatePath("/runs/new");
}
