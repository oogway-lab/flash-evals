import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
    load: vi.fn(async () => undefined),
    refresh: vi.fn(async () => [{ source: "openrouter", ok: true }]),
    start: vi.fn(async () => undefined),
    createQueue: vi.fn(async () => undefined),
    work: vi.fn(
        async (_name: string, _handler: () => Promise<void>) => undefined,
    ),
    schedule: vi.fn(async () => undefined),
    send: vi.fn(async () => "job"),
    offWork: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
}));
vi.mock("pg-boss", () => ({
    default: class {
        on = vi.fn();
        start = mocks.start;
        createQueue = mocks.createQueue;
        work = mocks.work;
        schedule = mocks.schedule;
        send = mocks.send;
        offWork = mocks.offWork;
        stop = mocks.stop;
    },
}));
vi.mock("@mosaic/llm-core", () => ({
    loadModelCatalog: mocks.load,
    refreshModelCatalog: mocks.refresh,
}));
vi.mock("../llm/catalog", () => ({ modelCatalogStore: {} }));
vi.mock("./workerObservability", () => ({
    logWorkerEvent: vi.fn(),
    safeWorkerError: () => ({ errorName: "Error" }),
}));

describe("daily model catalog worker", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });
    it("loads persisted data, registers one daily UTC cron, and bootstraps the first refresh", async () => {
        const {
            startModelCatalogWorker,
            stopModelCatalogWorker,
            MODEL_CATALOG_QUEUE,
            MODEL_CATALOG_CRON,
        } = await import("./modelCatalogQueue");
        await startModelCatalogWorker();
        await startModelCatalogWorker();
        expect(mocks.load).toHaveBeenCalledTimes(1);
        expect(mocks.schedule).toHaveBeenCalledWith(
            MODEL_CATALOG_QUEUE,
            MODEL_CATALOG_CRON,
            {},
            expect.objectContaining({ tz: "UTC" }),
        );
        expect(mocks.schedule).toHaveBeenCalledTimes(1);
        expect(mocks.send).toHaveBeenCalledWith(
            MODEL_CATALOG_QUEUE,
            {},
            expect.objectContaining({ singletonKey: "bootstrap" }),
        );
        await mocks.work.mock.calls[0]![1]();
        expect(mocks.refresh).toHaveBeenCalledTimes(1);
        await stopModelCatalogWorker();
        expect(mocks.offWork).toHaveBeenCalledWith(MODEL_CATALOG_QUEUE);
        expect(mocks.stop).toHaveBeenCalledWith(
            expect.objectContaining({ graceful: true }),
        );
    });
    it("fails refresh jobs for retry when a source fails, without stopping the eval worker", async () => {
        const { startModelCatalogWorker, stopModelCatalogWorker } =
            await import("./modelCatalogQueue");
        mocks.refresh.mockResolvedValueOnce([
            { source: "openrouter", ok: false },
        ]);
        await startModelCatalogWorker();
        await expect(mocks.work.mock.calls[0]![1]()).rejects.toThrow(
            "failed to refresh",
        );
        await expect(stopModelCatalogWorker()).resolves.toEqual({
            remainingInFlight: 0,
        });
    });
});
