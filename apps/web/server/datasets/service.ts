import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
    datasets,
    datasetSchemas,
    datasetItems,
    labels,
    runCells,
    runs,
} from "../db/schema";
import type { FieldRule, JsonSchemaObject, LabelJson } from "../db/jsonTypes";
import { storeImage, deleteImage } from "../images/source";
import { storeAudio, deleteAudio } from "../audio/source";
import { parseSchema } from "./schemaForm";
import {
    DeleteItemBlockedError,
    DuplicateItemSourceNameError,
} from "./errors";

export {
    DELETE_ITEM_BLOCKED_MESSAGE,
    DUPLICATE_ITEM_SOURCE_NAME_MESSAGE,
    DeleteItemBlockedError,
    DuplicateItemSourceNameError,
} from "./errors";

export interface IUpdateItemInput {
    inputText?: string;
    audio?: {
        bytes: Buffer;
        mimeType: string;
        sourceName?: string;
    };
    image?: {
        bytes: Buffer;
        mimeType: string;
        sourceName?: string;
    };
    label?: LabelJson;
    // When true, remove any existing expected-output label for this item.
    clearLabel?: boolean;
}

export type DatasetPurpose = "golden" | "evaluation";
export type DatasetModality = "audio" | "image" | "text";

export async function createDataset(
    teamId: string,
    name: string,
    createdBy: string,
    purpose: DatasetPurpose = "golden",
    modality: DatasetModality = "image",
) {
    const [row] = await db
        .insert(datasets)
        .values({
            teamId,
            projectId: sql`(select id from projects where team_id = ${teamId} order by created_at limit 1)`,
            name,
            createdBy,
            purpose,
            modality,
        })
        .returning();
    return row;
}

export async function listDatasets(teamId: string) {
    return db.select().from(datasets).where(eq(datasets.teamId, teamId));
}

export async function getDataset(datasetId: string) {
    const [row] = await db
        .select()
        .from(datasets)
        .where(eq(datasets.id, datasetId))
        .limit(1);
    return row;
}

export async function setDatasetArchived(datasetId: string, archived: boolean) {
    await db
        .update(datasets)
        .set({ archivedAt: archived ? new Date() : null })
        .where(eq(datasets.id, datasetId));
}

export async function updateDatasetName(datasetId: string, name: string) {
    await db
        .update(datasets)
        .set({ name })
        .where(eq(datasets.id, datasetId));
}

export async function updateDatasetDescription(
    datasetId: string,
    description: string | null,
) {
    await db
        .update(datasets)
        .set({ description })
        .where(eq(datasets.id, datasetId));
}

export async function duplicateDataset(datasetId: string, createdBy: string) {
    return db.transaction(async (tx) => {
        const [source] = await tx
            .select()
            .from(datasets)
            .where(eq(datasets.id, datasetId))
            .limit(1);
        if (!source) throw new Error("Dataset not found");

        const [copy] = await tx
            .insert(datasets)
            .values({
                teamId: source.teamId,
                projectId: source.projectId,
                name: `Copy of ${source.name}`,
                purpose: source.purpose,
                modality: source.modality,
                pipelineId: source.pipelineId,
                description: source.description,
                createdBy,
            })
            .returning();

        const [schema] = await tx
            .select()
            .from(datasetSchemas)
            .where(eq(datasetSchemas.datasetId, datasetId))
            .limit(1);
        if (schema) {
            await tx.insert(datasetSchemas).values({
                datasetId: copy.id,
                jsonSchema: schema.jsonSchema,
                fieldRules: schema.fieldRules,
            });
        }

        const sourceItems = await tx
            .select()
            .from(datasetItems)
            .where(eq(datasetItems.datasetId, datasetId));
        if (sourceItems.length === 0) return copy;

        const sourceLabels = await tx
            .select()
            .from(labels)
            .where(inArray(labels.datasetItemId, sourceItems.map((item) => item.id)));
        const labelByItemId = new Map(
            sourceLabels.map((label) => [label.datasetItemId, label.labelJson]),
        );

        for (const item of sourceItems) {
            const [copiedItem] = await tx
                .insert(datasetItems)
                .values({
                    datasetId: copy.id,
                    type: item.type,
                    inputText: item.inputText,
                    sourceName: item.sourceName,
                    storageKey: item.storageKey,
                    mimeType: item.mimeType,
                })
                .returning();

            const label = labelByItemId.get(item.id);
            if (label) {
                await tx.insert(labels).values({
                    datasetItemId: copiedItem.id,
                    labelJson: label,
                });
            }
        }

        return copy;
    });
}

export async function getItem(datasetItemId: string) {
    const [row] = await db
        .select()
        .from(datasetItems)
        .where(eq(datasetItems.id, datasetItemId))
        .limit(1);
    return row;
}

export type DatasetSchemaValidationResult =
    | { ok: true }
    | { ok: false; field: "jsonSchema" | "fieldRules"; error: string };

export function validateDatasetSchemaInput(
    jsonSchema: JsonSchemaObject,
    fieldRules: FieldRule[],
): DatasetSchemaValidationResult {
    const parsed = parseSchema(jsonSchema);
    if (!parsed.ok) return { ok: false, field: "jsonSchema", error: parsed.error };

    if (!Array.isArray(fieldRules)) {
        return { ok: false, field: "fieldRules", error: "Field rules must be an array." };
    }

    const schemaFields = new Set(parsed.schema.fields.map((field) => field.name));
    for (const rule of fieldRules) {
        if (!rule || typeof rule.field !== "string") {
            return {
                ok: false,
                field: "fieldRules",
                error: "Each field rule must include a schema field name.",
            };
        }
        if (!schemaFields.has(rule.field)) {
            return {
                ok: false,
                field: "fieldRules",
                error: `Field rule "${rule.field}" is not defined in the schema.`,
            };
        }
    }

    return { ok: true };
}

export async function setDatasetSchema(
    datasetId: string,
    jsonSchema: JsonSchemaObject,
    fieldRules: FieldRule[],
) {
    const validation = validateDatasetSchemaInput(jsonSchema, fieldRules);
    if (!validation.ok) throw new Error(validation.error);

    const existing = await db
        .select()
        .from(datasetSchemas)
        .where(eq(datasetSchemas.datasetId, datasetId))
        .limit(1);
    if (existing[0]) {
        await db
            .update(datasetSchemas)
            .set({ jsonSchema, fieldRules })
            .where(eq(datasetSchemas.id, existing[0].id));
        return existing[0].id;
    }
    const [row] = await db
        .insert(datasetSchemas)
        .values({ datasetId, jsonSchema, fieldRules })
        .returning();
    return row.id;
}

export async function getDatasetSchema(datasetId: string) {
    const [row] = await db
        .select()
        .from(datasetSchemas)
        .where(eq(datasetSchemas.datasetId, datasetId))
        .limit(1);
    return row;
}

export async function addTextItem(
    datasetId: string,
    inputText: string,
    label?: LabelJson,
) {
    const [item] = await db
        .insert(datasetItems)
        .values({ datasetId, type: "text", inputText })
        .returning();
    if (label) await addLabel(item.id, label);
    return item;
}

export async function addImageItem(
    datasetId: string,
    bytes: Buffer,
    mimeType: string,
    inputText?: string,
    label?: LabelJson,
    sourceName?: string,
) {
    const storageKey = await storeImage(bytes, mimeType);
    try {
        return await db.transaction(async (tx) => {
            const [item] = await tx
                .insert(datasetItems)
                .values({
                    datasetId,
                    type: inputText ? "mixed" : "image",
                    inputText,
                    sourceName: normalizeSourceName(sourceName),
                    storageKey,
                    mimeType,
                })
                .returning();
            if (label) {
                await tx
                    .insert(labels)
                    .values({ datasetItemId: item.id, labelJson: label })
                    .onConflictDoUpdate({
                        target: labels.datasetItemId,
                        set: { labelJson: label },
                    });
            }
            return item;
        });
    } catch (err) {
        // Roll back the stored blob so a failed insert doesn't orphan it.
        await deleteImage(storageKey).catch(() => {});
        if (isUniqueViolation(err)) throw new DuplicateItemSourceNameError();
        throw err;
    }
}

export async function addAudioItem(
    datasetId: string,
    bytes: Buffer,
    mimeType: string,
    inputText?: string,
    label?: LabelJson,
    sourceName?: string,
) {
    const stored = await storeAudio(bytes, mimeType);
    try {
        return await db.transaction(async (tx) => {
            const [item] = await tx
                .insert(datasetItems)
                .values({
                    datasetId,
                    type: inputText ? "mixed" : "audio",
                    inputText,
                    sourceName: normalizeSourceName(sourceName),
                    storageKey: stored.storageKey,
                    mimeType: stored.mimeType,
                })
                .returning();
            if (label) {
                await tx
                    .insert(labels)
                    .values({ datasetItemId: item.id, labelJson: label })
                    .onConflictDoUpdate({
                        target: labels.datasetItemId,
                        set: { labelJson: label },
                    });
            }
            return item;
        });
    } catch (err) {
        await deleteAudio(stored.storageKey).catch(() => {});
        if (isUniqueViolation(err)) throw new DuplicateItemSourceNameError();
        throw err;
    }
}

export async function addLabel(datasetItemId: string, labelJson: LabelJson) {
    const [row] = await db
        .insert(labels)
        .values({ datasetItemId, labelJson })
        .onConflictDoUpdate({ target: labels.datasetItemId, set: { labelJson } })
        .returning();
    return row.id;
}

export async function updateItem(
    datasetItemId: string,
    payload: IUpdateItemInput,
) {
    const existing = await getItem(datasetItemId);
    if (!existing) throw new Error("Dataset item not found");

    const nextInputText =
        payload.inputText !== undefined ? payload.inputText : existing.inputText;
    let nextStorageKey = existing.storageKey;
    let nextMimeType = existing.mimeType;
    let nextSourceName = existing.sourceName;
    let replacementStorageKey: string | undefined;
    let replacementKind: "audio" | "image" | undefined;

    if (payload.audio && payload.image) {
        throw new Error("Choose either audio or image for this item.");
    }

    if (payload.audio) {
        const stored = await storeAudio(payload.audio.bytes, payload.audio.mimeType);
        nextStorageKey = stored.storageKey;
        nextMimeType = stored.mimeType;
        nextSourceName = normalizeSourceName(payload.audio.sourceName) ?? null;
        replacementStorageKey = nextStorageKey;
        replacementKind = "audio";
    } else if (payload.image) {
        nextStorageKey = await storeImage(payload.image.bytes, payload.image.mimeType);
        nextMimeType = payload.image.mimeType;
        nextSourceName = normalizeSourceName(payload.image.sourceName) ?? null;
        replacementStorageKey = nextStorageKey;
        replacementKind = "image";
    }

    const mediaKind =
        replacementKind ??
        (nextMimeType?.startsWith("audio/") ? "audio" : nextStorageKey ? "image" : undefined);
    const hasMedia = Boolean(nextStorageKey);
    const hasText = Boolean(nextInputText);
    const nextType = hasMedia ? (hasText ? "mixed" : mediaKind) : "text";

    try {
        const row = await db.transaction(async (tx) => {
            const [row] = await tx
                .update(datasetItems)
                .set({
                    inputText: nextInputText,
                    sourceName: nextSourceName,
                    storageKey: nextStorageKey,
                    mimeType: nextMimeType,
                    type: nextType,
                })
                .where(eq(datasetItems.id, datasetItemId))
                .returning();

            if (payload.label !== undefined) {
                await tx
                    .insert(labels)
                    .values({ datasetItemId, labelJson: payload.label })
                    .onConflictDoUpdate({
                        target: labels.datasetItemId,
                        set: { labelJson: payload.label },
                    });
            } else if (payload.clearLabel) {
                await tx
                    .delete(labels)
                    .where(eq(labels.datasetItemId, datasetItemId));
            }
            return row;
        });
        if (
            replacementStorageKey &&
            existing.storageKey &&
            existing.storageKey !== replacementStorageKey
        ) {
            await deleteStoredMedia(existing.storageKey, existing.mimeType).catch(() => {});
        }
        return row;
    } catch (err) {
        if (replacementStorageKey) {
            await deleteStoredMedia(replacementStorageKey, nextMimeType).catch(() => {});
        }
        if (isUniqueViolation(err)) throw new DuplicateItemSourceNameError();
        throw err;
    }
}

async function deleteStoredMedia(
    storageKey: string,
    mimeType: string | null,
): Promise<void> {
    if (mimeType?.startsWith("audio/")) {
        await deleteAudio(storageKey);
        return;
    }
    await deleteImage(storageKey);
}

export async function deleteLabel(datasetItemId: string) {
    await db.delete(labels).where(eq(labels.datasetItemId, datasetItemId));
}

export async function deleteItem(datasetItemId: string) {
    const existing = await getItem(datasetItemId);
    if (!existing) throw new Error("Dataset item not found");
    const [usage] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(runCells)
        .where(eq(runCells.datasetItemId, datasetItemId));

    if ((usage?.count ?? 0) > 0) throw new DeleteItemBlockedError();

    try {
        await deleteLabel(datasetItemId);
        await db.delete(datasetItems).where(eq(datasetItems.id, datasetItemId));
    } catch (err) {
        if (isForeignKeyViolation(err)) throw new DeleteItemBlockedError();
        throw err;
    }
    if (existing.storageKey) {
        await deleteStoredMedia(existing.storageKey, existing.mimeType).catch(() => {});
    }
}

export async function deleteDataset(datasetId: string) {
    const [usage] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(runs)
        .where(eq(runs.datasetId, datasetId));

    if ((usage?.count ?? 0) > 0) {
        throw new Error(
            "Delete the runs that use this dataset before deleting the dataset.",
        );
    }

    const items = await db
        .select({
            id: datasetItems.id,
            storageKey: datasetItems.storageKey,
            mimeType: datasetItems.mimeType,
        })
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));
    const itemIds = items.map((item) => item.id);

    try {
        await db.transaction(async (tx) => {
            if (itemIds.length > 0) {
                await tx
                    .delete(labels)
                    .where(inArray(labels.datasetItemId, itemIds));
            }
            await tx
                .delete(datasetSchemas)
                .where(eq(datasetSchemas.datasetId, datasetId));
            await tx
                .delete(datasetItems)
                .where(eq(datasetItems.datasetId, datasetId));
            await tx.delete(datasets).where(eq(datasets.id, datasetId));
        });
    } catch (err) {
        if (isForeignKeyViolation(err)) {
            throw new Error(
                "Delete the runs that use this dataset before deleting the dataset.",
            );
        }
        throw err;
    }

    await Promise.all(
        items
            .filter(
                (
                    item,
                ): item is typeof item & {
                    storageKey: string;
                } => Boolean(item.storageKey),
            )
            .map((item) =>
                deleteStoredMedia(item.storageKey, item.mimeType).catch(() => {}),
            ),
    );
}

export function isForeignKeyViolation(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: unknown }).code === "23503"
    );
}

export function isUniqueViolation(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: unknown }).code === "23505" &&
        (err as { constraint?: unknown }).constraint ===
            "dataset_items_dataset_source_name_idx"
    );
}

function normalizeSourceName(sourceName: string | undefined): string | undefined {
    const trimmed = sourceName?.trim();
    return trimmed ? trimmed : undefined;
}

export async function listItems(datasetId: string) {
    return db
        .select()
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));
}

export async function getLabelForItem(
    datasetItemId: string,
): Promise<LabelJson | undefined> {
    const [row] = await db
        .select()
        .from(labels)
        .where(eq(labels.datasetItemId, datasetItemId))
        .limit(1);
    return row?.labelJson;
}

export async function getLabelsForItems(
    datasetItemIds: string[],
): Promise<Map<string, LabelJson>> {
    if (datasetItemIds.length === 0) return new Map();
    const rows = await db
        .select()
        .from(labels)
        .where(inArray(labels.datasetItemId, datasetItemIds));
    return new Map(rows.map((row) => [row.datasetItemId, row.labelJson]));
}
