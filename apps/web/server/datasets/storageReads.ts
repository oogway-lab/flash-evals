import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { datasets, datasetItems } from "../db/schema";

export async function getTeamForStorageKey(
    storageKey: string,
): Promise<string | undefined> {
    const rows = await db
        .select({ teamId: datasets.teamId })
        .from(datasetItems)
        .innerJoin(datasets, eq(datasetItems.datasetId, datasets.id))
        .where(eq(datasetItems.storageKey, storageKey))
        .limit(1);
    return rows[0]?.teamId;
}

export async function getImageAccessForStorageKey(
    storageKey: string,
): Promise<{ teamId: string; mimeType: string } | undefined> {
    const rows = await db
        .select({
            teamId: datasets.teamId,
            mimeType: datasetItems.mimeType,
        })
        .from(datasetItems)
        .innerJoin(datasets, eq(datasetItems.datasetId, datasets.id))
        .where(eq(datasetItems.storageKey, storageKey))
        .limit(1);
    const row = rows[0];
    if (!row?.mimeType) return undefined;
    return { teamId: row.teamId, mimeType: row.mimeType };
}
