import { createCatalogLoader, type IModelCatalogStore } from "@flash-evals/llm-core";
import { modelCatalogSnapshots } from "../db/schema";

// Imported lazily: modules that only consult the registry must load without a database.
const database = async () => (await import("../db/client")).db;

export const modelCatalogStore: IModelCatalogStore = {
    async read() {
        const db = await database();
        const rows = await db
            .select({ snapshot: modelCatalogSnapshots.snapshot })
            .from(modelCatalogSnapshots);
        return rows.map((row) => row.snapshot);
    },
    async write(snapshot) {
        const db = await database();
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

/**
 * Reload persisted catalog snapshots at most once a minute per process, so every
 * worker replica and the Next.js server see what the refresh job last stored.
 * Failed reads keep the last good (or bundled) catalog.
 */
export const ensureModelCatalog = createCatalogLoader(modelCatalogStore);
