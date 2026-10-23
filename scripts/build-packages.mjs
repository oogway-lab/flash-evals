#!/usr/bin/env node
// Builds the shared workspace packages the apps import from dist/.
// `pnpm run dev` builds them once up front and sets FLASH_EVALS_PACKAGES_BUILT so
// the api, web and worker processes it starts don't rebuild them concurrently.
import { spawnSync } from "node:child_process";

const PACKAGES = [
    "@flash-evals/object-storage",
    "@flash-evals/api-contract",
    "@flash-evals/llm-core",
    "@flash-evals/secrets",
];

if (process.env.FLASH_EVALS_PACKAGES_BUILT !== "1") {
    for (const name of PACKAGES) {
        const result = spawnSync("pnpm", ["--filter", name, "build"], {
            stdio: "inherit",
        });
        if (result.status !== 0) process.exit(result.status ?? 1);
    }
}
