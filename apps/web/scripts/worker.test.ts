import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    closeDatabasePool: vi.fn(async (): Promise<void> => undefined),
    startRunWorker: vi.fn(async (): Promise<void> => undefined),
    stopRunWorker: vi.fn(async () => ({ remainingInFlight: 0 })),
    startWorkflowRunWorker: vi.fn(async (): Promise<void> => undefined),
    stopWorkflowRunWorker: vi.fn(async () => ({ remainingInFlight: 0 })),
    logWorkerEvent: vi.fn(),
    safeWorkerError: vi.fn(() => ({ errorName: "Error" })),
}));

vi.mock("../server/db/client", () => ({
    closeDatabasePool: mocks.closeDatabasePool,
}));
vi.mock("../server/jobs/runQueue", () => ({
    startRunWorker: mocks.startRunWorker,
    stopRunWorker: mocks.stopRunWorker,
}));
vi.mock("../server/jobs/workflowRunQueue", () => ({
    startWorkflowRunWorker: mocks.startWorkflowRunWorker,
    stopWorkflowRunWorker: mocks.stopWorkflowRunWorker,
}));
vi.mock("../server/jobs/workerObservability", () => ({
    logWorkerEvent: mocks.logWorkerEvent,
    safeWorkerError: mocks.safeWorkerError,
}));

type SignalListener = (signal: NodeJS.Signals) => void;
const installedListeners: Array<{
    signal: NodeJS.Signals;
    listener: SignalListener;
}> = [];
let previousDrainTimeout: string | undefined;
let previousExitCode: NodeJS.Process["exitCode"];

async function loadWorkerAndGetSignal(
    signal: NodeJS.Signals,
): Promise<SignalListener> {
    const before = new Set(process.listeners(signal));
    await import("./worker");
    const listener = process
        .listeners(signal)
        .find((item) => !before.has(item));
    if (!listener) throw new Error(`No ${signal} handler was installed.`);
    installedListeners.push({ signal, listener });
    return listener;
}

describe("worker process shutdown", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useRealTimers();
        previousDrainTimeout = process.env.MOSAIC_WORKER_DRAIN_TIMEOUT_MS;
        previousExitCode = process.exitCode;
        process.env.MOSAIC_WORKER_DRAIN_TIMEOUT_MS = "1000";
        mocks.closeDatabasePool.mockReset().mockResolvedValue(undefined);
        mocks.startRunWorker.mockReset().mockResolvedValue(undefined);
        mocks.stopRunWorker
            .mockReset()
            .mockResolvedValue({ remainingInFlight: 0 });
        mocks.startWorkflowRunWorker.mockReset().mockResolvedValue(undefined);
        mocks.stopWorkflowRunWorker
            .mockReset()
            .mockResolvedValue({ remainingInFlight: 0 });
        mocks.logWorkerEvent.mockReset();
        mocks.safeWorkerError
            .mockReset()
            .mockReturnValue({ errorName: "Error" });
        vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    });

    afterEach(() => {
        for (const { signal, listener } of installedListeners.splice(0)) {
            process.removeListener(signal, listener);
        }
        if (previousDrainTimeout === undefined) {
            delete process.env.MOSAIC_WORKER_DRAIN_TIMEOUT_MS;
        } else {
            process.env.MOSAIC_WORKER_DRAIN_TIMEOUT_MS = previousDrainTimeout;
        }
        process.exitCode = previousExitCode;
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it("quiesces queues immediately when SIGTERM arrives during partial startup", async () => {
        let finishRunStartup!: () => void;
        mocks.startRunWorker.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishRunStartup = resolve;
                }),
        );
        const signal = await loadWorkerAndGetSignal("SIGTERM");

        signal("SIGTERM");

        expect(mocks.stopRunWorker).toHaveBeenCalledWith(1_000);
        expect(mocks.stopWorkflowRunWorker).toHaveBeenCalledWith(1_000);
        expect(mocks.startWorkflowRunWorker).not.toHaveBeenCalled();
        await vi.waitFor(() =>
            expect(mocks.closeDatabasePool).toHaveBeenCalled(),
        );
        expect(process.exit).not.toHaveBeenCalled();

        finishRunStartup();
    });

    it("forces exit on a repeated termination signal", async () => {
        mocks.stopRunWorker.mockImplementationOnce(
            () => new Promise<{ remainingInFlight: number }>(() => {}),
        );
        const signal = await loadWorkerAndGetSignal("SIGTERM");

        signal("SIGTERM");
        signal("SIGTERM");

        expect(process.exit).toHaveBeenCalledWith(1);
        expect(mocks.logWorkerEvent).toHaveBeenCalledWith(
            "error",
            "worker.shutdown_forced",
            { signal: "SIGTERM" },
        );
    });

    it("forces exit at the bounded deadline when shutdown cleanup hangs", async () => {
        vi.useFakeTimers();
        mocks.stopRunWorker.mockImplementationOnce(
            () => new Promise<{ remainingInFlight: number }>(() => {}),
        );
        const signal = await loadWorkerAndGetSignal("SIGTERM");
        await vi.waitFor(() =>
            expect(mocks.startWorkflowRunWorker).toHaveBeenCalledOnce(),
        );

        signal("SIGTERM");
        await vi.advanceTimersByTimeAsync(6_000);

        expect(process.exit).toHaveBeenCalledWith(1);
        expect(mocks.logWorkerEvent).toHaveBeenCalledWith(
            "error",
            "worker.shutdown_deadline_exceeded",
            expect.objectContaining({
                signal: "SIGTERM",
                drainTimeoutMs: 1_000,
            }),
        );
    });
});
