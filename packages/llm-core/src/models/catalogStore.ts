import { installModelCatalog } from "./registry.js";
import {
    CATALOG_URLS,
    fetchModelCatalog,
    readCatalogSnapshot,
    type CatalogSource,
    type IModelCatalogSnapshot,
} from "./catalog.js";

/** Small persistence seam shared by the API's SQL adapter and the worker's Drizzle adapter. */
export interface IModelCatalogStore {
    read(): Promise<unknown[]>;
    write(snapshot: IModelCatalogSnapshot): Promise<void>;
}

export async function loadModelCatalog(
    store: IModelCatalogStore,
): Promise<void> {
    for (const value of await store.read()) {
        const snapshot = readCatalogSnapshot(value);
        if (snapshot) installModelCatalog(snapshot);
    }
}

/** Each source is replaced only after a successful fetch and durable write. */
export async function refreshModelCatalog(
    store: IModelCatalogStore,
    fetcher: typeof fetch = fetch,
): Promise<Array<{ source: CatalogSource; ok: boolean }>> {
    return Promise.all(
        (Object.keys(CATALOG_URLS) as CatalogSource[]).map(async (source) => {
            try {
                const snapshot = await fetchModelCatalog(source, fetcher);
                await store.write(snapshot);
                installModelCatalog(snapshot);
                return { source, ok: true };
            } catch {
                return { source, ok: false };
            }
        }),
    );
}

/** Coalesce reads per store and process. Failed reads retain the last good/bundled catalog. */
export function createCatalogLoader(store: IModelCatalogStore, ttlMs = 60_000) {
    let expiresAt = 0;
    let inFlight: Promise<void> | undefined;
    return function ensureCatalog(): Promise<void> {
        if (inFlight) return inFlight;
        if (Date.now() < expiresAt) return Promise.resolve();
        inFlight = loadModelCatalog(store)
            .catch(() => undefined)
            .finally(() => {
                expiresAt = Date.now() + ttlMs;
                inFlight = undefined;
            });
        return inFlight;
    };
}
