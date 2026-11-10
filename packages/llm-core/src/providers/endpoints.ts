/**
 * Each provider client is built with its address spelled out. The SDKs fall
 * back to OPENAI_BASE_URL / ANTHROPIC_BASE_URL (and OpenAI's org and project
 * ids) from the process environment, so a value exported in a developer's
 * shell could send a team's key and data to another host while the run still
 * records the maker as the host that served it.
 */
export const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
export const ANTHROPIC_API_BASE_URL = "https://api.anthropic.com/v1";

/**
 * Options for `new OpenAI(...)` that never read the environment: the given
 * address (OpenAI's own when none), no organization or project header, and
 * no admin key. The SDK always adds headers from OPENAI_CUSTOM_HEADERS (no
 * option turns that off), and the app never sets it, so it is removed from
 * the process environment before a client is built; scripts that don't go
 * through the launcher's stripping are covered too.
 */
export function openAIClientEndpoint(baseURL: string | undefined): {
    baseURL: string;
    organization: null;
    project: null;
    adminAPIKey: null;
} {
    const env = (
        globalThis as {
            process?: { env?: Record<string, string | undefined> };
        }
    ).process?.env;
    if (env) delete env.OPENAI_CUSTOM_HEADERS;
    return {
        baseURL: baseURL ?? OPENAI_API_BASE_URL,
        organization: null,
        project: null,
        adminAPIKey: null,
    };
}
