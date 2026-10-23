import { createCatalogLoader } from "@flash-evals/llm-core";
import type { IDb } from "./db.js";

const loaders = new WeakMap<IDb, ReturnType<typeof createCatalogLoader>>();

/** Reload public catalog metadata at most once a minute per API instance. */
export async function ensureModelCatalog(db: IDb): Promise<void> {
    let loader = loaders.get(db);
    if (!loader) {
        loader = createCatalogLoader({
            async read() {
                const result = await db.query<{ snapshot: unknown }>(
                    "select snapshot from model_catalog_snapshots",
                );
                return result.rows.map((row) => row.snapshot);
            },
            async write() {
                throw new Error("API model catalog is read-only");
            },
        });
        loaders.set(db, loader);
    }
    await loader();
}
