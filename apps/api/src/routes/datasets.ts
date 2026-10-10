import { randomUUID } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import Papa from "papaparse";
import type {
    IApiAudioImportFile,
    IApiImageImportFile,
    ICreateDatasetRequest,
    ICreateDatasetResponse,
    ICreateSignedUploadRequest,
    ICreateSignedUploadResponse,
    ISignedUploadTarget,
    ICreateDatasetItemFromFormRequest,
    ICreateDatasetItemRequest,
    DatasetLabelMode,
    IDeleteDatasetRequest,
    IDeleteDatasetItemRequest,
    IDeleteLabelRequest,
    IDatasetDetailResponse,
    IDatasetListRow,
    IDuplicateDatasetRequest,
    IImportAudioAnswersRequest,
    IImportGoldenAnswersRequest,
    IPreviewGoldenAnswersRequest,
    ICommitGoldenAnswersRequest,
    IAnswerImportPreview,
    IImportAudioRequest,
    IImportImageAnswersRequest,
    IImportImagesRequest,
    IImportPairedItemsRequest,
    IImportSummary,
    IImportTextItemsRequest,
    IPipelineFieldConfig,
    IParsedSchemaDescriptor,
    ISetDatasetArchivedRequest,
    IUpdateDatasetItemRequest,
    IUpdateDatasetItemFromFormRequest,
    IUpdateDatasetDescriptionRequest,
    IUpdateDatasetNameRequest,
    LabelJson,
    SchemaFieldType,
} from "@mosaic/api-contract";
import {
    createR2SignedUploadUrl,
    deleteR2Object,
    headR2Object,
    getR2ObjectPrefix,
    isR2ObjectNotFound,
    putR2Object,
    R2_CREATE_ONLY_UPLOAD_HEADER,
    R2_CREATE_ONLY_UPLOAD_VALUE,
    R2_UPLOAD_URL_TTL_SECONDS,
} from "@mosaic/object-storage";
import {
    ALLOWED_AUDIO_TYPES as CONTRACT_ALLOWED_AUDIO_TYPES,
    ALLOWED_IMAGE_TYPES as CONTRACT_ALLOWED_IMAGE_TYPES,
} from "@mosaic/api-contract";
import { previewAnswerFiles } from "./datasets/answerMapping.js";
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import {
    ApiBadRequestError,
    ApiConflictError,
    ApiNotFoundError,
    ApiPayloadTooLargeError,
} from "../errors.js";
import { assertStorageKey, localMediaPath } from "../mediaPaths.js";
import { MEDIA_SNIFF_BYTES, mediaBytesMatchType } from "../mediaSniff.js";
import { assertProjectInTeam } from "./projectScope.js";

interface IDatasetRow {
    id: string;
    name: string;
    purpose: IDatasetListRow["purpose"];
    modality: IDatasetListRow["modality"];
    created_at: Date | string;
    item_count: number | string | null;
    labeled_item_count: number | string | null;
    archived_at: Date | string | null;
}

interface IDatasetDetailRow {
    id: string;
    team_id: string;
    name: string;
    purpose: "golden" | "evaluation";
    modality: "audio" | "image" | "text";
    pipeline_id: string | null;
    description: string | null;
    archived_at: Date | string | null;
}

interface IDatasetLifecycleRow extends IDatasetDetailRow {
    created_by: string | null;
    created_at: Date | string;
}

interface IDatasetItemRow {
    id: string;
    type: "audio" | "image" | "text" | "mixed";
    input_text: string | null;
    source_name: string | null;
    storage_key: string | null;
    mime_type: string | null;
}

interface IDatasetDuplicateItemRow extends IDatasetItemRow {
    label_json: LabelJson | null;
}

interface ILabelRow {
    dataset_item_id: string;
    label_json: LabelJson;
}

interface ISchemaRow {
    json_schema: Record<string, unknown>;
}

interface IPipelineRow {
    output_schema: Record<string, unknown>;
    field_configs: IPipelineFieldConfig[];
}

interface IStorageKeyRow {
    storage_key: string | null;
}

interface ICountRow {
    count: number | string;
}

interface IDuplicatedDatasetRow {
    id: string;
}

interface IItemTeamRow {
    dataset_id: string;
    team_id: string;
    project_id: string;
    archived_at?: Date | string | null;
    storage_key?: string | null;
}

interface IDatasetItemEditRow {
    id: string;
    dataset_id: string;
    team_id: string;
    project_id: string;
    archived_at: Date | string | null;
    type: "audio" | "image" | "text" | "mixed";
    input_text: string | null;
    storage_key: string | null;
    mime_type: string | null;
    source_name: string | null;
}

interface IImportDatasetContext {
    dataset: IDatasetLifecycleRow;
    labelMode: DatasetLabelMode;
    answerSchema?: IParsedSchemaDescriptor;
    importSchema: IParsedSchemaDescriptor;
    freeformLabel: boolean;
}

interface IImportImageFile {
    name: string;
    mimeType: string;
    size: number;
    // Legacy path carries decoded `bytes`; direct-upload path carries a
    // pre-uploaded `storageKey`. Exactly one is present per file.
    bytes?: Buffer;
    storageKey?: string;
    reportedSize?: number;
}

interface IImportAudioFile {
    name: string;
    mimeType: string;
    size: number;
    bytes?: Buffer;
    storageKey?: string;
}

type IImportMediaFile = IImportImageFile | IImportAudioFile;

interface IFormLabelResult {
    label?: LabelJson;
    clearLabel?: boolean;
}

export async function listDatasetsPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    options: { includeArchived?: boolean; archivedOnly?: boolean } = {},
): Promise<IDatasetListRow[]> {
    const result = await db.query<IDatasetRow>(
        `select
            d.id,
            d.name,
            d.purpose,
            d.modality,
            d.created_at,
            d.archived_at,
            count(di.id)::int as item_count,
            count(l.id)::int as labeled_item_count
        from datasets d
        left join dataset_items di on di.dataset_id = d.id
        left join labels l on l.dataset_item_id = di.id
        where d.team_id = $1 and d.project_id = $2
            and ($3::boolean or d.archived_at is null)
            and (not $4::boolean or d.archived_at is not null)
        group by d.id, d.name, d.purpose, d.modality, d.created_at, d.archived_at
        order by d.created_at desc`,
        [
            teamId,
            projectId,
            Boolean(options.includeArchived || options.archivedOnly),
            Boolean(options.archivedOnly),
        ],
    );

    return result.rows.map((row) => {
        const itemCount = countValue(row.item_count);
        const labeledItemCount = countValue(row.labeled_item_count);
        return {
            id: row.id,
            name: row.name,
            purpose: row.purpose,
            modality: row.modality,
            createdAt:
                row.created_at instanceof Date
                    ? row.created_at.toISOString()
                    : new Date(row.created_at).toISOString(),
            itemCount,
            labeledItemCount,
            isRunnable: isDatasetRunnable(
                row.purpose,
                itemCount,
                labeledItemCount,
            ),
            archived: row.archived_at != null,
        };
    });
}

export async function datasetDetailPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    datasetId: string,
): Promise<IDatasetDetailResponse> {
    const datasetResult = await db.query<IDatasetDetailRow>(
        `select
            id,
            team_id,
            name,
            purpose,
            modality,
            pipeline_id,
            description,
            archived_at
        from datasets
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [datasetId, teamId, projectId],
    );
    const dataset = datasetResult.rows[0];
    if (!dataset) throw new ApiNotFoundError();

    const [itemsResult, schemaResult] = await Promise.all([
        db.query<IDatasetItemRow>(
            `select id, type, input_text, source_name, storage_key, mime_type
            from dataset_items
            where dataset_id = $1
            order by created_at asc`,
            [datasetId],
        ),
        db.query<ISchemaRow>(
            `select json_schema
            from dataset_schemas
            where dataset_id = $1
            limit 1`,
            [datasetId],
        ),
    ]);

    const itemIds = itemsResult.rows.map((item) => item.id);
    const labelRows =
        itemIds.length > 0
            ? (
                  await db.query<ILabelRow>(
                      `select dataset_item_id, label_json
                      from labels
                      where dataset_item_id = any($1::uuid[])`,
                      [itemIds],
                  )
              ).rows
            : [];
    const labelByItemId = new Map(
        labelRows.map((label) => [label.dataset_item_id, label.label_json]),
    );
    const labels = itemIds.map((itemId) => labelByItemId.get(itemId));
    const itemCount = itemsResult.rows.length;
    const labeledItemCount = labels.filter(Boolean).length;
    const labelMode = resolveLabelMode({
        purpose: dataset.purpose,
        pipelineId: dataset.pipeline_id,
        hasLegacySchema: Boolean(schemaResult.rows[0]),
    });
    const answerSchema = await resolveAnswerSchema(
        db,
        dataset,
        labelMode,
        schemaResult.rows[0],
    );

    return {
        dataset: {
            id: dataset.id,
            teamId: dataset.team_id,
            name: dataset.name,
            purpose: dataset.purpose,
            modality: dataset.modality,
            pipelineId: dataset.pipeline_id,
            description: dataset.description,
            archivedAt:
                dataset.archived_at instanceof Date
                    ? dataset.archived_at.toISOString()
                    : dataset.archived_at,
        },
        items: itemsResult.rows.map((item) => ({
            id: item.id,
            type: item.type,
            inputText: item.input_text,
            sourceName: item.source_name,
            storageKey: item.storage_key,
            mimeType: item.mime_type,
        })),
        labels,
        itemCount,
        labeledItemCount,
        labelMode,
        answerSchema,
        freeformLabel: usesFreeformLabel(labelMode),
        isRunnable: isDatasetRunnable(
            dataset.purpose,
            itemCount,
            labeledItemCount,
        ),
    };
}

export async function createDatasetPayload(
    db: IDb,
    input: ICreateDatasetRequest,
): Promise<ICreateDatasetResponse> {
    await assertProjectInTeam(db, input.teamId, input.projectId);
    const result = await db.query<{ id: string }>(
        `insert into datasets (team_id, project_id, name, purpose, modality, created_by)
        values ($1, $2, $3, $4, $5, $6)
        returning id`,
        [
            input.teamId,
            input.projectId,
            input.name,
            input.purpose,
            input.modality,
            input.createdBy,
        ],
    );
    return { id: result.rows[0]!.id };
}

export async function signUploadPayload(
    db: IDb,
    config: IApiConfig,
    input: ICreateSignedUploadRequest,
): Promise<ICreateSignedUploadResponse> {
    const caps = UPLOAD_MODALITY_CAPS[input.modality];
    if (!caps) {
        throw new ApiBadRequestError("Unsupported upload modality.");
    }
    if (!Array.isArray(input.files) || input.files.length === 0) {
        throw new ApiBadRequestError("Choose one or more files to upload.");
    }
    if (input.files.length > MAX_IMPORT_FILE_COUNT) {
        throw new ApiBadRequestError(
            `${caps.label} upload is limited to ${MAX_IMPORT_FILE_COUNT} files.`,
        );
    }
    await assertEditableDataset(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );

    let totalBytes = 0;
    const allowedTypes =
        input.modality === "image"
            ? CONTRACT_ALLOWED_IMAGE_TYPES
            : CONTRACT_ALLOWED_AUDIO_TYPES;
    for (const file of input.files) {
        if (typeof file.fileName !== "string" || file.fileName.trim() === "") {
            throw new ApiBadRequestError("Each file requires a file name.");
        }
        if (!Number.isFinite(file.byteSize) || file.byteSize < 0) {
            throw new ApiBadRequestError(
                "Each file requires a valid byte size.",
            );
        }
        if (file.byteSize > caps.perFile) {
            throw new ApiBadRequestError(
                `${caps.label} file exceeds the ${formatBytes(caps.perFile)} per-file limit.`,
            );
        }
        if (!allowedTypes.includes(file.contentType)) {
            throw new ApiBadRequestError(
                `"${file.fileName}" has unsupported type "${file.contentType}" for ${input.modality} uploads.`,
            );
        }
        totalBytes += file.byteSize;
    }
    if (totalBytes > caps.batch) {
        throw new ApiBadRequestError(
            `${caps.label} upload exceeds the ${formatBytes(caps.batch)} payload limit.`,
        );
    }

    const targets: ISignedUploadTarget[] = [];
    for (const file of input.files) {
        // KTD3: storageKey is server-authoritative and dataset-scoped so a
        // client cannot choose or overwrite an arbitrary object path.
        const storageKey = `datasets/${input.datasetId}/${randomUUID()}${uploadFileExtension(file.fileName)}`;
        targets.push(
            await createSignedUploadTarget(
                config,
                storageKey,
                file.contentType,
                file.byteSize,
            ),
        );
    }
    return { targets };
}

/**
 * Defense-in-depth: a client submits `storageKey` through the import Server
 * Actions, but the API only shape-checks it. Bind a consumed dataset-scoped key
 * (`datasets/<id>/...`) to the dataset it is being imported into so a caller
 * cannot reference an object minted for another dataset. Legacy bare-uuid keys
 * (no `datasets/` prefix) are exempt and pass through.
 */
function assertStorageKeyForDataset(
    storageKey: string,
    datasetId: string,
): void {
    assertStorageKey(storageKey);
    if (
        storageKey.startsWith("datasets/") &&
        !storageKey.startsWith(`datasets/${datasetId}/`)
    ) {
        throw new ApiBadRequestError(
            "Storage key does not belong to this dataset.",
        );
    }
}

/**
 * Resolve the single media reference and derived item type for a create/update,
 * enforcing the "one of audio|image" rule and the dataset-scoped storageKey
 * binding. Extracted to keep the payload handlers under the complexity budget.
 */
function resolveItemMedia(input: ICreateDatasetItemRequest): {
    media: ICreateDatasetItemRequest["audio"];
    itemType: "audio" | "image" | "mixed" | "text";
} {
    if (input.audio && input.image) {
        throw new ApiBadRequestError(
            "Choose either audio or image for this item.",
        );
    }
    const media = input.audio ?? input.image;
    if (media?.storageKey) {
        assertStorageKeyForDataset(media.storageKey, input.datasetId);
    }
    const mediaType = input.audio ? "audio" : input.image ? "image" : undefined;
    const hasMedia =
        Boolean(input.audio?.storageKey) || Boolean(input.image?.storageKey);
    const itemType = datasetItemTypeForMedia(
        Boolean(input.inputText),
        hasMedia,
        mediaType,
    );
    return { media, itemType };
}

export async function createDatasetItemPayload(
    db: IDb,
    input: ICreateDatasetItemRequest,
): Promise<{ datasetId: string }> {
    await assertEditableDataset(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );
    const { media, itemType } = resolveItemMedia(input);

    try {
        const item = await db.query<{ id: string }>(
            `insert into dataset_items (
                dataset_id,
                type,
                input_text,
                source_name,
                storage_key,
                mime_type
            )
            select $1, $2, $3, $4, $5, $6
            where exists (
                select 1 from datasets
                where id = $1 and team_id = $7 and project_id = $8
            )
            returning id`,
            [
                input.datasetId,
                itemType,
                input.inputText || null,
                normalizeSourceName(media?.sourceName) ?? null,
                media?.storageKey ?? null,
                media?.mimeType ?? null,
                input.teamId,
                input.projectId,
            ],
        );
        if (!item.rows[0]) throw new ApiNotFoundError("Dataset not found");
        if (input.label) {
            await db.query(
                `insert into labels (dataset_item_id, label_json)
                values ($1, $2)
                on conflict (dataset_item_id) do update set
                    label_json = excluded.label_json`,
                [item.rows[0]!.id, input.label],
            );
        }
    } catch (err) {
        if (isUniqueViolation(err)) {
            throw new ApiConflictError(
                "An item with this source file already exists.",
            );
        }
        throw err;
    }

    return { datasetId: input.datasetId };
}

export async function createDatasetItemFromFormPayload(
    db: IDb,
    config: IApiConfig,
    input: ICreateDatasetItemFromFormRequest,
): Promise<{ datasetId: string }> {
    const context = await importDatasetContext(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );
    const labelResult = parseLabelForDatasetMutation(context, input.rawLabel, {
        mode: "create",
    });
    if (input.audio && input.image) {
        throw new ApiBadRequestError(
            "Choose either audio or image for this item.",
        );
    }
    const file = input.image ? decodeImportImage(input.image) : undefined;
    const audio = input.audio ? decodeImportAudio(input.audio) : undefined;
    let storageKey: string | undefined;
    let audioStorageKey: string | undefined;
    try {
        if (file) {
            assertSingleImageFile(file);
            storageKey = await persistDecodedMedia(
                config,
                file,
                MAX_IMAGE_BYTES,
            );
        }
        if (audio) {
            assertSingleAudioFile(audio);
            audioStorageKey = await persistDecodedMedia(
                config,
                audio,
                MAX_AUDIO_BYTES,
            );
        }
        return await createDatasetItemPayload(db, {
            teamId: input.teamId,
            projectId: input.projectId,
            datasetId: input.datasetId,
            inputText: input.inputText,
            ...(labelResult.label !== undefined
                ? { label: labelResult.label }
                : {}),
            ...(file && storageKey
                ? {
                      image: {
                          storageKey,
                          mimeType: file.mimeType,
                          sourceName: file.name,
                      },
                  }
                : {}),
            ...(audio && audioStorageKey
                ? {
                      audio: {
                          storageKey: audioStorageKey,
                          mimeType: audio.mimeType,
                          sourceName: audio.name,
                      },
                  }
                : {}),
        });
    } catch (err) {
        // R7/KTD6: best-effort clean up any object we uploaded or the client
        // uploaded, since the item was not created.
        if (storageKey)
            await deleteMediaFromStorage(config, storageKey).catch(() => {});
        if (audioStorageKey) {
            await deleteMediaFromStorage(config, audioStorageKey).catch(
                () => {},
            );
        }
        throw err;
    }
}

export async function updateDatasetItemPayload(
    db: IDb,
    input: IUpdateDatasetItemRequest,
): Promise<{ datasetId: string }> {
    const result = await db.query<IDatasetItemEditRow>(
        `select
            di.id,
            di.dataset_id,
            di.type,
            di.input_text,
            di.storage_key,
            di.mime_type,
            di.source_name,
            d.team_id,
            d.project_id,
            d.archived_at
        from dataset_items di
        inner join datasets d on di.dataset_id = d.id
        where di.id = $1 and d.team_id = $2 and d.project_id = $3
        limit 1`,
        [input.itemId, input.teamId, input.projectId],
    );
    const existing = result.rows[0];
    if (!existing) {
        throw new ApiNotFoundError("Dataset item not found");
    }
    if (existing.archived_at != null) {
        throw new ApiConflictError(
            "This dataset is archived. Restore it to make changes.",
        );
    }

    if (input.audio && input.image) {
        throw new ApiBadRequestError(
            "Choose either audio or image for this item.",
        );
    }
    const media = input.audio ?? input.image;
    if (media?.storageKey)
        assertStorageKeyForDataset(media.storageKey, existing.dataset_id);
    const mediaType = input.audio ? "audio" : input.image ? "image" : undefined;
    const nextStorageKey = media?.storageKey ?? existing.storage_key;
    const nextMimeType = media?.mimeType ?? existing.mime_type;
    const nextSourceName = media
        ? normalizeSourceName(media.sourceName)
        : existing.source_name;
    const hasMedia = Boolean(nextStorageKey);
    const hasText = Boolean(input.inputText);
    const itemType = datasetItemTypeForMedia(
        hasText,
        hasMedia,
        mediaType ?? mediaKindFromStoredItem(nextMimeType, existing.type),
    );

    try {
        await db.query(
            `update dataset_items
            set
                input_text = $1,
                source_name = $2,
                storage_key = $3,
                mime_type = $4,
                type = $5
            where id = $6
              and dataset_id in (
                  select id from datasets where team_id = $7 and project_id = $8
              )`,
            [
                input.inputText || null,
                nextSourceName ?? null,
                nextStorageKey,
                nextMimeType,
                itemType,
                input.itemId,
                input.teamId,
                input.projectId,
            ],
        );
        if (input.label !== undefined) {
            await db.query(
                `insert into labels (dataset_item_id, label_json)
                select $1, $2
                where exists (
                    select 1 from dataset_items di
                    inner join datasets d on d.id = di.dataset_id
                    where di.id = $1 and d.team_id = $3 and d.project_id = $4
                )
                on conflict (dataset_item_id) do update set
                    label_json = excluded.label_json`,
                [input.itemId, input.label, input.teamId, input.projectId],
            );
        } else if (input.clearLabel) {
            await db.query(
                `delete from labels l
                using dataset_items di, datasets d
                where l.dataset_item_id = $1
                  and di.id = l.dataset_item_id
                  and d.id = di.dataset_id
                  and d.team_id = $2
                  and d.project_id = $3`,
                [input.itemId, input.teamId, input.projectId],
            );
        }
    } catch (err) {
        if (isUniqueViolation(err)) {
            throw new ApiConflictError(
                "An item with this source file already exists.",
            );
        }
        throw err;
    }

    return { datasetId: existing.dataset_id };
}

export async function updateDatasetItemFromFormPayload(
    db: IDb,
    config: IApiConfig,
    input: IUpdateDatasetItemFromFormRequest,
): Promise<{ datasetId: string }> {
    const existing = await datasetItemEditContext(
        db,
        input.teamId,
        input.projectId,
        input.itemId,
    );
    const context = await importDatasetContext(
        db,
        input.teamId,
        input.projectId,
        existing.dataset_id,
    );
    const labelResult = parseLabelForDatasetMutation(context, input.rawLabel, {
        mode: "update",
    });
    if (input.audio && input.image) {
        throw new ApiBadRequestError(
            "Choose either audio or image for this item.",
        );
    }
    const file = input.image ? decodeImportImage(input.image) : undefined;
    const audio = input.audio ? decodeImportAudio(input.audio) : undefined;
    let storageKey: string | undefined;
    let audioStorageKey: string | undefined;
    try {
        if (file) {
            assertSingleImageFile(file);
            storageKey = await persistDecodedMedia(
                config,
                file,
                MAX_IMAGE_BYTES,
            );
        }
        if (audio) {
            assertSingleAudioFile(audio);
            audioStorageKey = await persistDecodedMedia(
                config,
                audio,
                MAX_AUDIO_BYTES,
            );
        }
        const updated = await updateDatasetItemPayload(db, {
            teamId: input.teamId,
            projectId: input.projectId,
            itemId: input.itemId,
            inputText: input.inputText,
            ...(labelResult.label !== undefined
                ? { label: labelResult.label }
                : {}),
            ...(labelResult.clearLabel ? { clearLabel: true } : {}),
            ...(file && storageKey
                ? {
                      image: {
                          storageKey,
                          mimeType: file.mimeType,
                          sourceName: file.name,
                      },
                  }
                : {}),
            ...(audio && audioStorageKey
                ? {
                      audio: {
                          storageKey: audioStorageKey,
                          mimeType: audio.mimeType,
                          sourceName: audio.name,
                      },
                  }
                : {}),
        });
        const replacementStorageKey = storageKey ?? audioStorageKey;
        if (
            replacementStorageKey &&
            existing.storage_key &&
            existing.storage_key !== replacementStorageKey
        ) {
            await deleteMediaFromStorage(config, existing.storage_key).catch(
                () => {},
            );
        }
        return updated;
    } catch (err) {
        if (storageKey)
            await deleteMediaFromStorage(config, storageKey).catch(() => {});
        if (audioStorageKey) {
            await deleteMediaFromStorage(config, audioStorageKey).catch(
                () => {},
            );
        }
        throw err;
    }
}

export async function importImagesPayload(
    db: IDb,
    config: IApiConfig,
    input: IImportImagesRequest,
): Promise<IImportSummary> {
    const context = await importDatasetContext(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );
    if (context.dataset.modality !== "image") {
        return rejectedImport("Only image datasets can import images.");
    }
    const files = decodeImportImages(input.images);
    if (files.length === 0)
        return rejectedImport("Choose one or more images to add.");
    return importImageFiles(
        db,
        config,
        input.teamId,
        input.projectId,
        context.dataset.id,
        files,
    );
}

export async function importAudioPayload(
    db: IDb,
    config: IApiConfig,
    input: IImportAudioRequest,
): Promise<IImportSummary> {
    const context = await importDatasetContext(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );
    if (context.dataset.modality !== "audio") {
        return rejectedImport("Only audio datasets can import audio.");
    }
    const files = decodeImportAudioFiles(input.audio);
    if (files.length === 0)
        return rejectedImport("Choose one or more audio files to add.");
    return importAudioFiles(
        db,
        config,
        input.teamId,
        input.projectId,
        context.dataset.id,
        files,
    );
}

export async function importImageAnswersPayload(
    db: IDb,
    config: IApiConfig,
    input: IImportImageAnswersRequest,
): Promise<IImportSummary> {
    const context = await importDatasetContext(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );
    if (
        context.dataset.purpose === "evaluation" ||
        context.dataset.modality !== "image"
    ) {
        return rejectedImport(
            "Only golden image datasets can import images with answers.",
        );
    }
    if (!context.freeformLabel) {
        return rejectedImport(
            "Use the structured paired import for this dataset.",
        );
    }
    const files = decodeImportImages(input.images);
    if (files.length === 0)
        return rejectedImport("Choose one or more images to add.");
    if (
        Buffer.byteLength(input.answersContent, "utf8") > MAX_TEXT_IMPORT_BYTES
    ) {
        return rejectedImport(
            `Answer file exceeds the ${formatBytes(MAX_TEXT_IMPORT_BYTES)} payload limit.`,
        );
    }
    const partition = partitionImageImportFiles(files);
    if (partition.summary.rejected) return partition.summary;
    const plan = prepareGoldenAnswersByKey(
        partition.uniqueValidNames,
        input.answersContent,
    );
    if (plan.rejected) {
        return { importedCount: 0, failures: plan.failures, rejected: true };
    }

    const fileByName = new Map(files.map((file) => [file.name, file]));
    const failures = [...partition.summary.failures, ...plan.failures];
    let importedCount = 0;
    for (const pair of plan.pairs) {
        const file = fileByName.get(pair.key);
        if (!file) continue;
        const result = await createImageImportItem(
            db,
            config,
            input.teamId,
            input.projectId,
            context.dataset.id,
            file,
            pair.label,
        );
        if (result.ok) importedCount++;
        else failures.push({ fileName: file.name, reason: result.reason });
    }
    return { importedCount, failures };
}

export async function importAudioAnswersPayload(
    db: IDb,
    config: IApiConfig,
    input: IImportAudioAnswersRequest,
): Promise<IImportSummary> {
    const context = await importDatasetContext(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );
    if (
        context.dataset.purpose === "evaluation" ||
        context.dataset.modality !== "audio"
    ) {
        return rejectedImport(
            "Only golden audio datasets can import audio with answers.",
        );
    }
    if (!context.freeformLabel) {
        return rejectedImport(
            "Use the structured paired import for this dataset.",
        );
    }
    const files = decodeImportAudioFiles(input.audio);
    if (files.length === 0)
        return rejectedImport("Choose one or more audio files to add.");
    if (
        Buffer.byteLength(input.answersContent, "utf8") > MAX_TEXT_IMPORT_BYTES
    ) {
        return rejectedImport(
            `Answer file exceeds the ${formatBytes(MAX_TEXT_IMPORT_BYTES)} payload limit.`,
        );
    }
    const partition = partitionAudioImportFiles(files);
    if (partition.summary.rejected) return partition.summary;
    const plan = prepareGoldenAnswersByKey(
        partition.uniqueValidNames,
        input.answersContent,
        "filename",
        "audio",
    );
    if (plan.rejected) {
        return { importedCount: 0, failures: plan.failures, rejected: true };
    }

    const fileByName = new Map(files.map((file) => [file.name, file]));
    const failures = [...partition.summary.failures, ...plan.failures];
    let importedCount = 0;
    for (const pair of plan.pairs) {
        const labelFailures = validateAudioReferenceLabel(pair.label);
        if (labelFailures.length > 0) {
            failures.push({
                fileName: pair.key,
                reason: labelFailures.join("; "),
            });
            continue;
        }
        const file = fileByName.get(pair.key);
        if (!file) continue;
        const result = await createAudioImportItem(
            db,
            config,
            input.teamId,
            input.projectId,
            context.dataset.id,
            file,
            pair.label,
        );
        if (result.ok) importedCount++;
        else failures.push({ fileName: file.name, reason: result.reason });
    }
    return { importedCount, failures };
}

export async function importTextItemsPayload(
    db: IDb,
    input: IImportTextItemsRequest,
): Promise<IImportSummary> {
    const context = await importDatasetContext(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );
    const prepared = prepareTextImport(
        input.content,
        input.format,
        context.importSchema,
    );
    if (prepared.rejected) {
        return {
            importedCount: 0,
            failures: prepared.failures,
            rejected: true,
        };
    }

    const failures = [...prepared.failures];
    let importedCount = 0;
    for (const row of prepared.rows) {
        try {
            await createDatasetItemPayload(db, {
                teamId: input.teamId,
                projectId: input.projectId,
                datasetId: context.dataset.id,
                inputText: row.inputText,
                label: row.label,
            });
            importedCount++;
        } catch (err) {
            failures.push({ reason: importFailureReason(err) });
        }
    }
    return { importedCount, failures };
}

export async function importGoldenAnswersPayload(
    db: IDb,
    input: IImportGoldenAnswersRequest,
): Promise<IImportSummary> {
    const context = await importDatasetContext(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );
    if (context.dataset.purpose === "evaluation") {
        return rejectedImport(
            "Evaluation datasets do not carry golden answers.",
        );
    }
    const items = await db.query<{
        id: string;
        input_text: string | null;
        source_name: string | null;
    }>(
        `select id, input_text, source_name
        from dataset_items
        where dataset_id = $1
        order by created_at asc`,
        [context.dataset.id],
    );
    if (items.rows.length === 0) {
        return rejectedImport(
            "Add items to the dataset before importing answers.",
        );
    }
    const plan = prepareGoldenAnswersForItems(
        items.rows.map((item) => ({
            itemId: item.id,
            // Fixed slots: id > input_text > source_name. Empty strings are
            // ignored during key registration but preserve priority ranks so
            // source_name cannot clobber another item's input_text/id.
            matchKeys: [
                item.id,
                item.input_text?.trim() ?? "",
                item.source_name?.trim() ?? "",
            ],
        })),
        input.answersContent,
    );
    if (plan.rejected) {
        return { importedCount: 0, failures: plan.failures, rejected: true };
    }

    const failures = [...plan.failures];
    let importedCount = 0;
    for (const pair of plan.pairs) {
        try {
            await upsertLabel(
                db,
                input.teamId,
                input.projectId,
                pair.itemId,
                pair.label,
            );
            importedCount++;
        } catch (err) {
            failures.push({ reason: importFailureReason(err) });
        }
    }
    return { importedCount, failures };
}

export async function previewGoldenAnswersPayload(
    db: IDb,
    input: IPreviewGoldenAnswersRequest,
): Promise<IAnswerImportPreview> {
    validateMappedAnswerImportInput(input.answersContent, input.mapping, true);
    validateAnswerImportFiles(input.answerFiles);
    if (answerImportByteLength(input) > MAX_TEXT_IMPORT_BYTES) {
        return failingAnswerPreview(
            `Answer file exceeds the ${formatBytes(MAX_TEXT_IMPORT_BYTES)} payload limit.`,
        );
    }
    const { context, items } = await answerImportContext(db, input);
    if (context.dataset.purpose === "evaluation") {
        return failingAnswerPreview(
            "Evaluation datasets do not carry golden answers.",
        );
    }
    if (context.dataset.modality !== "audio") {
        return failingAnswerPreview(
            "Mapped STT golden answers are only available for audio datasets.",
        );
    }
    return previewAnswerFiles(answerImportFiles(input), items, input.mapping);
}

export async function commitGoldenAnswersPayload(
    db: IDb,
    input: ICommitGoldenAnswersRequest,
): Promise<IImportSummary> {
    validateMappedAnswerImportInput(input.answersContent, input.mapping);
    validateAnswerImportFiles(input.answerFiles);
    if (answerImportByteLength(input) > MAX_TEXT_IMPORT_BYTES) {
        return rejectedImport(
            `Answer file exceeds the ${formatBytes(MAX_TEXT_IMPORT_BYTES)} payload limit.`,
        );
    }
    const { context, items } = await answerImportContext(db, input);
    if (context.dataset.purpose === "evaluation") {
        return rejectedImport(
            "Evaluation datasets do not carry golden answers.",
        );
    }
    if (context.dataset.modality !== "audio") {
        return rejectedImport(
            "Mapped STT golden answers are only available for audio datasets.",
        );
    }
    const preview = previewAnswerFiles(
        answerImportFiles(input),
        items,
        input.mapping,
    );
    const failures: IImportSummary["failures"] = preview.rows
        .filter((row) => row.status === "failing")
        .map((row) => ({
            row: row.row,
            ...(row.fileName ? { fileName: row.fileName } : {}),
            reason: row.messages.join(" "),
        }));
    let importedCount = 0;
    for (const row of preview.rows) {
        if (row.status === "failing" || !row.itemId || !row.label) continue;
        try {
            const fileAllowsOverwrite = input.answerFiles?.find(
                (file) => file.fileName === row.fileName,
            )?.allowOverwrite;
            await upsertLabel(
                db,
                input.teamId,
                input.projectId,
                row.itemId,
                row.label,
                row.interpretation !== "single_record" ||
                    fileAllowsOverwrite === true,
            );
            importedCount += 1;
        } catch (error) {
            failures.push({
                row: row.row,
                ...(row.fileName ? { fileName: row.fileName } : {}),
                reason: importFailureReason(error),
            });
        }
    }
    return { importedCount, failures };
}

function validateMappedAnswerImportInput(
    answersContent: unknown,
    mapping: unknown,
    mappingOptional = false,
): asserts answersContent is string {
    if (typeof answersContent !== "string") {
        throw new ApiBadRequestError("Answer file content must be text.");
    }
    if (
        !(mappingOptional && mapping === undefined) &&
        (!mapping || typeof mapping !== "object" || Array.isArray(mapping))
    ) {
        throw new ApiBadRequestError("Answer field mapping must be an object.");
    }
}

function answerImportFiles(
    input: Pick<IImportGoldenAnswersRequest, "answersContent" | "answerFiles">,
) {
    return input.answerFiles?.length
        ? input.answerFiles
        : [{ fileName: "answers.json", content: input.answersContent }];
}

function validateAnswerImportFiles(
    files: IImportGoldenAnswersRequest["answerFiles"],
): void {
    if (files === undefined) return;
    if (!Array.isArray(files) || files.length === 0) {
        throw new ApiBadRequestError("Answer files must be a non-empty array.");
    }
    if (files.length > MAX_IMPORT_FILE_COUNT) {
        throw new ApiBadRequestError(
            `Answer import is limited to ${MAX_IMPORT_FILE_COUNT} files.`,
        );
    }
    const names = new Set<string>();
    for (const file of files) {
        validateAnswerImportFile(file, names);
    }
}

function validateAnswerImportFile(file: unknown, names: Set<string>): void {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
        throw new ApiBadRequestError(
            "Each answer file needs a filename and text content.",
        );
    }
    const candidate = file as Record<string, unknown>;
    if (
        typeof candidate.fileName !== "string" ||
        !candidate.fileName.trim() ||
        typeof candidate.content !== "string"
    ) {
        throw new ApiBadRequestError(
            "Each answer file needs a filename and text content.",
        );
    }
    const normalizedName = candidate.fileName.trim().toLowerCase();
    if (names.has(normalizedName)) {
        throw new ApiBadRequestError(
            `Answer filename "${candidate.fileName}" appears more than once.`,
        );
    }
    names.add(normalizedName);
    if (
        candidate.interpretation !== undefined &&
        candidate.interpretation !== "single_record" &&
        candidate.interpretation !== "keyed_map"
    ) {
        throw new ApiBadRequestError(
            "Answer file interpretation is not supported.",
        );
    }
    if (
        candidate.itemId !== undefined &&
        (typeof candidate.itemId !== "string" || !candidate.itemId.trim())
    ) {
        throw new ApiBadRequestError(
            "Selected answer item id must be non-empty text.",
        );
    }
    if (
        candidate.allowOverwrite !== undefined &&
        typeof candidate.allowOverwrite !== "boolean"
    ) {
        throw new ApiBadRequestError(
            "Answer overwrite confirmation must be a boolean.",
        );
    }
}

function answerImportByteLength(
    input: Pick<IImportGoldenAnswersRequest, "answersContent" | "answerFiles">,
): number {
    return (
        Buffer.byteLength(input.answersContent, "utf8") +
        (input.answerFiles ?? []).reduce(
            (total, file) => total + Buffer.byteLength(file.content, "utf8"),
            0,
        )
    );
}

async function answerImportContext(
    db: IDb,
    input: Pick<
        IImportGoldenAnswersRequest,
        "teamId" | "projectId" | "datasetId"
    >,
) {
    const context = await importDatasetContext(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );
    const result = await db.query<{
        id: string;
        input_text: string | null;
        source_name: string | null;
        has_label: boolean;
    }>(
        `select di.id, di.input_text, di.source_name,
            exists(select 1 from labels l where l.dataset_item_id = di.id) as has_label
        from dataset_items di
        where di.dataset_id = $1
        order by di.created_at asc`,
        [context.dataset.id],
    );
    return {
        context,
        items: result.rows.map((item) => ({
            itemId: item.id,
            inputText: item.input_text,
            sourceName: item.source_name,
            hasLabel: item.has_label,
        })),
    };
}

function failingAnswerPreview(message: string): IAnswerImportPreview {
    return {
        fields: [],
        proposedMapping: {},
        rows: [{ row: 1, status: "failing", messages: [message] }],
        importableCount: 0,
        warningCount: 0,
        failingCount: 1,
    };
}

export async function importPairedItemsPayload(
    db: IDb,
    config: IApiConfig,
    input: IImportPairedItemsRequest,
): Promise<IImportSummary> {
    const context = await importDatasetContext(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );
    if (!context.answerSchema) {
        return rejectedImport(
            "Answer schema is not configured for this dataset.",
        );
    }
    const files = decodeImportImages(input.images);
    if (files.length === 0) {
        return rejectedImport(
            "Choose the image files to pair with the spreadsheet.",
        );
    }
    const partition = partitionImageImportFiles(files);
    if (partition.summary.rejected) return partition.summary;
    const plan = preparePairedImport(
        partition.uniqueValidNames,
        input.csvContent,
        context.answerSchema,
    );
    if (plan.rejected) {
        return { importedCount: 0, failures: plan.failures, rejected: true };
    }

    const fileByName = new Map(files.map((file) => [file.name, file]));
    const failures = [...partition.summary.failures, ...plan.failures];
    let importedCount = 0;
    for (const item of plan.items) {
        const file = fileByName.get(item.fileName);
        if (!file) continue;
        const result = await createImageImportItem(
            db,
            config,
            input.teamId,
            input.projectId,
            context.dataset.id,
            file,
            item.label,
        );
        if (result.ok) importedCount++;
        else failures.push({ fileName: item.fileName, reason: result.reason });
    }
    return { importedCount, failures };
}

export async function updateDatasetNamePayload(
    db: IDb,
    input: IUpdateDatasetNameRequest,
): Promise<void> {
    await assertEditableDataset(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );
    await db.query(
        `update datasets
        set name = $1
        where id = $2 and team_id = $3 and project_id = $4`,
        [input.name, input.datasetId, input.teamId, input.projectId],
    );
}

export async function updateDatasetDescriptionPayload(
    db: IDb,
    input: IUpdateDatasetDescriptionRequest,
): Promise<void> {
    await assertEditableDataset(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );
    await db.query(
        `update datasets
        set description = $1
        where id = $2 and team_id = $3 and project_id = $4`,
        [input.description, input.datasetId, input.teamId, input.projectId],
    );
}

export async function setDatasetArchivedPayload(
    db: IDb,
    input: ISetDatasetArchivedRequest,
): Promise<void> {
    await getOwnedDataset(db, input.teamId, input.projectId, input.datasetId);
    await db.query(
        `update datasets
        set archived_at = ${input.archived ? "now()" : "null"}
        where id = $1 and team_id = $2 and project_id = $3`,
        [input.datasetId, input.teamId, input.projectId],
    );
}

export async function duplicateDatasetPayload(
    db: IDb,
    input: IDuplicateDatasetRequest,
): Promise<void> {
    const source = await assertEditableDataset(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );
    const copy = await db.query<IDuplicatedDatasetRow>(
        `insert into datasets (
            team_id,
            project_id,
            name,
            purpose,
            modality,
            pipeline_id,
            description,
            created_by
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning id`,
        [
            source.team_id,
            input.projectId,
            `Copy of ${source.name}`,
            source.purpose,
            source.modality,
            source.pipeline_id,
            source.description,
            input.createdBy,
        ],
    );
    const copyId = copy.rows[0]!.id;

    await db.query(
        `insert into dataset_schemas (dataset_id, json_schema, field_rules)
        select $1, json_schema, field_rules
        from dataset_schemas
        where dataset_id = $2`,
        [copyId, input.datasetId],
    );

    const items = await db.query<IDatasetDuplicateItemRow>(
        `select
            di.id,
            di.type,
            di.input_text,
            di.source_name,
            di.storage_key,
            di.mime_type,
            l.label_json
        from dataset_items di
        left join labels l on l.dataset_item_id = di.id
        where di.dataset_id = $1
        order by di.created_at asc`,
        [input.datasetId],
    );

    for (const item of items.rows) {
        const copiedItem = await db.query<{ id: string }>(
            `insert into dataset_items (
                dataset_id,
                type,
                input_text,
                source_name,
                storage_key,
                mime_type
            )
            values ($1, $2, $3, $4, $5, $6)
            returning id`,
            [
                copyId,
                item.type,
                item.input_text,
                item.source_name,
                item.storage_key,
                item.mime_type,
            ],
        );
        if (item.label_json) {
            await db.query(
                `insert into labels (dataset_item_id, label_json)
                values ($1, $2)`,
                [copiedItem.rows[0]!.id, item.label_json],
            );
        }
    }
}

export async function deleteDatasetPayload(
    db: IDb,
    config: IApiConfig,
    input: IDeleteDatasetRequest,
): Promise<void> {
    await getOwnedDataset(db, input.teamId, input.projectId, input.datasetId);
    const usage = await db.query<ICountRow>(
        `select count(*)::int as count
        from runs
        where dataset_id = $1`,
        [input.datasetId],
    );
    if (countValue(usage.rows[0]?.count ?? 0) > 0) {
        throw new ApiConflictError(
            "Delete the runs that use this dataset before deleting the dataset.",
        );
    }

    const storageKeys = (
        await db.query<IStorageKeyRow>(
            `select storage_key
            from dataset_items
            where dataset_id = $1`,
            [input.datasetId],
        )
    ).rows
        .map((row) => row.storage_key)
        .filter((key): key is string => Boolean(key));

    await db.query(
        `with item_ids as (
            select id
            from dataset_items
            where dataset_id = $1
        ),
        deleted_labels as (
            delete from labels
            where dataset_item_id in (select id from item_ids)
        ),
        deleted_schema as (
            delete from dataset_schemas
            where dataset_id = $1
        ),
        deleted_items as (
            delete from dataset_items
            where dataset_id = $1
        )
        delete from datasets
        where id = $1 and team_id = $2 and project_id = $3`,
        [input.datasetId, input.teamId, input.projectId],
    );

    await Promise.all(
        storageKeys.map((storageKey) =>
            deleteMediaFromStorage(config, storageKey).catch(() => {}),
        ),
    );
}

export async function deleteLabelPayload(
    db: IDb,
    input: IDeleteLabelRequest,
): Promise<{ datasetId: string }> {
    const result = await db.query<IItemTeamRow>(
        `select di.dataset_id, d.team_id, d.project_id
        from dataset_items di
        inner join datasets d on di.dataset_id = d.id
        where di.id = $1 and d.team_id = $2 and d.project_id = $3
        limit 1`,
        [input.itemId, input.teamId, input.projectId],
    );
    const row = result.rows[0];
    if (!row) {
        throw new ApiNotFoundError("Dataset item not found");
    }

    await db.query(
        `delete from labels l
        using dataset_items di, datasets d
        where l.dataset_item_id = $1
          and di.id = l.dataset_item_id
          and d.id = di.dataset_id
          and d.team_id = $2
          and d.project_id = $3`,
        [input.itemId, input.teamId, input.projectId],
    );
    return { datasetId: row.dataset_id };
}

export async function deleteDatasetItemPayload(
    db: IDb,
    config: IApiConfig,
    input: IDeleteDatasetItemRequest,
): Promise<{ datasetId: string }> {
    const result = await db.query<IItemTeamRow>(
        `select di.dataset_id, di.storage_key, d.team_id, d.project_id, d.archived_at
        from dataset_items di
        inner join datasets d on di.dataset_id = d.id
        where di.id = $1 and d.team_id = $2 and d.project_id = $3
        limit 1`,
        [input.itemId, input.teamId, input.projectId],
    );
    const row = result.rows[0];
    if (!row) {
        throw new ApiNotFoundError("Dataset item not found");
    }
    if (row.archived_at != null) {
        throw new ApiConflictError(
            "This dataset is archived. Restore it to make changes.",
        );
    }

    const usage = await db.query<ICountRow>(
        `select count(*)::int as count
        from run_cells
        where dataset_item_id = $1`,
        [input.itemId],
    );
    if (countValue(usage.rows[0]?.count ?? 0) > 0) {
        throw new ApiConflictError(
            "Delete the runs that use this item before deleting it.",
        );
    }

    await db.query(
        `delete from labels l
        using dataset_items di, datasets d
        where l.dataset_item_id = $1
          and di.id = l.dataset_item_id
          and d.id = di.dataset_id
          and d.team_id = $2
          and d.project_id = $3`,
        [input.itemId, input.teamId, input.projectId],
    );
    await db.query(
        `delete from dataset_items di
        using datasets d
        where di.id = $1
          and d.id = di.dataset_id
          and d.team_id = $2
          and d.project_id = $3`,
        [input.itemId, input.teamId, input.projectId],
    );
    if (row.storage_key) {
        await deleteMediaFromStorage(config, row.storage_key).catch(() => {});
    }
    return { datasetId: row.dataset_id };
}

async function importDatasetContext(
    db: IDb,
    teamId: string,
    projectId: string,
    datasetId: string,
): Promise<IImportDatasetContext> {
    const dataset = await assertEditableDataset(
        db,
        teamId,
        projectId,
        datasetId,
    );
    const schemaRow = (
        await db.query<ISchemaRow>(
            `select json_schema
            from dataset_schemas
            where dataset_id = $1
            limit 1`,
            [datasetId],
        )
    ).rows[0];
    const labelMode = resolveLabelMode({
        purpose: dataset.purpose,
        pipelineId: dataset.pipeline_id,
        hasLegacySchema: Boolean(schemaRow),
    });
    const answerSchema = await resolveAnswerSchema(
        db,
        dataset,
        labelMode,
        schemaRow,
    );
    const importSchema = answerSchema ?? {
        fields: [],
        additionalProperties: true,
    };
    return {
        dataset,
        labelMode,
        answerSchema,
        importSchema,
        freeformLabel: usesFreeformLabel(labelMode),
    };
}

async function datasetItemEditContext(
    db: IDb,
    teamId: string,
    projectId: string,
    itemId: string,
): Promise<IDatasetItemEditRow> {
    const result = await db.query<IDatasetItemEditRow>(
        `select
            di.id,
            di.dataset_id,
            di.type,
            di.input_text,
            di.storage_key,
            di.mime_type,
            di.source_name,
            d.team_id,
            d.project_id,
            d.archived_at
        from dataset_items di
        inner join datasets d on di.dataset_id = d.id
        where di.id = $1 and d.team_id = $2 and d.project_id = $3
        limit 1`,
        [itemId, teamId, projectId],
    );
    const existing = result.rows[0];
    if (!existing) {
        throw new ApiNotFoundError("Dataset item not found");
    }
    if (existing.archived_at != null) {
        throw new ApiConflictError(
            "This dataset is archived. Restore it to make changes.",
        );
    }
    return existing;
}

function parseLabelForDatasetMutation(
    context: IImportDatasetContext,
    rawLabel: string,
    options: { mode: "create" | "update" },
): IFormLabelResult {
    const labelProvided =
        context.dataset.purpose !== "evaluation" || hasFreeformOutput(rawLabel);
    if (!labelProvided) {
        return options.mode === "update" ? { clearLabel: true } : {};
    }

    const parsed = parseJsonObject(rawLabel);
    const schema = context.answerSchema ?? {
        fields: [],
        additionalProperties: true,
    };
    const failures = [
        ...validateImportLabel(parsed, schema),
        ...(context.dataset.modality === "audio"
            ? validateAudioReferenceLabel(parsed)
            : []),
    ];
    if (failures.length > 0) {
        throw new ApiBadRequestError(failures.join("; "));
    }
    return { label: parsed };
}

function hasFreeformOutput(rawLabel: string): boolean {
    const trimmed = rawLabel.trim();
    if (!trimmed || trimmed === "{}") return false;
    return true;
}

function parseJsonObject(raw: string): LabelJson {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (!isRecord(parsed)) throw new ApiBadRequestError("Expected object");
        return parsed;
    } catch {
        throw new ApiBadRequestError("Expected output must be valid JSON.");
    }
}

function decodeImportImages(images: IApiImageImportFile[]): IImportImageFile[] {
    return images.map(decodeImportImage);
}

function decodeImportAudioFiles(
    audio: IApiAudioImportFile[],
): IImportAudioFile[] {
    // Enforce count and cumulative-byte budget before decoding base64 so a
    // large payload cannot allocate gigabytes before partitionMediaImportFiles
    // rejects it.
    if (audio.length > MAX_IMPORT_FILE_COUNT) {
        throw new ApiBadRequestError(
            `Audio import is limited to ${MAX_IMPORT_FILE_COUNT} files.`,
        );
    }
    let estimatedTotalBytes = 0;
    const files: IImportAudioFile[] = [];
    for (const entry of audio) {
        // Direct-upload entries carry no base64 bytes; budget against the
        // client-reported size instead (server re-checks Content-Length later).
        const estimatedBytes = entry.storageKey
            ? entry.size
            : Math.ceil(
                  ((entry.base64Data ?? "").replace(/\s/g, "").length * 3) / 4,
              );
        estimatedTotalBytes += estimatedBytes;
        if (estimatedTotalBytes > MAX_AUDIO_IMPORT_BYTES) {
            throw new ApiBadRequestError(
                `Audio import exceeds the ${formatBytes(MAX_AUDIO_IMPORT_BYTES)} payload limit.`,
            );
        }
        files.push(decodeImportAudio(entry));
    }
    return files;
}

function decodeImportImage(image: IApiImageImportFile): IImportImageFile {
    if (image.storageKey) {
        return {
            name: image.name,
            mimeType: image.mimeType,
            size: image.size,
            storageKey: image.storageKey,
        };
    }
    const bytes = decodeBase64File(image.base64Data ?? "", MAX_IMAGE_BYTES);
    return {
        name: image.name,
        mimeType: image.mimeType,
        size: bytes.byteLength,
        bytes,
        reportedSize: image.size,
    };
}

function decodeImportAudio(audio: IApiAudioImportFile): IImportAudioFile {
    if (audio.storageKey) {
        return {
            name: audio.name,
            mimeType: audio.mimeType,
            size: audio.size,
            storageKey: audio.storageKey,
        };
    }
    const bytes = decodeBase64File(audio.base64Data ?? "", MAX_AUDIO_BYTES);
    return {
        name: audio.name,
        mimeType: audio.mimeType,
        size: bytes.byteLength,
        bytes,
    };
}

function decodeBase64File(base64Data: string, maxBytes: number): Buffer {
    const normalized = base64Data.replace(/\s/g, "");
    if (Math.ceil((normalized.length * 3) / 4) > maxBytes) {
        throw new ApiBadRequestError(
            `File exceeds the ${formatBytes(maxBytes)} per-file limit.`,
        );
    }
    const bytes = Buffer.from(normalized, "base64");
    if (bytes.byteLength > maxBytes) {
        throw new ApiBadRequestError(
            `File exceeds the ${formatBytes(maxBytes)} per-file limit.`,
        );
    }
    return bytes;
}

function assertSingleImageFile(file: IImportImageFile): void {
    const reason = imageFileFailure(file);
    if (reason) throw new ApiBadRequestError(reason);
}

function assertSingleAudioFile(file: IImportAudioFile): void {
    const reason = audioFileFailure(file);
    if (reason) throw new ApiBadRequestError(reason);
}

function datasetItemTypeForMedia(
    hasText: boolean,
    hasMedia: boolean,
    mediaType: "audio" | "image" | undefined,
): "audio" | "image" | "mixed" | "text" {
    if (!hasMedia) return "text";
    if (hasText) return "mixed";
    if (mediaType) return mediaType;
    throw new ApiBadRequestError("Media item is missing a media type.");
}

function mediaKindFromStoredItem(
    mimeType: string | null,
    itemType: "audio" | "image" | "mixed" | "text",
): "audio" | "image" | undefined {
    if (mimeType?.startsWith("audio/")) return "audio";
    if (itemType === "audio" || itemType === "image") return itemType;
    if (mimeType) return "image";
    return undefined;
}

async function importImageFiles(
    db: IDb,
    config: IApiConfig,
    teamId: string,
    projectId: string,
    datasetId: string,
    files: IImportImageFile[],
): Promise<IImportSummary> {
    return importMediaFiles(db, config, {
        teamId,
        projectId,
        datasetId,
        files,
        mediaKind: "image",
        validateFiles: validateImageImportFiles,
        fileFailure: imageFileFailure,
    });
}

async function createImageImportItem(
    db: IDb,
    config: IApiConfig,
    teamId: string,
    projectId: string,
    datasetId: string,
    file: IImportImageFile,
    label?: LabelJson,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    return createMediaImportItem(db, config, {
        teamId,
        projectId,
        datasetId,
        file,
        mediaKind: "image",
        ...(label !== undefined ? { label } : {}),
    });
}

async function createAudioImportItem(
    db: IDb,
    config: IApiConfig,
    teamId: string,
    projectId: string,
    datasetId: string,
    file: IImportAudioFile,
    label?: LabelJson,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    return createMediaImportItem(db, config, {
        teamId,
        projectId,
        datasetId,
        file,
        mediaKind: "audio",
        ...(label !== undefined ? { label } : {}),
    });
}

async function importAudioFiles(
    db: IDb,
    config: IApiConfig,
    teamId: string,
    projectId: string,
    datasetId: string,
    files: IImportAudioFile[],
): Promise<IImportSummary> {
    return importMediaFiles(db, config, {
        teamId,
        projectId,
        datasetId,
        files,
        mediaKind: "audio",
        validateFiles: validateAudioImportFiles,
        fileFailure: audioFileFailure,
    });
}

async function importMediaFiles<TFile extends IImportMediaFile>(
    db: IDb,
    config: IApiConfig,
    input: {
        teamId: string;
        projectId: string;
        datasetId: string;
        files: TFile[];
        mediaKind: "audio" | "image";
        validateFiles: (files: TFile[]) => IImportSummary;
        fileFailure: (file: TFile) => string | undefined;
    },
): Promise<IImportSummary> {
    const validation = input.validateFiles(input.files);
    if (validation.rejected) return validation;

    const failures = [...validation.failures];
    const seenValidNames = new Set<string>();
    let importedCount = 0;
    for (const file of input.files) {
        if (input.fileFailure(file) || seenValidNames.has(file.name)) continue;
        seenValidNames.add(file.name);
        const result = await createMediaImportItem(db, config, {
            teamId: input.teamId,
            projectId: input.projectId,
            datasetId: input.datasetId,
            file,
            mediaKind: input.mediaKind,
        });
        if (result.ok) importedCount++;
        else failures.push({ fileName: file.name, reason: result.reason });
    }
    return { importedCount, failures };
}

async function createMediaImportItem(
    db: IDb,
    config: IApiConfig,
    input: {
        teamId: string;
        projectId: string;
        datasetId: string;
        file: IImportMediaFile;
        mediaKind: "audio" | "image";
        label?: LabelJson;
    },
): Promise<{ ok: true } | { ok: false; reason: string }> {
    const maxBytes =
        input.mediaKind === "audio" ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;

    // Direct-upload path: verify the client-uploaded object, then insert without
    // re-uploading. Verify failures (missing/oversize) become per-file failures.
    if (input.file.storageKey) {
        const storageKey = input.file.storageKey;
        try {
            // FIX 4: bind the consumed key to this dataset (image/audio/paired/
            // answers bulk imports all funnel through here with input.datasetId).
            assertStorageKeyForDataset(storageKey, input.datasetId);
            const size = await verifyStorageObject(config, storageKey);
            assertVerifiedSizeWithinCap(size, maxBytes);
            await assertStorageObjectMatchesType(
                config,
                storageKey,
                input.file.mimeType,
            );
        } catch (err) {
            return { ok: false, reason: importFailureReason(err) };
        }
        try {
            await insertMediaImportItem(db, input, storageKey);
            return { ok: true };
        } catch (err) {
            // R7/KTD6: the client uploaded this object but the row insert
            // failed — best-effort delete so the import does not leak storage.
            await deleteMediaFromStorage(config, storageKey).catch(() => {});
            return { ok: false, reason: importFailureReason(err) };
        }
    }

    // Legacy path: upload the decoded bytes ourselves, clean up on failure.
    const storageKey = randomUUID();
    try {
        if (!input.file.bytes) {
            throw new ApiBadRequestError("Media item is missing upload data.");
        }
        await uploadMediaToStorage(
            config,
            storageKey,
            input.file.bytes,
            input.file.mimeType,
        );
        await insertMediaImportItem(db, input, storageKey);
        return { ok: true };
    } catch (err) {
        await deleteMediaFromStorage(config, storageKey).catch(() => {});
        return { ok: false, reason: importFailureReason(err) };
    }
}

async function insertMediaImportItem(
    db: IDb,
    input: {
        teamId: string;
        projectId: string;
        datasetId: string;
        file: IImportMediaFile;
        mediaKind: "audio" | "image";
        label?: LabelJson;
    },
    storageKey: string,
): Promise<void> {
    const media = {
        storageKey,
        mimeType: input.file.mimeType,
        sourceName: input.file.name,
    };
    await createDatasetItemPayload(db, {
        teamId: input.teamId,
        projectId: input.projectId,
        datasetId: input.datasetId,
        inputText: "",
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.mediaKind === "audio" ? { audio: media } : { image: media }),
    });
}

/**
 * KTD5/R4: verify a pre-uploaded object exists and read its size instead of
 * re-uploading base64. Returns the object's byte size (Content-Length) when
 * available so callers can enforce per-file caps as defense-in-depth (R-D).
 * Verification failures map to {@link ApiBadRequestError} (400), never a 500.
 */
async function verifyStorageObject(
    config: IApiConfig,
    storageKey: string,
): Promise<number> {
    assertStorageKey(storageKey);
    if (config.storageAdapter === "local") {
        // U8: best-effort existence check against the same local object store
        // uploadMediaToStorage's local branch writes to.
        try {
            const stat = await fs.stat(localMediaPath(storageKey));
            return stat.size;
        } catch {
            throw new ApiBadRequestError(
                "Uploaded object not found. Re-upload the file and try again.",
            );
        }
    }

    if (config.storageAdapter === "r2") {
        try {
            return (await headR2Object(config.r2Storage!, storageKey)).byteSize;
        } catch (error) {
            if (isR2ObjectNotFound(error)) {
                throw new ApiBadRequestError(
                    "Uploaded object not found. Re-upload the file and try again.",
                );
            }
            const status = (error as { status?: number }).status;
            throw new ApiBadRequestError(
                `Uploaded object could not be verified${status ? ` (status ${status})` : ""}.`,
            );
        }
    }

    const response = await fetchWithTimeout(
        supabaseObjectUrl(config, storageKey),
        {
            method: "HEAD",
            headers: {
                apikey: config.supabaseServiceRoleKey,
                Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
            },
        },
    );
    if (response.status === 404) {
        throw new ApiBadRequestError(
            "Uploaded object not found. Re-upload the file and try again.",
        );
    }
    if (!response.ok) {
        throw new ApiBadRequestError(
            `Uploaded object could not be verified (status ${response.status}).`,
        );
    }
    const header = response.headers?.get?.("content-length");
    const size = header != null ? Number(header) : undefined;
    if (size === undefined || !Number.isFinite(size)) {
        // Fail closed: without a parseable Content-Length we cannot confirm the
        // object's size, so we cannot enforce the per-file cap. Reject instead
        // of silently skipping the check.
        throw new ApiBadRequestError(
            "Uploaded object size could not be verified. Re-upload the file and try again.",
        );
    }
    return size;
}

/**
 * The declared MIME type of a direct upload comes from the browser. Read the
 * object's first bytes and confirm they carry that format's signature, so a
 * file cannot be stored under a media type it is not.
 */
async function assertStorageObjectMatchesType(
    config: IApiConfig,
    storageKey: string,
    mimeType: string,
): Promise<void> {
    const head = await readStorageObjectHead(config, storageKey);
    if (!mediaBytesMatchType(head, mimeType)) {
        throw new ApiBadRequestError(
            `Uploaded file content does not match its declared type "${mimeType}". Re-upload the file and try again.`,
        );
    }
}

async function readStorageObjectHead(
    config: IApiConfig,
    storageKey: string,
): Promise<Uint8Array> {
    assertStorageKey(storageKey);
    if (config.storageAdapter === "local") {
        let handle: fs.FileHandle | undefined;
        try {
            handle = await fs.open(localMediaPath(storageKey), "r");
            const buffer = Buffer.alloc(MEDIA_SNIFF_BYTES);
            const { bytesRead } = await handle.read(
                buffer,
                0,
                MEDIA_SNIFF_BYTES,
                0,
            );
            return buffer.subarray(0, bytesRead);
        } catch {
            throw new ApiBadRequestError(
                "Uploaded object not found. Re-upload the file and try again.",
            );
        } finally {
            await handle?.close();
        }
    }

    if (config.storageAdapter === "r2") {
        try {
            return await getR2ObjectPrefix(
                config.r2Storage!,
                storageKey,
                MEDIA_SNIFF_BYTES,
            );
        } catch (error) {
            if (isR2ObjectNotFound(error)) {
                throw new ApiBadRequestError(
                    "Uploaded object not found. Re-upload the file and try again.",
                );
            }
            const status = (error as { status?: number }).status;
            throw new ApiBadRequestError(
                `Uploaded object content could not be verified${status ? ` (status ${status})` : ""}.`,
            );
        }
    }

    // Unlike fetchWithTimeout, keep the timer running until the body has been
    // read, so a stalled body cannot hang the verify step.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        const response = await fetch(supabaseObjectUrl(config, storageKey), {
            method: "GET",
            headers: {
                apikey: config.supabaseServiceRoleKey,
                Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
                Range: `bytes=0-${MEDIA_SNIFF_BYTES - 1}`,
            },
            signal: controller.signal,
        });
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            throw new ApiBadRequestError(
                `Uploaded object content could not be verified (status ${response.status}).`,
            );
        }
        return await readPrefix(response, MEDIA_SNIFF_BYTES);
    } finally {
        clearTimeout(timeout);
    }
}

/** Read at most `limit` bytes, then stop (the server may ignore Range). */
async function readPrefix(
    response: Response,
    limit: number,
): Promise<Uint8Array> {
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (total < limit) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            total += value.byteLength;
        }
    } finally {
        await reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks).subarray(0, limit);
}

function assertVerifiedSizeWithinCap(size: number, maxBytes: number): void {
    if (size <= 0) {
        // Reject 0-byte (or otherwise empty) objects — they would create an
        // empty-media item.
        throw new ApiBadRequestError(
            "Uploaded object is empty. Re-upload the file and try again.",
        );
    }
    if (size > maxBytes) {
        throw new ApiBadRequestError(
            `File exceeds the ${formatBytes(maxBytes)} per-file limit.`,
        );
    }
}

/**
 * Resolve a decoded media file to a storage key. Direct-upload files are
 * verified in place (no re-upload); legacy base64 files are uploaded. Returns
 * the storage key the item should reference.
 */
async function persistDecodedMedia(
    config: IApiConfig,
    file: IImportMediaFile,
    maxBytes: number,
): Promise<string> {
    if (file.storageKey) {
        const size = await verifyStorageObject(config, file.storageKey);
        assertVerifiedSizeWithinCap(size, maxBytes);
        await assertStorageObjectMatchesType(
            config,
            file.storageKey,
            file.mimeType,
        );
        return file.storageKey;
    }
    if (!file.bytes) {
        throw new ApiBadRequestError("Media item is missing upload data.");
    }
    const storageKey = randomUUID();
    await uploadMediaToStorage(config, storageKey, file.bytes, file.mimeType);
    return storageKey;
}

async function uploadMediaToStorage(
    config: IApiConfig,
    storageKey: string,
    bytes: Buffer,
    mimeType: string,
): Promise<void> {
    assertStorageKey(storageKey);
    if (config.storageAdapter === "local") {
        const filePath = localMediaPath(storageKey);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, bytes);
        return;
    }

    if (config.storageAdapter === "r2") {
        try {
            await putR2Object(config.r2Storage!, storageKey, bytes, mimeType);
            return;
        } catch (error) {
            const status = (error as { status?: number }).status;
            throw new ApiBadRequestError(
                `R2 Storage upload failed${status ? ` with ${status}` : ""}`,
            );
        }
    }

    const response = await fetchWithTimeout(
        supabaseObjectUrl(config, storageKey),
        {
            method: "POST",
            headers: {
                apikey: config.supabaseServiceRoleKey,
                Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
                "Content-Type": mimeType,
                "x-upsert": "false",
            },
            body: new Uint8Array(bytes),
        },
    );
    if (!response.ok) {
        throw new ApiBadRequestError(
            `Supabase Storage upload failed with ${response.status}`,
        );
    }
}

/**
 * U8: write browser-uploaded bytes to the local object store under the `local`
 * storage adapter. This is the sink for `PUT /api/datasets/upload/local/*`,
 * which the browser calls directly (like a signed URL) with no internal token.
 * Path confinement: {@link assertStorageKey}/{@link localMediaPath} reject any
 * key that is not a legacy or dataset-scoped key, so `..` / traversal and
 * out-of-root writes are impossible. The body is streamed to a temp file and
 * aborted once it passes `maxBytes`, so it is never buffered in memory.
 */
export async function writeLocalUpload(
    config: IApiConfig,
    storageKey: string,
    request: Pick<Request, "body" | "headers">,
    maxBytes: number = MAX_LOCAL_UPLOAD_BYTES,
): Promise<void> {
    if (config.storageAdapter !== "local") {
        // The endpoint only exists to serve the local adapter; refuse otherwise
        // rather than writing bytes that no read path would ever serve.
        throw new ApiNotFoundError("Local upload endpoint is not enabled.");
    }
    assertStorageKey(storageKey);
    const tooLarge = () =>
        new ApiPayloadTooLargeError(
            `File exceeds the ${formatBytes(maxBytes)} per-file limit.`,
        );
    if (Number(request.headers.get("content-length") ?? 0) > maxBytes) {
        throw tooLarge();
    }

    const filePath = localMediaPath(storageKey);
    const tempPath = `${filePath}.${randomUUID()}.part`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let received = 0;
    const limit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            received += chunk.byteLength;
            callback(received > maxBytes ? tooLarge() : null, chunk);
        },
    });
    try {
        await pipeline(
            request.body
                ? Readable.fromWeb(request.body as NodeReadableStream)
                : Readable.from([]),
            limit,
            createWriteStream(tempPath),
        );
        await fs.rename(tempPath, filePath);
    } catch (err) {
        await fs.rm(tempPath, { force: true });
        throw err;
    }
}

function apiPublicBaseUrl(config: IApiConfig): string {
    return (config.apiPublicUrl ?? `http://localhost:${config.port}`).replace(
        /\/+$/,
        "",
    );
}

function supabaseObjectUrl(config: IApiConfig, storageKey: string): string {
    const objectPath = config.supabaseStoragePrefix
        ? `${config.supabaseStoragePrefix}/${storageKey}`
        : storageKey;
    return `${supabaseBucketUrl(config)}/${encodeObjectPath(objectPath)}`;
}

function encodeObjectPath(objectPath: string): string {
    return objectPath.split("/").map(encodeURIComponent).join("/");
}

async function createSignedUploadTarget(
    config: IApiConfig,
    storageKey: string,
    contentType: string,
    byteSize: number,
): Promise<ISignedUploadTarget> {
    if (config.storageAdapter === "local") {
        // U8: local adapter parity. The browser PUTs bytes straight to the API's
        // local-upload endpoint, which writes to the same on-disk object store
        // `uploadMediaToStorage`'s local branch and `verifyStorageObject` use.
        // The URL is absolute (API origin) so the browser reaches the API
        // directly, exactly like a Supabase signed upload URL.
        return {
            storageKey,
            signedUrl: `${apiPublicBaseUrl(config)}/api/datasets/upload/local/${encodeObjectPath(storageKey)}`,
        };
    }

    if (config.storageAdapter === "r2") {
        const signedUrl = await createR2SignedUploadUrl(
            config.r2Storage!,
            storageKey,
            contentType,
            { contentLength: byteSize },
        ).catch((error: unknown) => {
            const status = (error as { status?: number }).status;
            throw new ApiBadRequestError(
                `R2 signed upload URL request failed${status ? ` (${status})` : ""}`,
            );
        });
        return {
            storageKey,
            signedUrl,
            headers: {
                [R2_CREATE_ONLY_UPLOAD_HEADER]: R2_CREATE_ONLY_UPLOAD_VALUE,
            },
            expiresAt: new Date(
                Date.now() + R2_UPLOAD_URL_TTL_SECONDS * 1_000,
            ).toISOString(),
        };
    }

    const signUrl = supabaseSignUploadUrl(config, storageKey);
    const response = await fetchWithTimeout(signUrl, {
        method: "POST",
        headers: {
            apikey: config.supabaseServiceRoleKey,
            Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
            "Content-Type": "application/json",
        },
        // Supabase rejects a POST with `Content-Type: application/json` and an
        // empty body ("Body cannot be empty ..."), so send an empty JSON object.
        body: "{}",
    });
    if (!response.ok) {
        throw new ApiBadRequestError(
            `Supabase signed upload URL request failed with ${response.status}`,
        );
    }
    const body = (await response.json().catch(() => undefined)) as
        { token?: string } | undefined;
    if (!body?.token) {
        throw new ApiBadRequestError(
            "Supabase did not return a signed upload token.",
        );
    }
    return {
        storageKey,
        signedUrl: `${signUrl}?token=${encodeURIComponent(body.token)}`,
    };
}

function supabaseSignUploadUrl(config: IApiConfig, storageKey: string): string {
    const objectPath = config.supabaseStoragePrefix
        ? `${config.supabaseStoragePrefix}/${storageKey}`
        : storageKey;
    const bucket = encodeURIComponent(config.supabaseStorageBucket);
    const base = config.supabaseUrl.replace(/\/+$/, "");
    return `${base}/storage/v1/object/upload/sign/${bucket}/${encodeObjectPath(objectPath)}`;
}

function uploadFileExtension(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    // Bound the extension to what DATASET_SCOPED_STORAGE_KEY accepts
    // (`[A-Za-z0-9]{1,16}`); a longer extension would mint a key that later
    // fails assertStorageKey at verify time, leaking the uploaded object.
    return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : "";
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const MAX_IMPORT_FILE_COUNT = 100;
const MAX_TEXT_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_ROWS = 1_000;
const MAX_JSONL_LINE_BYTES = 64 * 1024;
const MAX_IMAGE_IMPORT_BYTES = 24 * 1024 * 1024;
const MAX_AUDIO_IMPORT_BYTES = 250 * 1024 * 1024;
const RESERVED_LABEL_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const UPLOAD_MODALITY_CAPS: Record<
    ICreateSignedUploadRequest["modality"],
    { perFile: number; batch: number; label: string }
> = {
    image: {
        perFile: MAX_IMAGE_BYTES,
        batch: MAX_IMAGE_IMPORT_BYTES,
        label: "Image",
    },
    audio: {
        perFile: MAX_AUDIO_BYTES,
        batch: MAX_AUDIO_IMPORT_BYTES,
        label: "Audio",
    },
};

// The local PUT sink cannot tell which modality a key was signed for, so it
// enforces the largest per-file cap.
const MAX_LOCAL_UPLOAD_BYTES = Math.max(
    ...Object.values(UPLOAD_MODALITY_CAPS).map((caps) => caps.perFile),
);

function rejectedImport(reason: string): IImportSummary {
    return { importedCount: 0, failures: [{ reason }], rejected: true };
}

function formatBytes(bytes: number): string {
    return `${Math.round(bytes / (1024 * 1024))}MB`;
}

function imageFileFailure(file: IImportImageFile): string | undefined {
    if (file.name.trim() === "") return "Image filename is required.";
    if (file.reportedSize !== undefined && file.reportedSize !== file.size) {
        return "Image size does not match the uploaded bytes.";
    }
    if (file.size > MAX_IMAGE_BYTES) {
        return `Image exceeds the ${formatBytes(MAX_IMAGE_BYTES)} per-file limit.`;
    }
    if (!CONTRACT_ALLOWED_IMAGE_TYPES.includes(file.mimeType)) {
        return `Unsupported image type: ${file.mimeType || "unknown"}.`;
    }
    return undefined;
}

function audioFileFailure(file: IImportAudioFile): string | undefined {
    if (file.name.trim() === "") return "Audio filename is required.";
    if (file.size > MAX_AUDIO_BYTES) {
        return `Audio exceeds the ${formatBytes(MAX_AUDIO_BYTES)} per-file limit.`;
    }
    if (!CONTRACT_ALLOWED_AUDIO_TYPES.includes(file.mimeType)) {
        return `Unsupported audio type: ${file.mimeType || "unknown"}.`;
    }
    return undefined;
}

function validateImageImportFiles(files: IImportImageFile[]): IImportSummary {
    return partitionMediaImportFiles(files, {
        label: "Image",
        maxPayloadBytes: MAX_IMAGE_IMPORT_BYTES,
        fileFailure: imageFileFailure,
    }).summary;
}

function validateAudioImportFiles(files: IImportAudioFile[]): IImportSummary {
    return partitionMediaImportFiles(files, {
        label: "Audio",
        maxPayloadBytes: MAX_AUDIO_IMPORT_BYTES,
        fileFailure: audioFileFailure,
    }).summary;
}

function partitionImageImportFiles(files: IImportImageFile[]): {
    summary: IImportSummary;
    uniqueValidNames: string[];
} {
    return partitionMediaImportFiles(files, {
        label: "Image",
        maxPayloadBytes: MAX_IMAGE_IMPORT_BYTES,
        fileFailure: imageFileFailure,
    });
}

function partitionAudioImportFiles(files: IImportAudioFile[]): {
    summary: IImportSummary;
    uniqueValidNames: string[];
} {
    return partitionMediaImportFiles(files, {
        label: "Audio",
        maxPayloadBytes: MAX_AUDIO_IMPORT_BYTES,
        fileFailure: audioFileFailure,
    });
}

function partitionMediaImportFiles<TFile extends IImportMediaFile>(
    files: TFile[],
    options: {
        label: "Audio" | "Image";
        maxPayloadBytes: number;
        fileFailure: (file: TFile) => string | undefined;
    },
): {
    summary: IImportSummary;
    uniqueValidNames: string[];
} {
    if (files.length > MAX_IMPORT_FILE_COUNT) {
        return {
            summary: rejectedImport(
                `${options.label} import is limited to ${MAX_IMPORT_FILE_COUNT} files.`,
            ),
            uniqueValidNames: [],
        };
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > options.maxPayloadBytes) {
        return {
            summary: rejectedImport(
                `${options.label} import exceeds the ${formatBytes(options.maxPayloadBytes)} payload limit.`,
            ),
            uniqueValidNames: [],
        };
    }
    const validCounts = new Map<string, number>();
    for (const file of files) {
        if (!options.fileFailure(file)) {
            validCounts.set(file.name, (validCounts.get(file.name) ?? 0) + 1);
        }
    }
    const failures: IImportSummary["failures"] = [];
    const uniqueValidNames: string[] = [];
    const seenValidNames = new Set<string>();
    for (const file of files) {
        const reason = options.fileFailure(file);
        if (reason) {
            failures.push({ fileName: file.name, reason });
            continue;
        }
        if (seenValidNames.has(file.name)) {
            failures.push({
                fileName: file.name,
                reason: "Duplicate filename in upload.",
            });
            continue;
        }
        seenValidNames.add(file.name);
        if ((validCounts.get(file.name) ?? 0) === 1) {
            uniqueValidNames.push(file.name);
        }
    }
    return {
        summary: { importedCount: files.length - failures.length, failures },
        uniqueValidNames,
    };
}

interface IPreparedTextImport {
    rows: Array<{ inputText: string; label: LabelJson }>;
    failures: IImportSummary["failures"];
    rejected?: boolean;
}

function prepareTextImport(
    content: string,
    format: IImportTextItemsRequest["format"],
    schema: IParsedSchemaDescriptor,
): IPreparedTextImport {
    if (Buffer.byteLength(content, "utf8") > MAX_TEXT_IMPORT_BYTES) {
        return {
            rows: [],
            failures: [
                {
                    reason: `Import file exceeds the ${formatBytes(MAX_TEXT_IMPORT_BYTES)} payload limit.`,
                },
            ],
            rejected: true,
        };
    }
    return format === "jsonl"
        ? prepareJsonlImport(content, schema)
        : prepareCsvImport(content, schema);
}

function prepareJsonlImport(
    content: string,
    schema: IParsedSchemaDescriptor,
): IPreparedTextImport {
    const jsonl = parseJsonlLines(content, normalizeTextImportRow);
    if (jsonl.rejected) {
        return { rows: [], failures: jsonl.failures, rejected: true };
    }
    const rows: IPreparedTextImport["rows"] = [];
    const failures = [...jsonl.failures];
    for (const { rowNumber, row } of jsonl.rows) {
        const labelFailures = validateImportLabel(row.label, schema);
        if (labelFailures.length > 0) {
            failures.push({ row: rowNumber, reason: labelFailures.join("; ") });
        } else {
            rows.push(row);
        }
    }
    return { rows, failures };
}

function prepareCsvImport(
    content: string,
    schema: IParsedSchemaDescriptor,
): IPreparedTextImport {
    if (schema.fields.some((field) => field.type === "string[]")) {
        return {
            rows: [],
            failures: [
                {
                    reason: "CSV import does not support array fields; use JSONL.",
                },
            ],
            rejected: true,
        };
    }
    const parsed = Papa.parse<Record<string, string>>(content, {
        header: true,
        skipEmptyLines: "greedy",
    });
    if (parsed.data.length > MAX_IMPORT_ROWS) {
        return {
            rows: [],
            failures: [
                { reason: `Import is limited to ${MAX_IMPORT_ROWS} rows.` },
            ],
            rejected: true,
        };
    }
    const fieldByName = new Map(
        schema.fields.map((field) => [field.name, field]),
    );
    const failures: IImportSummary["failures"] = parsed.errors.map((error) => ({
        row: error.row === undefined ? undefined : error.row + 2,
        reason: error.message,
    }));
    const rows: IPreparedTextImport["rows"] = [];
    parsed.data.forEach((row, index) => {
        if (!row.inputText?.trim()) {
            failures.push({
                row: index + 2,
                reason: "Each text row needs a non-empty inputText column.",
            });
            return;
        }
        const label: LabelJson = {};
        for (const [key, value] of Object.entries(row)) {
            if (key === "inputText") continue;
            const trimmed = String(value ?? "").trim();
            if (trimmed === "") continue;
            const field = fieldByName.get(key);
            label[key] =
                field?.type === "number" && Number.isFinite(Number(trimmed))
                    ? Number(trimmed)
                    : trimmed;
        }
        const labelFailures = validateImportLabel(label, schema);
        if (labelFailures.length > 0) {
            failures.push({ row: index + 2, reason: labelFailures.join("; ") });
        } else {
            rows.push({ inputText: String(row.inputText ?? ""), label });
        }
    });
    return { rows, failures };
}

function normalizeTextImportRow(
    parsed: unknown,
):
    | { ok: true; row: { inputText: string; label: LabelJson } }
    | { ok: false; reason: string } {
    if (!isRecord(parsed))
        return { ok: false, reason: "Row must be a JSON object." };
    const inputText =
        typeof parsed.inputText === "string"
            ? parsed.inputText
            : typeof parsed.input === "string"
              ? parsed.input
              : "";
    if (!inputText.trim()) {
        return {
            ok: false,
            reason: "Each text row needs non-empty inputText.",
        };
    }
    const label = isRecord(parsed.label)
        ? parsed.label
        : Object.fromEntries(
              Object.entries(parsed).filter(
                  ([key]) => key !== "inputText" && key !== "input",
              ),
          );
    return { ok: true, row: { inputText, label } };
}

function validateImportLabel(
    label: LabelJson,
    schema: IParsedSchemaDescriptor,
): string[] {
    const errors: string[] = [];
    const fieldByName = new Map(
        schema.fields.map((field) => [field.name, field]),
    );
    for (const key of Object.keys(label)) {
        if (RESERVED_LABEL_KEYS.has(key)) {
            errors.push(`${key} is a reserved key and cannot be used.`);
        }
    }
    for (const field of schema.fields) {
        if (
            field.required &&
            (!Object.prototype.hasOwnProperty.call(label, field.name) ||
                label[field.name] === undefined)
        ) {
            errors.push(`${field.name} is required.`);
            continue;
        }
        if (
            Object.prototype.hasOwnProperty.call(label, field.name) &&
            label[field.name] !== undefined &&
            !matchesSchemaFieldType(label[field.name], field.type)
        ) {
            errors.push(
                `${field.name} must be ${formatFieldType(field.type)}.`,
            );
        }
    }
    if (!schema.additionalProperties) {
        for (const key of Object.keys(label)) {
            if (!fieldByName.has(key)) {
                errors.push(`${key} is not defined in the dataset schema.`);
            }
        }
    }
    return errors;
}

function validateAudioReferenceLabel(label: LabelJson): string[] {
    const source = isRecord(label.stt) ? label.stt : label;
    const errors: string[] = [];
    const referenceKind = stringValue(source.referenceKind);
    if (referenceKind && !isAudioReferenceKind(referenceKind)) {
        errors.push(
            "referenceKind must be one of human_gold, silver, or prod_reference.",
        );
    }
    if (
        source.expectedSpeakerTurns !== undefined &&
        !speakerTurnsValue(source.expectedSpeakerTurns)
    ) {
        errors.push(
            "expectedSpeakerTurns must contain speaker/text objects with optional numeric startMs/endMs.",
        );
    }
    if (
        source.domainTerms !== undefined &&
        !stringArrayValue(source.domainTerms)
    ) {
        errors.push("domainTerms must be an array of non-empty strings.");
    }
    if (
        source.expectedNumbers !== undefined &&
        !numberArrayValue(source.expectedNumbers)
    ) {
        errors.push("expectedNumbers must be an array of finite numbers.");
    }
    if (
        source.latencySlaMs !== undefined &&
        numberValue(source.latencySlaMs) === undefined
    ) {
        errors.push("latencySlaMs must be a finite number.");
    }
    if (
        source.costOutlierUsd !== undefined &&
        numberValue(source.costOutlierUsd) === undefined
    ) {
        errors.push("costOutlierUsd must be a finite number.");
    }
    return errors;
}

function isAudioReferenceKind(value: string | undefined): boolean {
    return (
        value === "human_gold" ||
        value === "silver" ||
        value === "prod_reference"
    );
}

function speakerTurnsValue(value: unknown): unknown[] | undefined {
    if (!Array.isArray(value)) return undefined;
    for (const item of value) {
        if (!isRecord(item)) return undefined;
        if (!stringValue(item.speaker) || !stringValue(item.text))
            return undefined;
        if (
            item.startMs !== undefined &&
            numberValue(item.startMs) === undefined
        ) {
            return undefined;
        }
        if (item.endMs !== undefined && numberValue(item.endMs) === undefined) {
            return undefined;
        }
    }
    return value;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const strings = value
        .map((item) => stringValue(item))
        .filter((item): item is string => item !== undefined);
    return strings.length === value.length && strings.length > 0
        ? strings
        : undefined;
}

function numberArrayValue(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const numbers = value
        .map((item) => numberValue(item))
        .filter((item): item is number => item !== undefined);
    return numbers.length === value.length && numbers.length > 0
        ? numbers
        : undefined;
}

function matchesSchemaFieldType(
    value: unknown,
    type: SchemaFieldType,
): boolean {
    if (type === "string") return typeof value === "string";
    if (type === "number")
        return typeof value === "number" && Number.isFinite(value);
    return (
        Array.isArray(value) && value.every((item) => typeof item === "string")
    );
}

function formatFieldType(type: SchemaFieldType): string {
    if (type === "string") return "text";
    if (type === "number") return "a number";
    return "a list of text values";
}

function parseJsonlLines<TRow>(
    content: string,
    normalize: (
        parsed: unknown,
    ) => { ok: true; row: TRow } | { ok: false; reason: string },
): {
    rows: Array<{ rowNumber: number; row: TRow }>;
    failures: IImportSummary["failures"];
    rejected?: boolean;
} {
    const numbered = content
        .split(/\r?\n/)
        .map((line, index) => ({ line, lineNo: index + 1 }))
        .filter((entry) => entry.line.trim().length > 0);
    if (numbered.length > MAX_IMPORT_ROWS) {
        return {
            rows: [],
            failures: [
                { reason: `Import is limited to ${MAX_IMPORT_ROWS} rows.` },
            ],
            rejected: true,
        };
    }
    const rows: Array<{ rowNumber: number; row: TRow }> = [];
    const failures: IImportSummary["failures"] = [];
    for (const { line, lineNo } of numbered) {
        if (Buffer.byteLength(line, "utf8") > MAX_JSONL_LINE_BYTES) {
            failures.push({
                row: lineNo,
                reason: `Line exceeds the ${formatBytes(MAX_JSONL_LINE_BYTES)} JSONL line limit.`,
            });
            continue;
        }
        try {
            const normalized = normalize(JSON.parse(line) as unknown);
            if (normalized.ok)
                rows.push({ rowNumber: lineNo, row: normalized.row });
            else failures.push({ row: lineNo, reason: normalized.reason });
        } catch (err) {
            failures.push({ row: lineNo, reason: importFailureReason(err) });
        }
    }
    return { rows, failures };
}

interface IGoldenItemRef {
    itemId: string;
    matchKeys: string[];
}

function prepareGoldenAnswersForItems(
    items: IGoldenItemRef[],
    content: string,
): {
    pairs: Array<{ itemId: string; label: LabelJson }>;
    failures: IImportSummary["failures"];
    rejected?: boolean;
} {
    const parsedRows = parseGoldenAnswersPayload(content);
    if (parsedRows.rejected)
        return { pairs: [], failures: parsedRows.failures, rejected: true };
    // Prefer more specific keys (earlier in matchKeys: id > input_text >
    // source_name). Never let a lower-priority key silently clobber a higher-
    // priority claim from another item. Priority is position-based so a
    // trailing source_name never outranks another item's input_text.
    const keyToItem = new Map<string, string>();
    const keyPriority = new Map<string, number>();
    for (const item of items) {
        item.matchKeys.forEach((key, index) => {
            if (!key) return;
            // Higher number = more specific (index 0 is id).
            const priority = 1000 - index;
            const existingPriority = keyPriority.get(key);
            if (existingPriority === undefined || priority > existingPriority) {
                keyToItem.set(key, item.itemId);
                keyPriority.set(key, priority);
            }
        });
    }
    const pairs: Array<{ itemId: string; label: LabelJson }> = [];
    const failures = [...parsedRows.failures];
    const seenKeys = new Set<string>();
    const matched = new Set<string>();
    for (const row of parsedRows.rows) {
        if (!row.key) {
            failures.push({
                row: row.rowNumber,
                reason: "Missing key (use key, itemId, or filename).",
            });
            continue;
        }
        if (seenKeys.has(row.key)) {
            failures.push({
                row: row.rowNumber,
                reason: `Duplicate key "${row.key}".`,
            });
            continue;
        }
        seenKeys.add(row.key);
        if (!isRecord(row.label)) {
            failures.push({
                row: row.rowNumber,
                reason: "Golden answer must be a JSON object.",
            });
            continue;
        }
        const itemId = keyToItem.get(row.key);
        if (!itemId) {
            failures.push({
                row: row.rowNumber,
                reason: `No dataset item matches key "${row.key}".`,
            });
            continue;
        }
        if (matched.has(itemId)) {
            failures.push({
                row: row.rowNumber,
                reason: `Item already matched by an earlier row (key "${row.key}").`,
            });
            continue;
        }
        pairs.push({ itemId, label: row.label });
        matched.add(itemId);
    }
    for (const item of items) {
        if (!matched.has(item.itemId)) {
            failures.push({
                fileName: item.matchKeys[0] ?? item.itemId,
                reason: "No golden answer row references this item.",
            });
        }
    }
    return { pairs, failures };
}

function prepareGoldenAnswersByKey(
    requiredKeys: string[],
    content: string,
    keyLabel = "filename",
    mediaLabel = "image",
): {
    pairs: Array<{ key: string; label: LabelJson }>;
    failures: IImportSummary["failures"];
    rejected?: boolean;
} {
    const parsedRows = parseGoldenAnswersPayload(content);
    if (parsedRows.rejected)
        return { pairs: [], failures: parsedRows.failures, rejected: true };
    const required = new Set(requiredKeys);
    const pairs: Array<{ key: string; label: LabelJson }> = [];
    const failures = [...parsedRows.failures];
    const seenKeys = new Set<string>();
    const matched = new Set<string>();
    for (const row of parsedRows.rows) {
        if (!row.key) {
            failures.push({
                row: row.rowNumber,
                reason: `Missing ${keyLabel} (use filename, key, or id).`,
            });
            continue;
        }
        if (seenKeys.has(row.key)) {
            failures.push({
                row: row.rowNumber,
                reason: `Duplicate ${keyLabel} "${row.key}".`,
            });
            continue;
        }
        seenKeys.add(row.key);
        if (!isRecord(row.label)) {
            failures.push({
                row: row.rowNumber,
                reason: "Golden answer must be a JSON object.",
            });
            continue;
        }
        if (!required.has(row.key)) {
            failures.push({
                row: row.rowNumber,
                reason: `No uploaded ${mediaLabel} matches ${keyLabel} "${row.key}".`,
            });
            continue;
        }
        pairs.push({ key: row.key, label: row.label });
        matched.add(row.key);
    }
    for (const key of requiredKeys) {
        if (!matched.has(key)) {
            failures.push({
                fileName: key,
                reason: `No golden answer row references this ${mediaLabel}.`,
            });
        }
    }
    return { pairs, failures };
}

function parseGoldenAnswersPayload(content: string): {
    rows: Array<{ rowNumber?: number; key: string; label: unknown }>;
    failures: IImportSummary["failures"];
    rejected?: boolean;
} {
    if (Buffer.byteLength(content, "utf8") > MAX_TEXT_IMPORT_BYTES) {
        return {
            rows: [],
            failures: [
                {
                    reason: `Import file exceeds the ${formatBytes(MAX_TEXT_IMPORT_BYTES)} payload limit.`,
                },
            ],
            rejected: true,
        };
    }
    const trimmed = content.trim();
    if (!trimmed) {
        return {
            rows: [],
            failures: [{ reason: "Golden answers file is empty." }],
            rejected: true,
        };
    }
    if (trimmed.startsWith("[")) {
        try {
            const array = JSON.parse(trimmed) as unknown;
            if (!Array.isArray(array)) {
                return {
                    rows: [],
                    failures: [{ reason: "Golden answers array is invalid." }],
                    rejected: true,
                };
            }
            if (array.length > MAX_IMPORT_ROWS) {
                return {
                    rows: [],
                    failures: [
                        {
                            reason: `Import is limited to ${MAX_IMPORT_ROWS} rows.`,
                        },
                    ],
                    rejected: true,
                };
            }
            const rows: Array<{
                rowNumber?: number;
                key: string;
                label: unknown;
            }> = [];
            const failures: IImportSummary["failures"] = [];
            array.forEach((entry, index) => {
                const normalized = normalizeGoldenAnswerEntry(entry);
                if (normalized.ok) {
                    rows.push({ rowNumber: index + 1, ...normalized.row });
                } else {
                    failures.push({
                        row: index + 1,
                        reason: normalized.reason,
                    });
                }
            });
            return { rows, failures };
        } catch (err) {
            return {
                rows: [],
                failures: [{ reason: importFailureReason(err) }],
                rejected: true,
            };
        }
    }
    const jsonl = parseJsonlLines(trimmed, normalizeGoldenAnswerEntry);
    return {
        rows: jsonl.rows.map(({ rowNumber, row }) => ({ rowNumber, ...row })),
        failures: jsonl.failures,
        rejected: jsonl.rejected,
    };
}

function normalizeGoldenAnswerEntry(
    value: unknown,
):
    | { ok: true; row: { key: string; label: unknown } }
    | { ok: false; reason: string } {
    if (!isRecord(value))
        return { ok: false, reason: "Row must be a JSON object." };
    if ("label" in value && value.label !== undefined) {
        const key =
            typeof value.key === "string"
                ? value.key.trim()
                : typeof value.itemId === "string"
                  ? value.itemId.trim()
                  : typeof value.filename === "string"
                    ? value.filename.trim()
                    : typeof value.id === "string"
                      ? value.id.trim()
                      : "";
        return { ok: true, row: { key, label: value.label } };
    }
    const keyField = ["key", "itemId", "item_id", "filename", "id"].find(
        (key) => Object.prototype.hasOwnProperty.call(value, key),
    );
    if (!keyField)
        return {
            ok: false,
            reason: "Missing key (use key, itemId, or filename).",
        };
    const key =
        typeof value[keyField] === "string" ? value[keyField].trim() : "";
    const label = Object.fromEntries(
        Object.entries(value).filter(([entryKey]) => entryKey !== keyField),
    );
    return { ok: true, row: { key, label } };
}

interface IPairedPlan {
    items: Array<{ fileName: string; label: LabelJson }>;
    failures: IImportSummary["failures"];
    rejected?: boolean;
}

function preparePairedImport(
    fileNames: string[],
    csvContent: string,
    schema: IParsedSchemaDescriptor,
): IPairedPlan {
    if (schema.fields.some((field) => field.type === "string[]")) {
        return {
            items: [],
            failures: [
                {
                    reason: "Spreadsheet import does not support array fields; add those items individually.",
                },
            ],
            rejected: true,
        };
    }
    if (Buffer.byteLength(csvContent, "utf8") > MAX_TEXT_IMPORT_BYTES) {
        return {
            items: [],
            failures: [
                {
                    reason: `Spreadsheet exceeds the ${formatBytes(MAX_TEXT_IMPORT_BYTES)} payload limit.`,
                },
            ],
            rejected: true,
        };
    }
    const parsed = Papa.parse<Record<string, string>>(csvContent, {
        header: true,
        skipEmptyLines: "greedy",
    });
    if (!parsed.meta.fields?.includes("filename")) {
        return {
            items: [],
            failures: [
                { reason: "Spreadsheet must have a 'filename' column." },
            ],
            rejected: true,
        };
    }
    const knownFields = new Set(schema.fields.map((field) => field.name));
    const badColumns = (parsed.meta.fields ?? []).filter(
        (column) =>
            column !== "filename" &&
            (RESERVED_LABEL_KEYS.has(column) || !knownFields.has(column)),
    );
    if (badColumns.length > 0) {
        return {
            items: [],
            failures: [
                {
                    reason: `Unknown answer column(s): ${badColumns.join(", ")}. Use one column per pipeline field, plus 'filename'.`,
                },
            ],
            rejected: true,
        };
    }
    const fieldByName = new Map(
        schema.fields.map((field) => [field.name, field]),
    );
    const fileSet = new Set(fileNames);
    const seenInCsv = new Set<string>();
    const matched = new Set<string>();
    const items: IPairedPlan["items"] = [];
    const failures: IImportSummary["failures"] = parsed.errors.map((error) => ({
        row: error.row === undefined ? undefined : error.row + 2,
        reason: error.message,
    }));
    parsed.data.forEach((row, index) => {
        const rowNumber = index + 2;
        const fileName = String(row.filename ?? "").trim();
        if (!fileName) {
            failures.push({ row: rowNumber, reason: "Missing filename." });
            return;
        }
        if (seenInCsv.has(fileName)) {
            failures.push({
                row: rowNumber,
                reason: `Duplicate filename "${fileName}".`,
            });
            return;
        }
        seenInCsv.add(fileName);
        if (!fileSet.has(fileName)) {
            failures.push({
                row: rowNumber,
                reason: `No uploaded image named "${fileName}".`,
            });
            return;
        }
        const label: LabelJson = {};
        for (const [key, value] of Object.entries(row)) {
            if (key === "filename" || RESERVED_LABEL_KEYS.has(key)) continue;
            const field = fieldByName.get(key);
            if (!field) continue;
            const trimmed = String(value ?? "").trim();
            if (trimmed === "") continue;
            label[key] =
                field.type === "number" && Number.isFinite(Number(trimmed))
                    ? Number(trimmed)
                    : trimmed;
        }
        const labelFailures = validateImportLabel(label, schema);
        if (labelFailures.length > 0) {
            failures.push({ row: rowNumber, reason: labelFailures.join("; ") });
            return;
        }
        items.push({ fileName, label });
        matched.add(fileName);
    });
    for (const fileName of fileNames) {
        if (!matched.has(fileName)) {
            failures.push({
                fileName,
                reason: "No spreadsheet row references this image.",
            });
        }
    }
    return { items, failures };
}

async function upsertLabel(
    db: IDb,
    teamId: string,
    projectId: string,
    itemId: string,
    label: LabelJson,
    allowOverwrite = true,
): Promise<void> {
    const result = await db.query(
        `insert into labels (dataset_item_id, label_json)
        select $1, $2
        where exists (
            select 1 from dataset_items di
            inner join datasets d on d.id = di.dataset_id
            where di.id = $1 and d.team_id = $3 and d.project_id = $4
        )
        on conflict (dataset_item_id) ${
            allowOverwrite
                ? "do update set label_json = excluded.label_json"
                : "do nothing"
        }
        returning dataset_item_id`,
        [itemId, label, teamId, projectId],
    );
    if (!allowOverwrite && result.rowCount === 0) {
        throw new Error(
            "This audio item gained an answer after preview. Review it and confirm replacement before importing.",
        );
    }
}

function importFailureReason(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

async function getOwnedDataset(
    db: IDb,
    teamId: string,
    projectId: string,
    datasetId: string,
): Promise<IDatasetLifecycleRow> {
    const result = await db.query<IDatasetLifecycleRow>(
        `select
            id,
            team_id,
            name,
            purpose,
            modality,
            pipeline_id,
            description,
            archived_at,
            created_by,
            created_at
        from datasets
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [datasetId, teamId, projectId],
    );
    const dataset = result.rows[0];
    if (!dataset) throw new ApiNotFoundError("Dataset not found");
    return dataset;
}

async function assertEditableDataset(
    db: IDb,
    teamId: string,
    projectId: string,
    datasetId: string,
): Promise<IDatasetLifecycleRow> {
    const dataset = await getOwnedDataset(db, teamId, projectId, datasetId);
    if (dataset.archived_at != null) {
        throw new ApiConflictError(
            "This dataset is archived. Restore it to make changes.",
        );
    }
    return dataset;
}

async function deleteMediaFromStorage(
    config: IApiConfig,
    storageKey: string,
): Promise<void> {
    assertStorageKey(storageKey);
    if (config.storageAdapter === "local") {
        await fs.rm(localMediaPath(storageKey), { force: true });
        return;
    }

    if (config.storageAdapter === "r2") {
        try {
            await deleteR2Object(config.r2Storage!, storageKey);
            return;
        } catch (error) {
            const status = (error as { status?: number }).status;
            throw new ApiBadRequestError(
                `R2 Storage delete failed${status ? ` with ${status}` : ""}`,
            );
        }
    }

    const objectPath = config.supabaseStoragePrefix
        ? `${config.supabaseStoragePrefix}/${storageKey}`
        : storageKey;
    const response = await fetchWithTimeout(supabaseBucketUrl(config), {
        method: "DELETE",
        headers: {
            apikey: config.supabaseServiceRoleKey,
            Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefixes: [objectPath] }),
    });
    if (!response.ok) {
        throw new ApiBadRequestError(
            `Supabase Storage delete failed with ${response.status}`,
        );
    }
}

async function fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = 15_000,
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

function supabaseBucketUrl(config: IApiConfig): string {
    const bucket = encodeURIComponent(config.supabaseStorageBucket);
    return `${config.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${bucket}`;
}

function isDatasetRunnable(
    purpose: IDatasetListRow["purpose"],
    itemCount: number,
    labeledItemCount: number,
): boolean {
    if (itemCount < 1) return false;
    if (purpose === "evaluation") return true;
    return labeledItemCount > 0;
}

function countValue(value: number | string | null): number {
    return typeof value === "number" ? value : Number(value ?? 0);
}

function resolveLabelMode(ctx: {
    purpose: "golden" | "evaluation";
    pipelineId: string | null;
    hasLegacySchema: boolean;
}): DatasetLabelMode {
    if (ctx.purpose === "evaluation") return "evaluation";
    if (ctx.pipelineId) return "pipeline";
    if (ctx.hasLegacySchema) return "legacySchema";
    return "independent";
}

function usesFreeformLabel(mode: DatasetLabelMode): boolean {
    return mode === "independent" || mode === "evaluation";
}

async function resolveAnswerSchema(
    db: IDb,
    dataset: IDatasetDetailRow,
    labelMode: DatasetLabelMode,
    schemaRow: ISchemaRow | undefined,
): Promise<IParsedSchemaDescriptor | undefined> {
    if (labelMode === "evaluation" || labelMode === "independent") {
        return undefined;
    }
    if (labelMode === "pipeline") {
        const result = await db.query<IPipelineRow>(
            `select output_schema, field_configs
            from pipelines
            where id = $1
            limit 1`,
            [dataset.pipeline_id],
        );
        const pipeline = result.rows[0];
        if (!pipeline) return undefined;
        return {
            fields: pipelineFactualDescriptors(
                pipeline.output_schema,
                pipeline.field_configs,
            ),
            additionalProperties: true,
        };
    }
    return schemaRow ? parseSchema(schemaRow.json_schema) : undefined;
}

function pipelineFactualDescriptors(
    jsonSchema: Record<string, unknown>,
    fieldConfigs: IPipelineFieldConfig[],
): IParsedSchemaDescriptor["fields"] {
    const parsed = parseSchema(jsonSchema);
    if (!parsed) return [];
    const factual = new Set(
        fieldConfigs
            .filter((config) => config.kind === "factual")
            .map((config) => config.field),
    );
    return parsed.fields.filter((field) => factual.has(field.name));
}

function parseSchema(
    schema: Record<string, unknown>,
): IParsedSchemaDescriptor | undefined {
    if (schema.type !== "object" || !isRecord(schema.properties))
        return undefined;
    const required = new Set(
        Array.isArray(schema.required)
            ? schema.required.filter(
                  (field): field is string => typeof field === "string",
              )
            : [],
    );
    const fields: IParsedSchemaDescriptor["fields"] = [];
    for (const [name, fieldSchema] of Object.entries(schema.properties)) {
        const type = parseFieldType(fieldSchema);
        if (!type) return undefined;
        fields.push({ name, type, required: required.has(name) });
    }
    return {
        fields,
        additionalProperties:
            typeof schema.additionalProperties === "boolean"
                ? schema.additionalProperties
                : true,
    };
}

function parseFieldType(rawSchema: unknown): SchemaFieldType | undefined {
    if (!isRecord(rawSchema)) return undefined;
    if (rawSchema.type === "string" || rawSchema.type === "number") {
        return rawSchema.type;
    }
    if (
        rawSchema.type === "array" &&
        isRecord(rawSchema.items) &&
        rawSchema.items.type === "string"
    ) {
        return "string[]";
    }
    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSourceName(
    sourceName: string | undefined,
): string | undefined {
    const trimmed = sourceName?.trim();
    return trimmed || undefined;
}

function isUniqueViolation(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: unknown }).code === "23505"
    );
}
