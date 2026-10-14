import { installModelCatalog, installModelCatalogs } from "./registry.js";
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
    installModelCatalogs(
        (await store.read()).flatMap((value) => {
            const snapshot = readCatalogSnapshot(value);
            return snapshot ? [snapshot] : [];
        }),
    );
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

/**
 * Coalesce reads per store and process. Failed reads retain the last good/bundled
 * catalog. Only the first load is awaited; later reloads run in the background so
 * callers never wait on the database once a catalog is installed.
 */
export function createCatalogLoader(store: IModelCatalogStore, ttlMs = 60_000) {
    let expiresAt = 0;
    let loaded = false;
    let inFlight: Promise<void> | undefined;
    return function ensureCatalog(): Promise<void> {
        if (!inFlight && Date.now() >= expiresAt) {
            inFlight = loadModelCatalog(store)
                .catch(() => undefined)
                .finally(() => {
                    expiresAt = Date.now() + ttlMs;
                    loaded = true;
                    inFlight = undefined;
                });
        }
        return loaded || !inFlight ? Promise.resolve() : inFlight;
    };
}
