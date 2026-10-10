import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const preload = fileURLToPath(
    new URL(
        "../../../scripts/fixtures/railway-worker-preload.mjs",
        import.meta.url,
    ),
);
const bundledCa = join(root, "apps/web/config/supabase-root-2021-ca.pem");
const config = JSON.parse(
    readFileSync(join(root, "railway.worker.json"), "utf8"),
) as { deploy: { startCommand: string } };

interface IWorkerEvent {
    event: string;
    pid?: number;
    parentPid?: number;
    extraCaCerts?: string;
}

function events(output: string): IWorkerEvent[] {
    return output
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line) as IWorkerEvent);
}

function terminateProcessGroup(pid: number): void {
    try {
        process.kill(-pid, "SIGKILL");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
}

describe("configured Railway worker launch", () => {
    it.each([
        { signal: "SIGTERM", target: "launcher" },
        { signal: "SIGINT", target: "launcher" },
        { signal: "SIGTERM", target: "process group" },
        { signal: "SIGINT", target: "process group" },
    ] as const)(
        "forwards $signal sent to the $target and waits for graceful completion",
        async ({ signal, target }) => {
            const fixtureDir = mkdtempSync(join(tmpdir(), "railway-worker-"));
            const customCa = join(fixtureDir, "custom-ca.pem");
            copyFileSync(bundledCa, customCa);
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                NODE_OPTIONS: `--import=${preload}`,
                MOSAIC_WORKER_DRAIN_TIMEOUT_MS: "1000",
                MOSAIC_WORKER_TEST_FIXTURES: fixtureDir,
            };
            if (signal === "SIGINT") env.NODE_EXTRA_CA_CERTS = customCa;
            else delete env.NODE_EXTRA_CA_CERTS;

            const child = spawn("sh", ["-c", config.deploy.startCommand], {
                cwd: root,
                env,
                detached: true,
                stdio: ["ignore", "pipe", "pipe"],
            });
            let output = "";
            let workerPid: number | undefined;
            let exit:
                | { code: number | null; signal: NodeJS.Signals | null }
                | undefined;
            child.stdout.on("data", (chunk: Buffer) => {
                output += chunk.toString();
            });
            child.stderr.on("data", (chunk: Buffer) => {
                output += chunk.toString();
            });
            child.on("exit", (code, exitSignal) => {
                exit = { code, signal: exitSignal };
            });

            try {
                await vi.waitFor(
                    () => {
                        expect(
                            events(output).some(
                                (item) => item.event === "worker.ready",
                            ),
                            output,
                        ).toBe(true);
                    },
                    { timeout: 5000 },
                );
                const ready = events(output).find(
                    (item) => item.event === "worker.ready",
                )!;
                workerPid = ready.pid;
                // exec leaves the TLS wrapper as Railway's direct child; pnpm
                // and an intermediate launch shell must not absorb the signal.
                expect(ready.parentPid).toBe(child.pid);
                expect(ready.extraCaCerts).toBe(
                    signal === "SIGINT" ? customCa : bundledCa,
                );
                if (target === "process group") {
                    process.kill(-child.pid!, signal);
                } else {
                    expect(child.kill(signal)).toBe(true);
                }
                await vi.waitFor(
                    () => {
                        expect(exit, output).toEqual({ code: 0, signal: null });
                    },
                    { timeout: 5000 },
                );
                expect(events(output).map((item) => item.event)).toEqual([
                    "worker.starting",
                    "worker.ready",
                    "worker.shutdown_started",
                    "fixture.queue_drained",
                    "fixture.database_closed",
                    "worker.shutdown_completed",
                ]);
            } finally {
                if (workerPid) terminateProcessGroup(workerPid);
                if (child.pid) terminateProcessGroup(child.pid);
                rmSync(fixtureDir, { recursive: true, force: true });
            }
        },
        12_000,
    );
});
