import { type IModelCatalogStore } from "@mosaic/llm-core";
import { db } from "../db/client";
import { modelCatalogSnapshots } from "../db/schema";

export const modelCatalogStore: IModelCatalogStore = {
    async read() {
        const rows = await db
            .select({ snapshot: modelCatalogSnapshots.snapshot })
            .from(modelCatalogSnapshots);
        return rows.map((row) => row.snapshot);
    },
    async write(snapshot) {
        await db
            .insert(modelCatalogSnapshots)
            .values({
                source: snapshot.source,
                snapshot,
                fetchedAt: new Date(snapshot.fetchedAt),
            })
            .onConflictDoUpdate({
                target: modelCatalogSnapshots.source,
                set: { snapshot, fetchedAt: new Date(snapshot.fetchedAt) },
            });
    },
};
