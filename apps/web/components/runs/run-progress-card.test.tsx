import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
// Stable like Next's router; a new object per render would restart polling.
const router = { refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { RunProgressCard } from "./run-progress-card";
import {
    MAX_POLL_INTERVAL_MS,
    POLL_INTERVAL_MS,
    REFRESH_INTERVAL_MS,
    nextPollDelay,
    progressPercent,
    shouldRefresh,
    type IRunProgressSnapshot,
} from "./use-run-progress";

const running: IRunProgressSnapshot = {
    status: "running",
    total: 10,
    done: 2,
    failed: 0,
    pending: 8,
};

function jsonResponse(body: unknown, ok = true) {
    return { ok, status: ok ? 200 : 502, json: async () => body } as Response;
}

let hidden = false;

beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockReset();
    hidden = false;
    Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => hidden,
    });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

async function tick(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

describe("progress helpers", () => {
    it("computes a whole percentage and treats total=0 as 0%", () => {
        expect(progressPercent(0, 0)).toBe(0);
        expect(progressPercent(2, 3)).toBe(67);
    });

    it("backs off exponentially up to a cap", () => {
        expect(nextPollDelay(0)).toBe(POLL_INTERVAL_MS);
        expect(nextPollDelay(1)).toBe(POLL_INTERVAL_MS * 2);
        expect(nextPollDelay(10)).toBe(MAX_POLL_INTERVAL_MS);
    });

    it("counts failed cells as progress, so failures also refresh the tables", () => {
        expect(
            shouldRefresh({
                next: { ...running, done: 2, failed: 1 },
                lastRefreshedSettled: 2,
                lastRefreshAt: 0,
                now: REFRESH_INTERVAL_MS,
            }),
        ).toBe(true);
    });

    it("refreshes on completion, or while cells settle but at most every interval", () => {
        const base = { lastRefreshedSettled: 2, lastRefreshAt: 0 };
        expect(
            shouldRefresh({
                ...base,
                next: { ...running, done: 3 },
                now: 5_000,
            }),
        ).toBe(false);
        expect(
            shouldRefresh({
                ...base,
                next: { ...running, done: 3 },
                now: REFRESH_INTERVAL_MS,
            }),
        ).toBe(true);
        expect(
            shouldRefresh({ ...base, next: running, now: REFRESH_INTERVAL_MS }),
        ).toBe(false);
        expect(
            shouldRefresh({
                ...base,
                next: { ...running, status: "completed" },
                now: 1,
            }),
        ).toBe(true);
    });
});

describe("RunProgressCard", () => {
    it("shows done / total and a percentage in a polite live region", () => {
        vi.stubGlobal("fetch", vi.fn());
        render(<RunProgressCard progressUrl="/p" initial={running} />);
        const summary = screen.getByText(/2 \/ 10 cells complete · 20%/);
        expect(summary).toHaveAttribute("aria-live", "polite");
        expect(summary).toHaveClass("tabular-nums");
        expect(screen.getByText("Updating live")).toBeInTheDocument();
    });

    it("uses the indeterminate bar while an active run has no cells yet", () => {
        vi.stubGlobal("fetch", vi.fn());
        render(
            <RunProgressCard
                progressUrl="/p"
                initial={{ ...running, status: "pending", total: 0, done: 0 }}
            />,
        );
        expect(screen.getByRole("progressbar")).toHaveAttribute(
            "data-indeterminate",
        );
    });

    it("polls, refreshes as cells complete, and stops once the run finishes", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse({ ...running, done: 5 }))
            .mockResolvedValueOnce(
                jsonResponse({ ...running, status: "completed", done: 10 }),
            );
        vi.stubGlobal("fetch", fetchMock);
        render(<RunProgressCard progressUrl="/p" initial={running} />);

        await tick(POLL_INTERVAL_MS);
        expect(
            screen.getByText(/5 \/ 10 cells complete · 50%/),
        ).toBeInTheDocument();
        // First advance refreshes straight away; later ones are throttled.
        expect(refresh).toHaveBeenCalledTimes(1);

        await tick(POLL_INTERVAL_MS);
        expect(
            screen.getByText(/10 \/ 10 cells complete · 100%/),
        ).toBeInTheDocument();
        expect(refresh).toHaveBeenCalledTimes(2);
        expect(screen.queryByText("Updating live")).not.toBeInTheDocument();

        await tick(POLL_INTERVAL_MS * 5);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("shows Reconnecting… on failures, backs off, and recovers", async () => {
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new TypeError("fetch failed"))
            .mockResolvedValueOnce(jsonResponse({}, false))
            .mockResolvedValueOnce(jsonResponse({ ...running, done: 4 }));
        vi.stubGlobal("fetch", fetchMock);
        render(<RunProgressCard progressUrl="/p" initial={running} />);

        await tick(POLL_INTERVAL_MS);
        expect(screen.getByText("Reconnecting…")).toBeInTheDocument();

        // Second attempt waits 2× the base interval.
        await tick(POLL_INTERVAL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await tick(POLL_INTERVAL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        // Third attempt waits 4×, then succeeds.
        await tick(POLL_INTERVAL_MS * 4);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(screen.getByText("Updating live")).toBeInTheDocument();
        expect(screen.getByText(/4 \/ 10 cells complete/)).toBeInTheDocument();
    });

    it("pauses while the tab is hidden and polls again when it returns", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(jsonResponse({ ...running, done: 3 }));
        vi.stubGlobal("fetch", fetchMock);
        render(<RunProgressCard progressUrl="/p" initial={running} />);

        hidden = true;
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        expect(screen.getByText("Updates paused")).toBeInTheDocument();
        await tick(POLL_INTERVAL_MS * 5);
        expect(fetchMock).not.toHaveBeenCalled();

        hidden = false;
        await act(async () => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        await tick(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(screen.getByText("Updating live")).toBeInTheDocument();
    });

    it("keeps showing Updates paused when a poll resolves after the tab is hidden", async () => {
        let finish!: (value: Response) => void;
        const fetchMock = vi
            .fn()
            .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
            .mockRejectedValueOnce(new TypeError("fetch failed"));
        vi.stubGlobal("fetch", fetchMock);
        render(<RunProgressCard progressUrl="/p" initial={running} />);

        await tick(POLL_INTERVAL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        hidden = true;
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });
        await act(async () => finish(jsonResponse({ ...running, done: 3 })));

        expect(screen.getByText("Updates paused")).toBeInTheDocument();
        expect(screen.getByText(/3 \/ 10 cells complete/)).toBeInTheDocument();
        await tick(POLL_INTERVAL_MS * 5);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("stays paused when the server re-renders while the tab is hidden", () => {
        vi.stubGlobal("fetch", vi.fn());
        const { rerender } = render(
            <RunProgressCard progressUrl="/p" initial={running} />,
        );
        hidden = true;
        act(() => {
            document.dispatchEvent(new Event("visibilitychange"));
        });

        rerender(
            <RunProgressCard
                progressUrl="/p"
                initial={{ ...running, done: 4 }}
            />,
        );
        expect(screen.getByText("Updates paused")).toBeInTheDocument();
        expect(screen.getByText(/4 \/ 10 cells complete/)).toBeInTheDocument();
    });

    it("re-syncs when the server re-renders with newer progress", () => {
        vi.stubGlobal("fetch", vi.fn());
        const { rerender } = render(
            <RunProgressCard
                progressUrl="/p"
                initial={{ ...running, status: "completed", done: 10 }}
            />,
        );
        expect(screen.queryByText("Updating live")).not.toBeInTheDocument();

        // e.g. "Retry failed cells" restarted the run
        rerender(<RunProgressCard progressUrl="/p" initial={running} />);
        expect(screen.getByText("Updating live")).toBeInTheDocument();
        expect(screen.getByText(/2 \/ 10 cells complete/)).toBeInTheDocument();
    });
});
