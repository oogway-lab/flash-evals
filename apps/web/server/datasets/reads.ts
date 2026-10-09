import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { datasets, datasetItems, labels } from "../db/schema";
import type { IParsedSchemaDescriptor, LabelJson } from "../db/jsonTypes";
import {
    getDataset,
    getDatasetSchema,
    getLabelsForItems,
    listItems,
} from "./service";
import { resolveAnswerSchema } from "./answerSchema";
import {
    resolveLabelMode,
    usesFreeformLabel,
    type DatasetLabelMode,
} from "./labelPolicy";

export interface IDatasetListRow {
    id: string;
    name: string;
    purpose: "golden" | "evaluation";
    modality: "audio" | "image" | "text";
    createdAt: Date;
    itemCount: number;
    labeledItemCount: number;
    isRunnable: boolean;
    archived: boolean;
}

export function activeDatasetWhere(teamId: string) {
    return and(eq(datasets.teamId, teamId), isNull(datasets.archivedAt));
}

function isDatasetRunnable(
    purpose: "golden" | "evaluation",
    itemCount: number,
    labeledItemCount: number,
): boolean {
    if (itemCount < 1) return false;
    if (purpose === "evaluation") return true;
    return labeledItemCount > 0;
}

export async function listDatasetsEnriched(
    teamId: string,
    opts?: { includeArchived?: boolean },
): Promise<IDatasetListRow[]> {
    const where = opts?.includeArchived
        ? eq(datasets.teamId, teamId)
        : activeDatasetWhere(teamId);

    const rows = await db
        .select()
        .from(datasets)
        .where(where)
        .orderBy(desc(datasets.createdAt));

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);

    const itemCounts = await db
        .select({
            datasetId: datasetItems.datasetId,
            count: sql<number>`count(*)::int`,
        })
        .from(datasetItems)
        .where(inArray(datasetItems.datasetId, ids))
        .groupBy(datasetItems.datasetId);

    const labeledCounts = await db
        .select({
            datasetId: datasetItems.datasetId,
            count: sql<number>`count(${labels.id})::int`,
        })
        .from(datasetItems)
        .leftJoin(labels, eq(labels.datasetItemId, datasetItems.id))
        .where(inArray(datasetItems.datasetId, ids))
        .groupBy(datasetItems.datasetId);

    const countById = new Map(itemCounts.map((r) => [r.datasetId, r.count]));
    const labeledById = new Map(
        labeledCounts.map((r) => [r.datasetId, r.count]),
    );

    return rows.map((r) => {
        const itemCount = countById.get(r.id) ?? 0;
        const labeledItemCount = labeledById.get(r.id) ?? 0;
        return {
            id: r.id,
            name: r.name,
            purpose: r.purpose,
            modality: r.modality,
            createdAt: r.createdAt,
            itemCount,
            labeledItemCount,
            isRunnable: isDatasetRunnable(
                r.purpose,
                itemCount,
                labeledItemCount,
            ),
            archived: r.archivedAt != null,
        };
    });
}

export interface IDatasetDetail {
    dataset: NonNullable<Awaited<ReturnType<typeof getDataset>>>;
    items: Awaited<ReturnType<typeof listItems>>;
    labels: (LabelJson | undefined)[];
    itemCount: number;
    labeledItemCount: number;
    labelMode: DatasetLabelMode;
    answerSchema: IParsedSchemaDescriptor | undefined;
    freeformLabel: boolean;
    isRunnable: boolean;
}

export async function getDatasetDetail(
    datasetId: string,
): Promise<IDatasetDetail | undefined> {
    const dataset = await getDataset(datasetId);
    if (!dataset) return undefined;

    const schemaRow = await getDatasetSchema(datasetId);
    const resolved = await resolveAnswerSchema(datasetId, dataset);
    const labelMode = resolved.ok
        ? resolved.mode
        : resolveLabelMode({
              purpose: dataset.purpose,
              pipelineId: dataset.pipelineId,
              hasLegacySchema: Boolean(schemaRow),
          });

    const items = await listItems(datasetId);
    const labelsById = await getLabelsForItems(items.map((item) => item.id));
    const labels = items.map((item) => labelsById.get(item.id));
    const itemCount = items.length;
    const labeledItemCount = labels.filter(Boolean).length;

    return {
        dataset,
        items,
        labels,
        itemCount,
        labeledItemCount,
        labelMode,
        answerSchema: resolved.ok ? resolved.answerSchema : undefined,
        freeformLabel: resolved.ok
            ? resolved.freeformLabel
            : usesFreeformLabel(labelMode),
        isRunnable: isDatasetRunnable(
            dataset.purpose,
            itemCount,
            labeledItemCount,
        ),
    };
}
