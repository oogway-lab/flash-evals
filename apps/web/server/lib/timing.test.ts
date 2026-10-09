import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timedSpan } from "./timing";

describe("timedSpan", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    beforeEach(() => {
        infoSpy.mockClear();
        vi.stubEnv("MOSAIC_TIMING_LOGS", "true");
        delete process.env.MOSAIC_TIMING_SLOW_MS;
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("returns the wrapped value and logs safe timing fields", async () => {
        await expect(
            timedSpan("dashboard stats", async () => "ok", {
                route: "/",
                result: "cache miss",
            }),
        ).resolves.toBe("ok");

        expect(infoSpy).toHaveBeenCalledTimes(1);
        expect(infoSpy.mock.calls[0]?.[0]).toMatch(
            /^mosaic_timing span=dashboard_stats duration_ms=\d+ route=\/ result=cache_miss$/,
        );
    });

    it("logs slow spans when forced logging is disabled", async () => {
        vi.stubEnv("MOSAIC_TIMING_LOGS", "false");
        const nowSpy = vi
            .spyOn(performance, "now")
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(1000);

        await expect(timedSpan("dashboard", async () => "ok")).resolves.toBe("ok");

        expect(infoSpy).toHaveBeenCalledTimes(1);
        expect(infoSpy.mock.calls[0]?.[0]).toMatch(
            /^mosaic_timing span=dashboard duration_ms=1000$/,
        );
        nowSpy.mockRestore();
    });

    it("logs and rethrows wrapped failures", async () => {
        await expect(
            timedSpan("auth", async () => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");

        expect(infoSpy).toHaveBeenCalledTimes(1);
    });
});
