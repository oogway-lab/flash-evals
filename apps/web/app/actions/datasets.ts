"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
    ALLOWED_AUDIO_TYPES,
    ALLOWED_IMAGE_TYPES,
    DUPLICATE_ITEM_SOURCE_NAME_MESSAGE,
    MAX_AUDIO_BYTES,
    MAX_AUDIO_IMPORT_BYTES,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_IMPORT_BYTES,
    MAX_IMPORT_FILE_COUNT,
    MAX_TEXT_IMPORT_BYTES,
    MosaicApiError,
    type IApiAudioImportFile,
    type IApiImageImportFile,
    type IImportSummary,
    type IAnswerImportFile,
    type AnswerImportTargetField,
} from "@mosaic/api-contract";
import { requireActiveProject as requirePrincipal } from "@/server/projects/activeProject";
import {
    clientErrorMessage,
    errorMessage,
    UserFacingError,
} from "@/server/lib/errors";
import { serverApiClient } from "@/server/api/client";
import { actionErrorState } from "./shared";
import type { IActionState } from "./types";

function rejectedImport(reason: string): IImportSummary {
    return { importedCount: 0, failures: [{ reason }], rejected: true };
}

function importSummaryToState(summary: IImportSummary): IActionState {
    return {
        ok: !summary.rejected,
        importedCount: summary.importedCount,
        failures: summary.failures,
        rejected: summary.rejected,
        formError: summary.rejected ? summary.failures[0]?.reason : undefined,
        resetKey: Date.now(),
    };
}

function shouldRethrowDatasetMutationError(message: string): boolean {
    return (
        message.includes("not found") ||
        message.includes("archived") ||
        message.includes("Forbidden")
    );
}

function formatMegabytes(bytes: number): number {
    return Math.round(bytes / 1024 / 1024);
}

/**
 * Metadata a client submits after uploading media bytes directly to Supabase
 * (U5). Only the server-authoritative `storageKey` + descriptive metadata flow
 * through the Server Action — never the file bytes (R1).
 */
interface IUploadedFileMeta {
    storageKey: string;
    name: string;
    mimeType: string;
    size: number;
}

/**
 * Parse the JSON metadata list a converted media action receives in place of
 * File bytes. Malformed or absent input yields an empty list; entries missing
 * the required fields are dropped. Never reads or base64-encodes File bytes.
 */
function parseUploadedFiles(
    raw: FormDataEntryValue | null,
): IUploadedFileMeta[] {
    if (typeof raw !== "string" || raw.trim() === "") return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    const files: IUploadedFileMeta[] = [];
    for (const entry of parsed) {
        if (
            entry !== null &&
            typeof entry === "object" &&
            typeof (entry as IUploadedFileMeta).storageKey === "string" &&
            typeof (entry as IUploadedFileMeta).name === "string" &&
            typeof (entry as IUploadedFileMeta).mimeType === "string" &&
            typeof (entry as IUploadedFileMeta).size === "number"
        ) {
            const meta = entry as IUploadedFileMeta;
            files.push({
                storageKey: meta.storageKey,
                name: meta.name,
                mimeType: meta.mimeType,
                size: meta.size,
            });
        }
    }
    return files;
}

function toImageImportFile(meta: IUploadedFileMeta): IApiImageImportFile {
    return {
        name: meta.name,
        mimeType: meta.mimeType,
        size: meta.size,
        storageKey: meta.storageKey,
    };
}

function toAudioImportFile(meta: IUploadedFileMeta): IApiAudioImportFile {
    return {
        name: meta.name,
        mimeType: meta.mimeType,
        size: meta.size,
        storageKey: meta.storageKey,
    };
}

/**
 * Non-byte validation retained from the base64 path: file count and reported
 * batch size. Byte transfer no longer happens here, but the count/size guards
 * still keep obviously-oversize batches out of the API.
 */
function validateImportMetaBatch(
    files: IUploadedFileMeta[],
    batchCap: number,
    label: "Image" | "Audio",
): string | undefined {
    if (files.length > MAX_IMPORT_FILE_COUNT) {
        return `Import includes ${files.length} files; upload at most ${MAX_IMPORT_FILE_COUNT} at a time.`;
    }
    let totalBytes = 0;
    for (const file of files) {
        totalBytes += file.size;
        if (totalBytes > batchCap) {
            return `${label} import exceeds the ${formatMegabytes(batchCap)}MB batch limit.`;
        }
    }
    return undefined;
}

/**
 * Map an API failure raised inside a converted import to a typed, rejected
 * import summary (R6) instead of letting it surface as an opaque 500 — while
 * preserving the existing rethrow semantics for not-found/archived/forbidden.
 */
function importErrorToSummary(err: unknown): IImportSummary {
    if (
        err instanceof MosaicApiError &&
        !shouldRethrowDatasetMutationError(err.message)
    ) {
        return rejectedImport(err.message);
    }
    throw err;
}

function imageFromUpload(
    raw: FormDataEntryValue | null,
): { ok: true; image?: IApiImageImportFile } | { ok: false; error: string } {
    const files = parseUploadedFiles(raw);
    if (files.length === 0) return { ok: true };
    const meta = files[0];
    if (meta.size > MAX_IMAGE_BYTES) {
        return { ok: false, error: "Image exceeds the 20MB limit." };
    }
    if (!ALLOWED_IMAGE_TYPES.includes(meta.mimeType)) {
        return {
            ok: false,
            error: `Unsupported image type: ${meta.mimeType || "unknown"}.`,
        };
    }
    return { ok: true, image: toImageImportFile(meta) };
}

function audioFromUpload(
    raw: FormDataEntryValue | null,
): { ok: true; audio?: IApiAudioImportFile } | { ok: false; error: string } {
    const files = parseUploadedFiles(raw);
    if (files.length === 0) return { ok: true };
    const meta = files[0];
    if (meta.size > MAX_AUDIO_BYTES) {
        return {
            ok: false,
            error: `Audio exceeds the ${formatMegabytes(MAX_AUDIO_BYTES)}MB limit.`,
        };
    }
    if (!ALLOWED_AUDIO_TYPES.includes(meta.mimeType)) {
        return {
            ok: false,
            error: `Unsupported audio type: ${meta.mimeType || "unknown"}.`,
        };
    }
    return { ok: true, audio: toAudioImportFile(meta) };
}

async function runDatasetImportAction(
    datasetId: string,
    run: (p: {
        teamId: string;
        projectId: string;
        userId: string;
    }) => Promise<IImportSummary>,
): Promise<IActionState> {
    const p = await requirePrincipal();
    const summary = await run(p);
    revalidatePath(`/datasets/${datasetId}`);
    return importSummaryToState(summary);
}

async function createDatasetFromForm(
    formData: FormData,
    purposeOverride?: "evaluation",
) {
    const p = await requirePrincipal();
    const rawName = formData.get("name");
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) throw new UserFacingError("Enter a name for your dataset.");
    const purpose =
        purposeOverride ??
        (formData.get("purpose") === "evaluation" ? "evaluation" : "golden");
    const rawModality = formData.get("modality");
    const modality =
        rawModality === "audio"
            ? "audio"
            : rawModality === "text"
              ? "text"
              : "image";
    const ds = await serverApiClient().createDataset({
        teamId: p.teamId,
        projectId: p.projectId,
        name,
        purpose,
        modality,
        createdBy: p.userId,
    });
    revalidatePath("/datasets");
    return ds;
}

export async function createDatasetAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    let datasetId: string;
    try {
        datasetId = (await createDatasetFromForm(formData)).id;
    } catch (err) {
        return actionErrorState(err);
    }
    redirect(`/datasets/${datasetId}`);
}

export async function createDatasetForInputAction(
    formData: FormData,
): Promise<{ id: string }> {
    const ds = await createDatasetFromForm(formData, "evaluation");
    return { id: ds.id };
}

export async function addItemAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const p = await requirePrincipal();
    const datasetId = String(formData.get("datasetId"));
    const inputText = String(formData.get("inputText") || "");
    const rawLabel = String(formData.get("label") || "");
    const image = imageFromUpload(formData.get("imageUpload"));
    if (!image.ok) return { fieldErrors: { image: [image.error] } };
    const audio = audioFromUpload(formData.get("audioUpload"));
    if (!audio.ok) return { fieldErrors: { audio: [audio.error] } };

    try {
        await serverApiClient().createDatasetItemFromForm({
            teamId: p.teamId,
            projectId: p.projectId,
            datasetId,
            inputText,
            rawLabel,
            ...(audio.audio ? { audio: audio.audio } : {}),
            ...(image.image ? { image: image.image } : {}),
        });
    } catch (err) {
        if (errorMessage(err) === DUPLICATE_ITEM_SOURCE_NAME_MESSAGE) {
            const field = duplicateMediaField(audio.audio, image.image);
            return {
                fieldErrors: {
                    [field]: [DUPLICATE_ITEM_SOURCE_NAME_MESSAGE],
                },
            };
        }
        const message = clientErrorMessage(err);
        if (!shouldRethrowDatasetMutationError(message)) {
            return { formError: message };
        }
        throw err;
    }
    revalidatePath(`/datasets/${datasetId}`);
    return { ok: true, resetKey: Date.now() };
}

export async function editItemAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const p = await requirePrincipal();
    const itemId = String(formData.get("itemId"));
    const rawLabel = String(formData.get("label") || "");
    const image = imageFromUpload(formData.get("imageUpload"));
    if (!image.ok) return { fieldErrors: { image: [image.error] } };
    const audio = audioFromUpload(formData.get("audioUpload"));
    if (!audio.ok) return { fieldErrors: { audio: [audio.error] } };

    try {
        const { datasetId } = await serverApiClient().updateDatasetItemFromForm(
            {
                teamId: p.teamId,
                projectId: p.projectId,
                itemId,
                inputText: String(formData.get("inputText") || ""),
                rawLabel,
                ...(audio.audio ? { audio: audio.audio } : {}),
                ...(image.image ? { image: image.image } : {}),
            },
        );
        revalidatePath(`/datasets/${datasetId}`);
    } catch (err) {
        if (errorMessage(err) === DUPLICATE_ITEM_SOURCE_NAME_MESSAGE) {
            const field = duplicateMediaField(audio.audio, image.image);
            return {
                fieldErrors: {
                    [field]: [DUPLICATE_ITEM_SOURCE_NAME_MESSAGE],
                },
            };
        }
        const message = clientErrorMessage(err);
        if (!shouldRethrowDatasetMutationError(message)) {
            return { formError: message };
        }
        throw err;
    }
    return { ok: true, resetKey: Date.now() };
}

function duplicateMediaField(
    audio: IApiAudioImportFile | undefined,
    image: IApiImageImportFile | undefined,
): "audio" | "image" {
    return audio && !image ? "audio" : "image";
}

export async function deleteItemAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const p = await requirePrincipal();
    const itemId = String(formData.get("itemId"));

    try {
        const { datasetId } = await serverApiClient().deleteDatasetItem({
            teamId: p.teamId,
            projectId: p.projectId,
            itemId,
        });
        revalidatePath(`/datasets/${datasetId}`);
    } catch (err) {
        // Same policy as add/edit: stale or foreign items still go to the
        // error page; everything else (the "Delete the runs…" blocker, 5xx)
        // stays in the dialog.
        if (
            err instanceof Error &&
            shouldRethrowDatasetMutationError(err.message)
        ) {
            throw err;
        }
        return actionErrorState(err);
    }
    return { ok: true, resetKey: Date.now() };
}

const MAX_DATASET_DESCRIPTION_LENGTH = 2000;
const MAX_DATASET_NAME_LENGTH = 120;

export async function archiveDatasetAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const datasetId = String(formData.get("datasetId"));
    const p = await requirePrincipal();
    try {
        await serverApiClient().setDatasetArchived({
            teamId: p.teamId,
            projectId: p.projectId,
            datasetId,
            archived: true,
        });
    } catch (err) {
        return actionErrorState(err);
    }
    revalidatePath("/datasets");
    revalidatePath(`/datasets/${datasetId}`);
    return { ok: true, resetKey: Date.now() };
}

export async function restoreDatasetAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const datasetId = String(formData.get("datasetId"));
    const p = await requirePrincipal();
    try {
        await serverApiClient().setDatasetArchived({
            teamId: p.teamId,
            projectId: p.projectId,
            datasetId,
            archived: false,
        });
    } catch (err) {
        return actionErrorState(err);
    }
    revalidatePath("/datasets");
    revalidatePath(`/datasets/${datasetId}`);
    return { ok: true, resetKey: Date.now() };
}

export async function duplicateDatasetAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const datasetId = String(formData.get("datasetId"));
    const p = await requirePrincipal();
    try {
        await serverApiClient().duplicateDataset({
            teamId: p.teamId,
            projectId: p.projectId,
            datasetId,
            createdBy: p.userId,
        });
    } catch (err) {
        return actionErrorState(err);
    }
    revalidatePath("/datasets");
    return { ok: true, resetKey: Date.now() };
}

export async function deleteDatasetAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const datasetId = String(formData.get("datasetId"));
    const p = await requirePrincipal();

    try {
        await serverApiClient().deleteDataset({
            teamId: p.teamId,
            projectId: p.projectId,
            datasetId,
        });
    } catch (err) {
        return actionErrorState(err);
    }

    revalidatePath("/datasets");
    return { ok: true, resetKey: Date.now() };
}

export async function updateDatasetDescriptionAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const datasetId = String(formData.get("datasetId"));
    const p = await requirePrincipal();
    const raw = String(formData.get("description") ?? "");
    const description = raw.trim() || null;

    if (description && description.length > MAX_DATASET_DESCRIPTION_LENGTH) {
        return {
            formError: `Description must be ${MAX_DATASET_DESCRIPTION_LENGTH} characters or fewer.`,
        };
    }

    try {
        await serverApiClient().updateDatasetDescription({
            teamId: p.teamId,
            projectId: p.projectId,
            datasetId,
            description,
        });
    } catch (err) {
        if (
            err instanceof Error &&
            shouldRethrowDatasetMutationError(err.message)
        ) {
            throw err;
        }
        return actionErrorState(err);
    }
    revalidatePath(`/datasets/${datasetId}`);
    return { ok: true, resetKey: Date.now() };
}

export async function updateDatasetNameAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const datasetId = String(formData.get("datasetId"));
    const p = await requirePrincipal();

    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { fieldErrors: { name: ["Name is required."] } };
    if (name.length > MAX_DATASET_NAME_LENGTH) {
        return {
            fieldErrors: {
                name: [
                    `Name must be ${MAX_DATASET_NAME_LENGTH} characters or fewer.`,
                ],
            },
        };
    }

    try {
        await serverApiClient().updateDatasetName({
            teamId: p.teamId,
            projectId: p.projectId,
            datasetId,
            name,
        });
    } catch (err) {
        if (
            err instanceof Error &&
            shouldRethrowDatasetMutationError(err.message)
        ) {
            throw err;
        }
        return actionErrorState(err);
    }
    revalidatePath("/datasets");
    revalidatePath(`/datasets/${datasetId}`);
    return { ok: true, resetKey: Date.now() };
}

export async function deleteLabelAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const p = await requirePrincipal();
    const itemId = String(formData.get("itemId"));
    let datasetId: string;
    try {
        ({ datasetId } = await serverApiClient().deleteLabel({
            teamId: p.teamId,
            projectId: p.projectId,
            itemId,
        }));
    } catch (err) {
        return actionErrorState(err);
    }
    revalidatePath(`/datasets/${datasetId}`);
    return { ok: true, resetKey: Date.now() };
}

export async function importImagesAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const datasetId = String(formData.get("datasetId"));
    const images = parseUploadedFiles(formData.get("imageUploads"));

    return runDatasetImportAction(datasetId, async (p) => {
        if (images.length === 0) {
            return rejectedImport("Choose one or more images to add.");
        }
        const error = validateImportMetaBatch(
            images,
            MAX_IMAGE_IMPORT_BYTES,
            "Image",
        );
        if (error) return rejectedImport(error);
        try {
            return await serverApiClient().importImages({
                teamId: p.teamId,
                projectId: p.projectId,
                datasetId,
                images: images.map(toImageImportFile),
            });
        } catch (err) {
            return importErrorToSummary(err);
        }
    });
}

export async function importAudioAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const datasetId = String(formData.get("datasetId"));
    const audio = parseUploadedFiles(formData.get("audioUploads"));

    return runDatasetImportAction(datasetId, async (p) => {
        if (audio.length === 0) {
            return rejectedImport("Choose one or more audio files to add.");
        }
        const error = validateImportMetaBatch(
            audio,
            MAX_AUDIO_IMPORT_BYTES,
            "Audio",
        );
        if (error) return rejectedImport(error);
        try {
            return await serverApiClient().importAudio({
                teamId: p.teamId,
                projectId: p.projectId,
                datasetId,
                audio: audio.map(toAudioImportFile),
            });
        } catch (err) {
            return importErrorToSummary(err);
        }
    });
}

export async function importImageAnswersAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const datasetId = String(formData.get("datasetId"));
    const images = parseUploadedFiles(formData.get("imageUploads"));

    return runDatasetImportAction(datasetId, async (p) => {
        if (images.length === 0) {
            return rejectedImport("Choose one or more images to add.");
        }
        const answers = formData.get("answers");
        if (!answers || typeof answers === "string" || answers.size === 0) {
            return rejectedImport(
                "Choose a JSON or JSONL answer file keyed by image filename.",
            );
        }
        if (answers.size > MAX_TEXT_IMPORT_BYTES) {
            return rejectedImport(
                `Answer file exceeds the ${MAX_TEXT_IMPORT_BYTES / 1024 / 1024}MB limit.`,
            );
        }
        const error = validateImportMetaBatch(
            images,
            MAX_IMAGE_IMPORT_BYTES,
            "Image",
        );
        if (error) return rejectedImport(error);
        try {
            return await serverApiClient().importImageAnswers({
                teamId: p.teamId,
                projectId: p.projectId,
                datasetId,
                images: images.map(toImageImportFile),
                answersContent: await answers.text(),
            });
        } catch (err) {
            return importErrorToSummary(err);
        }
    });
}

export async function importAudioAnswersAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const datasetId = String(formData.get("datasetId"));
    const audio = parseUploadedFiles(formData.get("audioUploads"));

    return runDatasetImportAction(datasetId, async (p) => {
        if (audio.length === 0) {
            return rejectedImport("Choose one or more audio files to add.");
        }
        const answers = formData.get("answers");
        if (!answers || typeof answers === "string" || answers.size === 0) {
            return rejectedImport(
                "Choose a JSON or JSONL answer file keyed by audio filename.",
            );
        }
        if (answers.size > MAX_TEXT_IMPORT_BYTES) {
            return rejectedImport(
                `Answer file exceeds the ${MAX_TEXT_IMPORT_BYTES / 1024 / 1024}MB limit.`,
            );
        }
        const error = validateImportMetaBatch(
            audio,
            MAX_AUDIO_IMPORT_BYTES,
            "Audio",
        );
        if (error) return rejectedImport(error);
        try {
            return await serverApiClient().importAudioAnswers({
                teamId: p.teamId,
                projectId: p.projectId,
                datasetId,
                audio: audio.map(toAudioImportFile),
                answersContent: await answers.text(),
            });
        } catch (err) {
            return importErrorToSummary(err);
        }
    });
}

export async function importTextItemsAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const datasetId = String(formData.get("datasetId"));
    const format = formData.get("format") === "csv" ? "csv" : "jsonl";

    return runDatasetImportAction(datasetId, async (p) => {
        const file = formData.get("file");
        if (!file || typeof file === "string" || file.size === 0) {
            return rejectedImport("Choose a CSV or JSONL file to import.");
        }
        return serverApiClient().importTextItems({
            teamId: p.teamId,
            projectId: p.projectId,
            datasetId,
            format,
            content: await file.text(),
        });
    });
}

export async function importGoldenAnswersAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const datasetId = String(formData.get("datasetId"));

    return runDatasetImportAction(datasetId, async (p) => {
        const file = formData.get("answers");
        if (!file || typeof file === "string" || file.size === 0) {
            return rejectedImport(
                "Choose a JSON or JSONL golden-answers file.",
            );
        }
        return serverApiClient().importGoldenAnswers({
            teamId: p.teamId,
            projectId: p.projectId,
            datasetId,
            answersContent: await file.text(),
        });
    });
}

export async function previewGoldenAnswersAction(formData: FormData) {
    const datasetId = String(formData.get("datasetId"));
    const answersContent = String(formData.get("answersContent") ?? "");
    const mappingValue = String(formData.get("mapping") ?? "");
    try {
        const answerFiles = parseAnswerFiles(formData.get("answerFiles"));
        const principal = await requirePrincipal();
        return {
            ok: true as const,
            preview: await serverApiClient().previewGoldenAnswers({
                teamId: principal.teamId,
                projectId: principal.projectId,
                datasetId,
                answersContent,
                ...(answerFiles ? { answerFiles } : {}),
                ...(mappingValue
                    ? {
                          mapping: JSON.parse(mappingValue) as Record<
                              string,
                              AnswerImportTargetField
                          >,
                      }
                    : {}),
            }),
        };
    } catch (error) {
        return { ok: false as const, error: clientErrorMessage(error) };
    }
}

export async function commitGoldenAnswersAction(formData: FormData) {
    const datasetId = String(formData.get("datasetId"));
    const answersContent = String(formData.get("answersContent") ?? "");
    const mappingValue = String(formData.get("mapping") ?? "{}");
    try {
        const answerFiles = parseAnswerFiles(formData.get("answerFiles"));
        const principal = await requirePrincipal();
        const result = await serverApiClient().commitGoldenAnswers({
            teamId: principal.teamId,
            projectId: principal.projectId,
            datasetId,
            answersContent,
            ...(answerFiles ? { answerFiles } : {}),
            mapping: JSON.parse(mappingValue) as Record<
                string,
                AnswerImportTargetField
            >,
        });
        revalidatePath(`/datasets/${datasetId}`);
        return { ok: true as const, result };
    } catch (error) {
        return { ok: false as const, error: clientErrorMessage(error) };
    }
}

function parseAnswerFiles(
    value: FormDataEntryValue | null,
): IAnswerImportFile[] | undefined {
    if (value === null) return undefined;
    if (typeof value !== "string") {
        throw new UserFacingError("Answer file batch must be JSON text.");
    }
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new UserFacingError("Choose one or more JSON answer files.");
    }
    if (parsed.length > MAX_IMPORT_FILE_COUNT) {
        throw new UserFacingError(
            `Answer import is limited to ${MAX_IMPORT_FILE_COUNT} files.`,
        );
    }
    const names = new Set<string>();
    const files = parsed.map((entry) => parseAnswerFile(entry, names));
    const totalBytes = files.reduce(
        (total, file) =>
            total + new TextEncoder().encode(file.content).byteLength,
        0,
    );
    if (totalBytes > MAX_TEXT_IMPORT_BYTES) {
        throw new UserFacingError(
            `Answer files exceed the ${formatMegabytes(MAX_TEXT_IMPORT_BYTES)}MB batch limit.`,
        );
    }
    return files;
}

function parseAnswerFile(
    entry: unknown,
    names: Set<string>,
): IAnswerImportFile {
    const file = answerFileRecord(entry);
    const fileName = answerFileName(file);
    const content = answerFileContent(file);
    if (!/\.jsonl?$/i.test(fileName)) {
        throw new UserFacingError(`${fileName} is not a JSON or JSONL file.`);
    }
    registerAnswerFileName(fileName, names);
    validateAnswerFileOptions(file);
    return {
        fileName,
        content,
        ...(file.interpretation ? { interpretation: file.interpretation } : {}),
        ...(typeof file.itemId === "string" ? { itemId: file.itemId } : {}),
        ...(file.allowOverwrite ? { allowOverwrite: true } : {}),
    } as IAnswerImportFile;
}

function answerFileRecord(entry: unknown): Record<string, unknown> {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new UserFacingError(
            "Each answer file needs a filename and text content.",
        );
    }
    return entry as Record<string, unknown>;
}

function answerFileName(file: Record<string, unknown>): string {
    if (typeof file.fileName !== "string" || !file.fileName.trim()) {
        throw new UserFacingError("Each answer file needs a filename.");
    }
    return file.fileName;
}

function answerFileContent(file: Record<string, unknown>): string {
    if (typeof file.content !== "string") {
        throw new UserFacingError("Each answer file needs text content.");
    }
    return file.content;
}

function registerAnswerFileName(fileName: string, names: Set<string>): void {
    const normalizedName = fileName.trim().toLowerCase();
    if (names.has(normalizedName)) {
        throw new UserFacingError(
            `Answer filename "${fileName}" appears more than once.`,
        );
    }
    names.add(normalizedName);
}

function validateAnswerFileOptions(file: Record<string, unknown>): void {
    if (
        file.interpretation !== undefined &&
        file.interpretation !== "single_record" &&
        file.interpretation !== "keyed_map"
    ) {
        throw new UserFacingError(
            "Answer file interpretation is not supported.",
        );
    }
    if (
        file.itemId !== undefined &&
        (typeof file.itemId !== "string" || !file.itemId.trim())
    ) {
        throw new UserFacingError(
            "Selected answer item id must be non-empty text.",
        );
    }
    if (
        file.allowOverwrite !== undefined &&
        typeof file.allowOverwrite !== "boolean"
    ) {
        throw new UserFacingError(
            "Answer overwrite confirmation must be a boolean.",
        );
    }
}

export async function importPairedItemsAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const datasetId = String(formData.get("datasetId"));

    return runDatasetImportAction(datasetId, async (p) => {
        const csv = formData.get("spreadsheet");
        if (!csv || typeof csv === "string" || csv.size === 0) {
            return rejectedImport(
                "Choose a spreadsheet (CSV) of filenames and answers.",
            );
        }
        const images = parseUploadedFiles(formData.get("imageUploads"));
        if (images.length === 0) {
            return rejectedImport(
                "Choose the image files to pair with the spreadsheet.",
            );
        }
        const error = validateImportMetaBatch(
            images,
            MAX_IMAGE_IMPORT_BYTES,
            "Image",
        );
        if (error) return rejectedImport(error);
        try {
            return await serverApiClient().importPairedItems({
                teamId: p.teamId,
                projectId: p.projectId,
                datasetId,
                images: images.map(toImageImportFile),
                csvContent: await csv.text(),
            });
        } catch (err) {
            return importErrorToSummary(err);
        }
    });
}
