#!/usr/bin/env node
// Builds the shared workspace packages the apps import from dist/.
// `bun run dev` builds them once up front and sets FLASH_EVALS_PACKAGES_BUILT so
// the api, web and worker processes it starts don't rebuild them concurrently.
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// Workspace directories, in dependency order.
const PACKAGES = [
    "packages/object-storage",
    "packages/api-contract",
    "packages/llm-core",
    "packages/secrets",
];

if (process.env.FLASH_EVALS_PACKAGES_BUILT !== "1") {
    for (const dir of PACKAGES) {
        const result = spawnSync("bun", ["run", "--cwd", dir, "build"], {
            cwd: root,
            stdio: "inherit",
        });
        if (result.status !== 0) process.exit(result.status ?? 1);
    }
}
