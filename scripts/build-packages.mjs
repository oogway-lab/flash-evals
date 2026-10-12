#!/usr/bin/env node
// Builds the shared workspace packages the apps import from dist/.
// `pnpm run dev` builds them once up front and sets MOSAIC_PACKAGES_BUILT so
// the api, web and worker processes it starts don't rebuild them concurrently.
import { spawnSync } from "node:child_process";

const PACKAGES = [
    "@mosaic/object-storage",
    "@mosaic/api-contract",
    "@mosaic/llm-core",
    "@mosaic/secrets",
];

if (process.env.MOSAIC_PACKAGES_BUILT !== "1") {
    for (const name of PACKAGES) {
        const result = spawnSync("pnpm", ["--filter", name, "build"], {
            stdio: "inherit",
        });
        if (result.status !== 0) process.exit(result.status ?? 1);
    }
}
