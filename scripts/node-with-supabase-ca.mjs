#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const SUPABASE_CA_PATH = path.join(
    ROOT_DIR,
    "apps/web/config/supabase-root-2021-ca.pem",
);

const child = spawn(process.execPath, process.argv.slice(2), {
    cwd: process.cwd(),
    env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS:
            process.env.NODE_EXTRA_CA_CERTS || SUPABASE_CA_PATH,
    },
    stdio: "inherit",
});

const forwardSigint = () => child.kill("SIGINT");
const forwardSigterm = () => child.kill("SIGTERM");
process.on("SIGINT", forwardSigint);
process.on("SIGTERM", forwardSigterm);

child.on("exit", (code, signal) => {
    process.removeListener("SIGINT", forwardSigint);
    process.removeListener("SIGTERM", forwardSigterm);
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 0);
});

child.on("error", (error) => {
    console.error(error);
    process.exit(1);
});
