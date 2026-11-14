#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    loadsEnvFile,
    withoutShellProviderEnv,
} from "./lib/shell-provider-env.mjs";

const ROOT_DIR = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const SUPABASE_CA_PATH = path.join(
    ROOT_DIR,
    "apps/web/config/supabase-root-2021-ca.pem",
);

const nodeArgs = process.argv.slice(2);
// A local run (it loads the app's .env files) gets provider keys and settings
// only from those files, never from the shell, whichever script started it.
// Platform runs (Railway) pass no env file and keep their configured values.
// (bun run may already have copied a .env into the environment, so this
// can't tell the two apart; node's --env-file loads the file's values again.)
const baseEnv = loadsEnvFile(nodeArgs)
    ? withoutShellProviderEnv(process.env).env
    : process.env;

const child = spawn(process.execPath, nodeArgs, {
    cwd: process.cwd(),
    // A terminal/process-group signal must reach the child only once, through
    // this wrapper. Otherwise direct delivery plus forwarding forces shutdown.
    detached: process.platform !== "win32",
    env: {
        ...baseEnv,
        NODE_EXTRA_CA_CERTS:
            process.env.NODE_EXTRA_CA_CERTS || SUPABASE_CA_PATH,
    },
    stdio: "inherit",
});

// A process-group signal and bun's forwarding can reach this wrapper together.
// Forward once so the worker's second-signal emergency exit isn't triggered.
let stopping = false;
function forwardSignal(signal) {
    if (stopping) return;
    stopping = true;
    child.kill(signal);
}
const forwardSigint = () => forwardSignal("SIGINT");
const forwardSigterm = () => forwardSignal("SIGTERM");
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
