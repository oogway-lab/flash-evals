import type { IApiConfig } from "./config.js";
import type { IDb } from "./db.js";
import { ApiRateLimitedError } from "./errors.js";

export type RateLimitCategory = "llm" | "runs";

export interface IRateLimitPrincipal {
    teamId: string;
    userId?: string;
}

type RateLimitConfig = Pick<
    IApiConfig,
    "rateLimitLlmPerMinute" | "rateLimitRunsPerMinute"
>;

const WINDOW_SECONDS = 60;

const DEFAULT_PER_MINUTE: Record<RateLimitCategory, number> = {
    llm: 20,
    runs: 10,
};

const CATEGORY_LABEL: Record<RateLimitCategory, string> = {
    llm: "AI requests",
    runs: "run requests",
};

// Endpoints that spend provider money. MCP tools call the same payload
// functions directly, so they are limited by tool name (MCP_TOOL_CATEGORY).
const LLM_PATHS = new Set([
    "/api/prompts/optimize",
    "/api/prompts/generate-schema",
    "/api/prompts/test-judge",
    "/api/prompts/test-draft",
    "/api/prompts/validate-runnable",
    "/api/runs/generate-judge",
    "/api/stt/probes",
]);

const RUN_PATHS = new Set([
    "/api/runs",
    "/api/runs/from-selection",
    "/api/runs/retry",
]);

const WORKFLOW_RUNS_PATH = /^\/api\/workflows\/[^/]+\/runs$/;

const MCP_TOOL_CATEGORY: Record<string, RateLimitCategory> = {
    generate_schema_from_prompt: "llm",
    test_prompt_draft: "llm",
    validate_runnable_prompt: "llm",
    create_runnable_prompt: "llm",
    optimize_prompt: "llm",
    test_judge_draft: "llm",
    generate_judge_for_run: "llm",
    create_stt_route_probe: "llm",
    create_eval_run: "runs",
    retry_run: "runs",
    create_workflow_run: "runs",
};

export function mcpToolRateLimitCategory(
    toolName: string,
): RateLimitCategory | undefined {
    return MCP_TOOL_CATEGORY[toolName];
}

export function rateLimitCategoryFor(
    method: string,
    pathname: string,
): RateLimitCategory | undefined {
    if (method !== "POST") return undefined;
    if (LLM_PATHS.has(pathname)) return "llm";
    if (RUN_PATHS.has(pathname) || WORKFLOW_RUNS_PATH.test(pathname))
        return "runs";
    return undefined;
}

export function rateLimitPerMinute(
    config: RateLimitConfig,
    category: RateLimitCategory,
): number {
    const configured =
        category === "llm"
            ? config.rateLimitLlmPerMinute
            : config.rateLimitRunsPerMinute;
    return configured ?? DEFAULT_PER_MINUTE[category];
}

// Fixed one-minute windows counted in Postgres, so the limit holds across API
// replicas and restarts. A limit of 0 disables the category.
export async function enforceRateLimit(
    db: IDb,
    config: RateLimitConfig,
    category: RateLimitCategory,
    principal: IRateLimitPrincipal,
): Promise<void> {
    const limit = rateLimitPerMinute(config, category);
    if (limit === 0) return;
    const bucketKey = `${category}:${principal.teamId}:${principal.userId ?? "team"}`;
    const result = await db.query<{
        requestCount: number;
        retryAfterSeconds: number;
    }>(
        `insert into api_rate_limits (bucket_key, window_start, request_count)
        values (
            $1,
            to_timestamp(floor(extract(epoch from now()) / $2) * $2),
            1
        )
        on conflict (bucket_key, window_start)
        do update set request_count = api_rate_limits.request_count + 1
        returning
            request_count as "requestCount",
            greatest(
                1,
                ceil(extract(epoch from (window_start + make_interval(secs => $2) - now())))
            )::int as "retryAfterSeconds"`,
        [bucketKey, WINDOW_SECONDS],
    );
    const row = result.rows[0];
    if (!row) return;
    if (row.requestCount === 1) {
        await db.query(
            `delete from api_rate_limits
            where bucket_key = $1
              and window_start < now() - interval '1 minute'`,
            [bucketKey],
        );
    }
    if (row.requestCount <= limit) return;
    const seconds = row.retryAfterSeconds;
    throw new ApiRateLimitedError(
        `Too many ${CATEGORY_LABEL[category]}: the limit is ${limit} per minute. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
        seconds,
    );
}

// Web calls carry the principal in trusted internal headers (behind the
// internal token) or in the JSON body. The body is read from a clone so the
// route handler can still consume it.
export async function rateLimitPrincipalFromRequest(
    request: Request,
): Promise<IRateLimitPrincipal | undefined> {
    const body = await request
        .clone()
        .json()
        .then((value: unknown) =>
            value && typeof value === "object"
                ? (value as Record<string, unknown>)
                : {},
        )
        .catch(() => ({}) as Record<string, unknown>);
    const teamId =
        request.headers.get("x-mosaic-team-id")?.trim() ||
        stringField(body.teamId);
    if (!teamId) return undefined;
    const userId =
        request.headers.get("x-mosaic-actor-id")?.trim() ||
        stringField(body.createdBy) ||
        stringField(body.userId) ||
        stringField(body.probedBy);
    return userId ? { teamId, userId } : { teamId };
}

function stringField(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
