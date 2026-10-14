#!/usr/bin/env node
import { writeFile, rename } from "node:fs/promises";
import { URL } from "node:url";
import {
    CATALOG_URLS,
    fetchModelCatalog,
} from "../packages/llm-core/dist/index.js";

// Replace the bundled fallback only when every public source refresh succeeds.
const snapshots = await Promise.all(
    Object.keys(CATALOG_URLS).map((source) => fetchModelCatalog(source)),
);
const destination = new URL(
    "../packages/llm-core/src/models/catalog.snapshot.json",
    import.meta.url,
);
const temporary = new URL(`${destination.href}.tmp`);
await writeFile(temporary, `${JSON.stringify(snapshots, null, 2)}\n`);
await rename(temporary, destination);
for (const snapshot of snapshots) {
    console.info(`${snapshot.source}: ${snapshot.models.length} models`);
}
