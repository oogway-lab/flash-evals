import { spawn, spawnSync } from "node:child_process";
import { EOL } from "node:os";
import path from "node:path";
import { clearInterval, setInterval } from "node:timers";
import { fileURLToPath } from "node:url";

const webArgs = process.argv.slice(2);
const webPort =
    optionValue(webArgs, ["-p", "--port"]) || process.env.PORT || "3000";
// Not PORT: next dev reads PORT for web, so sharing it would collide.
const apiPort = process.env.MOSAIC_DEV_API_PORT || "3001";
const webOrigin = `http://localhost:${webPort}`;
const apiOrigin = `http://localhost:${apiPort}`;
const seedTeamId = "f3b1a534-d8ef-4146-aead-96301d99d496";
const seedUserId = "5b7ecdb4-ac4b-4219-89ea-f5f50aeae7bd";

const commands = [
    {
        name: "api",
        command: "pnpm",
        args: ["--filter", "@mosaic/api", "dev"],
        env: {
            CORS_ORIGINS: process.env.CORS_ORIGINS || webOrigin,
            PORT: apiPort,
            MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS: "true",
        },
    },
    {
        name: "web",
        command: "pnpm",
        args: ["--filter", "@mosaic/web", "dev", "--", ...webArgs],
        env: {
            API_BASE_URL: apiOrigin,
            NEXT_PUBLIC_API_BASE_URL: apiOrigin,
            AUTH_DEV: "true",
            AUTH_DEV_ALLOW_INSECURE: "1",
            MOSAIC_DEFAULT_TEAM_ID:
                process.env.MOSAIC_DEFAULT_TEAM_ID || seedTeamId,
            MOSAIC_DEFAULT_USER_ID:
                process.env.MOSAIC_DEFAULT_USER_ID || seedUserId,
        },
    },
    {
        name: "worker",
        command: "pnpm",
        args: ["--filter", "@mosaic/web", "worker"],
        env: {
            AUTH_DEV: "true",
            AUTH_DEV_ALLOW_INSECURE: "1",
            MOSAIC_DEFAULT_TEAM_ID:
                process.env.MOSAIC_DEFAULT_TEAM_ID || seedTeamId,
            MOSAIC_DEFAULT_USER_ID:
                process.env.MOSAIC_DEFAULT_USER_ID || seedUserId,
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
        cwd: process.cwd(),
        env: { ...process.env, MOSAIC_PACKAGES_BUILT: "1", ...entry.env },
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

    const deadline = Date.now() + 2000;
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
