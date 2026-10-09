import { describe, expect, it, vi } from "vitest";
import type { IDb } from "./db.js";
import { ApiRateLimitedError } from "./errors.js";
import { errorResponse } from "./middleware/errors.js";
import {
    enforceRateLimit,
    rateLimitCategoryFor,
    rateLimitPerMinute,
    rateLimitPrincipalFromRequest,
} from "./rateLimit.js";

describe("rateLimitCategoryFor", () => {
    it.each([
        ["/api/prompts/optimize", "llm"],
        ["/api/prompts/generate-schema", "llm"],
        ["/api/prompts/test-judge", "llm"],
        ["/api/prompts/test-draft", "llm"],
        ["/api/prompts/validate-runnable", "llm"],
        ["/api/runs/generate-judge", "llm"],
        ["/api/stt/probes", "llm"],
        ["/api/runs", "runs"],
        ["/api/runs/from-selection", "runs"],
        ["/api/runs/retry", "runs"],
        ["/api/workflows/wf-1/runs", "runs"],
    ])("limits POST %s as %s", (path, category) => {
        expect(rateLimitCategoryFor("POST", path)).toBe(category);
    });

    it.each([
        ["GET", "/api/workflows/wf-1/runs"],
        ["GET", "/api/stt/probes"],
        ["POST", "/api/runs/note"],
        ["POST", "/api/prompts"],
        ["POST", "/api/auth/principal"],
    ])("does not limit %s %s", (method, path) => {
        expect(rateLimitCategoryFor(method, path)).toBeUndefined();
    });
});

describe("rateLimitPerMinute", () => {
    it("uses defaults and config overrides", () => {
        expect(rateLimitPerMinute({}, "llm")).toBe(20);
        expect(rateLimitPerMinute({}, "runs")).toBe(10);
        expect(rateLimitPerMinute({ rateLimitLlmPerMinute: 5 }, "llm")).toBe(5);
        expect(rateLimitPerMinute({ rateLimitRunsPerMinute: 0 }, "runs")).toBe(
            0,
        );
    });
});

describe("enforceRateLimit", () => {
    const principal = { teamId: "team-1", userId: "user-1" };

    it("skips the database when the category is disabled", async () => {
        const db = dbWithCount(1);

        await enforceRateLimit(
            db,
            { rateLimitLlmPerMinute: 0 },
            "llm",
            principal,
        );

        expect(db.query).not.toHaveBeenCalled();
    });

    it("counts per category, team, and user in a one-minute window", async () => {
        const db = dbWithCount(1);

        await enforceRateLimit(db, {}, "llm", principal);

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("on conflict (bucket_key, window_start)"),
            ["llm:team-1:user-1", 60],
        );
    });

    it("falls back to a team-wide bucket when no user is known", async () => {
        const db = dbWithCount(1);

        await enforceRateLimit(db, {}, "runs", { teamId: "team-1" });

        expect(db.query).toHaveBeenCalledWith(expect.any(String), [
            "runs:team-1:team",
            60,
        ]);
    });

    it("allows requests up to the limit", async () => {
        await expect(
            enforceRateLimit(dbWithCount(20), {}, "llm", principal),
        ).resolves.toBeUndefined();
    });

    it("rejects the request after the limit with a retry delay", async () => {
        const rejection = enforceRateLimit(
            dbWithCount(21, 42),
            {},
            "llm",
            principal,
        );

        await expect(rejection).rejects.toBeInstanceOf(ApiRateLimitedError);
        await expect(rejection).rejects.toMatchObject({
            status: 429,
            code: "rate_limited",
            retryAfterSeconds: 42,
            message:
                "Too many AI requests: the limit is 20 per minute. Try again in 42 seconds.",
        });
    });

    it("prunes expired windows when a new window starts", async () => {
        const db = dbWithCount(1);

        await enforceRateLimit(db, {}, "llm", principal);

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("delete from api_rate_limits"),
            ["llm:team-1:user-1"],
        );
    });
});

describe("rateLimitPrincipalFromRequest", () => {
    function post(body: unknown, headers: Record<string, string> = {}) {
        return new Request("https://api.example.com/api/stt/probes", {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify(body),
        });
    }

    it("prefers trusted headers over the body", async () => {
        await expect(
            rateLimitPrincipalFromRequest(
                post(
                    { teamId: "body-team", createdBy: "body-user" },
                    {
                        "x-mosaic-team-id": "header-team",
                        "x-mosaic-actor-id": "header-user",
                    },
                ),
            ),
        ).resolves.toEqual({ teamId: "header-team", userId: "header-user" });
    });

    it("reads the user from createdBy, userId, or probedBy", async () => {
        for (const field of ["createdBy", "userId", "probedBy"]) {
            await expect(
                rateLimitPrincipalFromRequest(
                    post({ teamId: "team-1", [field]: "user-1" }),
                ),
            ).resolves.toEqual({ teamId: "team-1", userId: "user-1" });
        }
    });

    it("leaves the body readable for the route handler", async () => {
        const request = post({ teamId: "team-1" });

        await rateLimitPrincipalFromRequest(request);

        await expect(request.json()).resolves.toEqual({ teamId: "team-1" });
    });

    it("returns nothing without a team", async () => {
        await expect(
            rateLimitPrincipalFromRequest(post({ createdBy: "user-1" })),
        ).resolves.toBeUndefined();
    });
});

describe("errorResponse for rate limits", () => {
    it("returns 429 with a Retry-After header", async () => {
        const response = errorResponse(
            new ApiRateLimitedError("Slow down.", 17),
        );

        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("17");
        await expect(response.json()).resolves.toEqual({
            error: "rate_limited",
            message: "Slow down.",
        });
    });
});

function dbWithCount(requestCount: number, retryAfterSeconds = 30): IDb {
    return {
        query: vi.fn(async (sql: string) =>
            sql.includes("insert into api_rate_limits")
                ? { rows: [{ requestCount, retryAfterSeconds }] }
                : { rows: [] },
        ),
    } as unknown as IDb;
}
