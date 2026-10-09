import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ChildProcess from "node:child_process";

type Spawn = typeof ChildProcess.spawn;
type MockChild = EventEmitter & { kill: ReturnType<typeof vi.fn> };

const spawned: MockChild[] = [];
const spawnMock = vi.fn((..._args: Parameters<Spawn>): ReturnType<Spawn> => {
    const child = new EventEmitter() as MockChild;
    child.kill = vi.fn(() => true);
    spawned.push(child);
    return child as unknown as ReturnType<Spawn>;
});

vi.mock("node:child_process", () => ({
    spawn: spawnMock,
}));

afterEach(() => {
    spawned.length = 0;
    spawnMock.mockClear();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
});

describe("startRailwayBackend", () => {
    it("exits when the worker exits cleanly before shutdown", async () => {
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
            code?: number,
        ) => {
            throw new Error(`exit:${code}`);
        }) as never);
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);
        const { startRailwayBackend } = await import("./railway.js");

        startRailwayBackend();

        expect(spawnMock).toHaveBeenCalledTimes(2);
        expect(() => spawned[1]!.emit("exit", 0, null)).toThrow("exit:1");
        expect(consoleError).toHaveBeenCalledWith(
            "worker exited unexpectedly with code 0",
        );
        expect(spawned[0]!.kill).toHaveBeenCalledWith("SIGTERM");
        expect(spawned[1]!.kill).toHaveBeenCalledWith("SIGTERM");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("does not start the worker when disabled", async () => {
        vi.stubEnv("MOSAIC_API_START_WORKER", "false");
        const { startRailwayBackend } = await import("./railway.js");

        startRailwayBackend();

        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(spawnMock).toHaveBeenNthCalledWith(
            1,
            expect.any(String),
            [expect.stringContaining("server.js")],
            expect.any(Object),
        );
    });
});
