import { spawn, spawnSync } from "node:child_process";
import { EOL } from "node:os";
import path from "node:path";
import { clearInterval, setInterval } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { apiEnv, devHost, root, webEnv } from "./lib/dev-env.cjs";

const webArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const hostArgs = optionValue(webArgs, ["-H", "--hostname"])
    ? []
    : ["--hostname", devHost];
const webPort =
    optionValue(webArgs, ["-p", "--port"]) || process.env.PORT || "3000";
// Not PORT: next dev reads PORT for web, so sharing it would collide.
const apiPort = process.env.FLASH_EVALS_DEV_API_PORT || apiEnv.PORT || "3001";
const localWebOrigin = `http://localhost:${webPort}`;
const configuredWebOrigin =
    process.env.FLASH_EVALS_DEV_WEB_ORIGIN ||
    webEnv.FLASH_EVALS_DEV_WEB_ORIGIN ||
    localWebOrigin;
// --port must also update CORS and Next's allowed origin when setup has saved
// an explicit browser origin, including remote Tailscale configurations.
const webUrl = new URL(configuredWebOrigin);
webUrl.port = webPort;
const webOrigin = webUrl.origin;
const apiOrigin = `http://localhost:${apiPort}`;
const browserApiOrigin =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    webEnv.NEXT_PUBLIC_API_BASE_URL ||
    apiOrigin;
const seedTeamId = "f3b1a534-d8ef-4146-aead-96301d99d496";
const seedUserId = "5b7ecdb4-ac4b-4219-89ea-f5f50aeae7bd";

const commands = [
    {
        name: "api",
        command: "pnpm",
        args: ["--filter", "@flash-evals/api", "dev"],
        env: {
            CORS_ORIGINS:
                process.env.CORS_ORIGINS ||
                [...new Set([localWebOrigin, webOrigin])].join(","),
            FLASH_EVALS_API_PUBLIC_URL: browserApiOrigin,
            PORT: apiPort,
            FLASH_EVALS_ALLOW_INSECURE_DEV_DEFAULTS: "true",
        },
    },
    {
        name: "web",
        command: "pnpm",
        args: ["--filter", "@flash-evals/web", "dev", ...hostArgs, ...webArgs],
        env: {
            API_BASE_URL:
                process.env.API_BASE_URL || webEnv.API_BASE_URL || apiOrigin,
            NEXT_PUBLIC_API_BASE_URL: browserApiOrigin,
            FLASH_EVALS_DEV_WEB_ORIGIN: webOrigin,
            AUTH_DEV: "true",
            AUTH_DEV_ALLOW_INSECURE: "1",
            FLASH_EVALS_DEFAULT_TEAM_ID:
                process.env.FLASH_EVALS_DEFAULT_TEAM_ID || seedTeamId,
            FLASH_EVALS_DEFAULT_USER_ID:
                process.env.FLASH_EVALS_DEFAULT_USER_ID || seedUserId,
        },
    },
    {
        name: "worker",
        command: "pnpm",
        args: ["--filter", "@flash-evals/web", "worker"],
        env: {
            AUTH_DEV: "true",
            AUTH_DEV_ALLOW_INSECURE: "1",
            FLASH_EVALS_DEFAULT_TEAM_ID:
                process.env.FLASH_EVALS_DEFAULT_TEAM_ID || seedTeamId,
            FLASH_EVALS_DEFAULT_USER_ID:
                process.env.FLASH_EVALS_DEFAULT_USER_ID || seedUserId,
        },
    },
];

// Build shared packages once so the three processes don't race each other
// rebuilding the same dist/ folders while the others import from them.
const buildScript = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "build-packages.mjs",
);
const build = spawnSync(process.execPath, [buildScript], {
    stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

// Each child leads its own process group so shutdown reaches the node
// processes pnpm starts, not just pnpm; signalling pnpm alone left orphans.
const processGroups = new Set();
let shuttingDown = false;

for (const entry of commands) {
    const child = spawn(entry.command, entry.args, {
        cwd: root,
        env: { ...process.env, FLASH_EVALS_PACKAGES_BUILT: "1", ...entry.env },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
    });

    // pid is undefined when the spawn itself fails; the error handler covers it.
    if (child.pid) processGroups.add(child.pid);
    prefixStream(child.stdout, entry.name);
    prefixStream(child.stderr, entry.name);

    child.on("error", (error) => {
        console.error(`[dev] ${entry.name} failed to start: ${error.message}`);
        shutdown(1);
    });

    child.on("exit", (code, signal) => {
        if (shuttingDown) return;

        const reason = signal ? `signal ${signal}` : `exit code ${code ?? 0}`;
        console.error(`[dev] ${entry.name} stopped with ${reason}`);
        shutdown(code && code > 0 ? code : 1);
    });
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
// Detached children no longer get the terminal's hangup, so forward it.
process.on("SIGHUP", () => shutdown(129));

function prefixStream(stream, name) {
    let buffered = "";

    stream.on("data", (chunk) => {
        buffered += chunk.toString();
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? "";

        for (const line of lines) {
            process.stdout.write(`[${name}] ${line}${EOL}`);
        }
    });

    stream.on("end", () => {
        if (buffered.length > 0) {
            process.stdout.write(`[${name}] ${buffered}${EOL}`);
        }
    });
}

// Wait on the process groups rather than the pnpm children: pnpm exits as soon
// as it forwards SIGTERM, while the node process under it is still shutting down.
function shutdown(exitCode) {
    if (shuttingDown) return;
    shuttingDown = true;

    signalProcessGroups("SIGTERM");

    // Match the worker's drain window, with time for closing pools and wrappers.
    const configuredDrain = Number.parseInt(
        process.env.FLASH_EVALS_WORKER_DRAIN_TIMEOUT_MS ??
            webEnv.FLASH_EVALS_WORKER_DRAIN_TIMEOUT_MS ??
            apiEnv.FLASH_EVALS_WORKER_DRAIN_TIMEOUT_MS,
        10,
    );
    const drainMs =
        Number.isSafeInteger(configuredDrain) && configuredDrain >= 1000
            ? Math.min(configuredDrain, 300_000)
            : 20_000;
    const deadline = Date.now() + drainMs + 10_000;
    const poll = setInterval(() => {
        if (!anyProcessGroupAlive() || Date.now() >= deadline) {
            clearInterval(poll);
            exit(exitCode);
        }
    }, 50);
}

// Kill whatever is still running in the groups before exiting, so a process
// that outlives its pnpm parent doesn't keep running in the background.
function exit(exitCode) {
    signalProcessGroups("SIGKILL");
    process.exit(exitCode);
}

function signalProcessGroups(signal) {
    for (const pid of processGroups) {
        try {
            process.kill(-pid, signal);
        } catch (error) {
            // ESRCH: the group is gone. EPERM: macOS reports this for a group
            // left holding only zombies, which is also gone for our purposes.
            if (error.code !== "ESRCH" && error.code !== "EPERM") throw error;
        }
    }
}

function anyProcessGroupAlive() {
    for (const pid of processGroups) {
        try {
            process.kill(-pid, 0);
            return true;
        } catch (error) {
            // Same gone-group codes as signalProcessGroups.
            if (error.code !== "ESRCH" && error.code !== "EPERM") throw error;
        }
    }
    return false;
}

function optionValue(args, names) {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (names.includes(arg)) return args[index + 1];

        const match = names
            .filter((name) => name.startsWith("--"))
            .map((name) => `${name}=`)
            .find((prefix) => arg.startsWith(prefix));
        if (match) return arg.slice(match.length);
    }
    return undefined;
}
