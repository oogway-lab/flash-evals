import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const workerPath = path.join(repoRoot, "apps/web/.open-next/worker.js");
const assetsPath = path.join(repoRoot, "apps/web/.open-next/assets");

await access(workerPath);
await access(assetsPath);

const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "flash-evals-worker-smoke-"),
);
const configPath = path.join(tempDir, "wrangler.jsonc");
const config = {
    name: "flash-evals-local-smoke",
    main: workerPath,
    compatibility_date: "2026-07-06",
    compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
    vars: {
        NODE_ENV: "production",
        CLERK_SECRET_KEY: "sk_test_local_only",
        INTERNAL_API_TOKEN: "local_only",
    },
    assets: { directory: assetsPath, binding: "ASSETS" },
};
await writeFile(configPath, JSON.stringify(config));

function reservePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                server.close();
                reject(
                    new Error(
                        "Could not reserve a local port for the Worker smoke test.",
                    ),
                );
                return;
            }
            const { port } = address;
            server.close((error) => (error ? reject(error) : resolve(port)));
        });
    });
}

const port = await reservePort();
const wranglerPath = path.join(
    repoRoot,
    "apps/web/node_modules/wrangler/bin/wrangler.js",
);
const wrangler = spawn(
    process.execPath,
    [
        wranglerPath,
        "dev",
        "--local",
        "--config",
        configPath,
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
    ],
    {
        cwd: repoRoot,
        env: {
            PATH: [
                path.dirname(process.execPath),
                path.join(repoRoot, "apps/web/node_modules/.bin"),
                path.join(repoRoot, "node_modules/.bin"),
            ].join(path.delimiter),
            CI: "1",
            WRANGLER_WRITE_LOGS: "false",
            WRANGLER_LOG_PATH: tempDir,
        },
        stdio: "ignore",
    },
);

let exitInfo;
wrangler.once("exit", (code, signal) => {
    exitInfo = { code, signal };
});
wrangler.once("error", (error) => {
    exitInfo = { error };
});

try {
    const url = `http://127.0.0.1:${port}/api/health`;
    let response;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        if (exitInfo) {
            if (exitInfo.error) {
                throw new Error(
                    `Could not start Wrangler: ${exitInfo.error.message}`,
                );
            }
            throw new Error(
                `Wrangler exited before serving the Worker (code=${exitInfo.code}, signal=${exitInfo.signal}).`,
            );
        }
        try {
            response = await globalThis.fetch(url, {
                signal: globalThis.AbortSignal.timeout(2_000),
            });
            break;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }

    if (!response) {
        throw new Error(
            "The local Cloudflare Worker did not become ready within 60 seconds.",
        );
    }
    if (response.status !== 200) {
        throw new Error(`GET /api/health returned HTTP ${response.status}.`);
    }
    const body = await response.json();
    if (body.status !== "ok") {
        throw new Error("GET /api/health returned an unexpected response.");
    }
    console.log(
        "Cloudflare Worker local smoke passed: GET /api/health returned 200.",
    );
} finally {
    wrangler.kill("SIGTERM");
    await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        wrangler.once("exit", () => {
            clearTimeout(timer);
            resolve();
        });
    });
    await rm(tempDir, { recursive: true, force: true });
}
