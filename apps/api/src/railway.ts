import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const isEntrypoint =
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
    startRailwayBackend();
}

export function startRailwayBackend(): void {
    const children: ChildProcess[] = [];
    let shuttingDown = false;
    let exiting = false;

    const shutdown = (signal: NodeJS.Signals) => {
        if (shuttingDown) return;
        shuttingDown = true;
        for (const child of children) child.kill(signal);
    };
    const exitUnexpectedly = (
        name: string,
        code: number | null,
        signal: NodeJS.Signals | null,
    ) => {
        if (shuttingDown || exiting) return;
        exiting = true;
        const reason = signal
            ? `from ${signal}`
            : `with code ${code ?? "unknown"}`;
        console.error(`${name} exited unexpectedly ${reason}`);
        for (const child of children) child.kill("SIGTERM");
        process.exit(code && code > 0 ? code : 1);
    };

    children.push(
        spawnManaged(
            "api",
            process.execPath,
            [new URL("./server.js", import.meta.url)],
            () => shuttingDown,
            exitUnexpectedly,
        ),
    );
    if (process.env.MOSAIC_API_START_WORKER !== "false") {
        children.push(
            spawnManaged(
                "worker",
                "pnpm",
                ["--filter", "@mosaic/web", "worker"],
                () => shuttingDown,
                exitUnexpectedly,
            ),
        );
    }

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
}

function spawnManaged(
    name: string,
    command: string,
    args: Array<string | URL>,
    isShuttingDown: () => boolean,
    exitUnexpectedly: (
        name: string,
        code: number | null,
        signal: NodeJS.Signals | null,
    ) => void,
): ChildProcess {
    const child = spawn(
        command,
        args.map((arg) => (arg instanceof URL ? fileURLToPath(arg) : arg)),
        {
            stdio: "inherit",
            env: process.env,
        },
    );
    child.on("exit", (code, signal) => {
        if (!isShuttingDown()) {
            exitUnexpectedly(name, code, signal);
            return;
        }
        if (signal) {
            console.info(`${name} exited from ${signal}`);
            return;
        }
        console.info(`${name} exited with code ${code ?? "unknown"}`);
    });
    child.on("error", (err) => {
        console.error(`${name} failed`, err);
        exitUnexpectedly(name, 1, null);
    });
    return child;
}
