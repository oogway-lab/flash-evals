/**
 * Provider keys and provider settings come only from the app's own .env files
 * or from Settings, never from the developer's shell (e.g. ~/.zshrc): Node's
 * --env-file doesn't override a variable that is already set, so a personal
 * key would win over apps/api/.env and apps/web/.env and be billed, and a
 * shell OPENAI_BASE_URL / ANTHROPIC_BASE_URL would send a team's key to
 * another host. The SDKs also read their own variables (base URL, org,
 * project, extra headers) when the code leaves an option unset.
 */
export const SHELL_PROVIDER_ENV = [
    // Keys the app reads.
    "OPENAI_API_KEY",
    "AI_GATEWAY_API_KEY",
    "OPENROUTER_API_KEY",
    "BIFROST_API_KEY",
    "SONIOX_API_KEY",
    "ELEVENLABS_API_KEY",
    "GEMINI_API_KEY",
    // Keys the provider SDKs fall back to.
    "ANTHROPIC_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "OPENAI_ADMIN_KEY",
    "VERCEL_OIDC_TOKEN",
    // Provider settings the app reads.
    "OPENROUTER_BASE_URL",
    "BIFROST_BASE_URL",
    "FLASH_EVALS_LLM_PROVIDER",
    "FLASH_EVALS_GATEWAY_FALLBACK_MODELS",
    // Provider settings the SDKs fall back to.
    "OPENAI_BASE_URL",
    "ANTHROPIC_BASE_URL",
    "OPENAI_ORG_ID",
    "OPENAI_PROJECT_ID",
    "OPENAI_CUSTOM_HEADERS",
];

/**
 * A copy of `env` without the variables above, and the names that were set.
 * The caller then loads the app's .env files (`node --env-file...`), which
 * supply these values again for the app.
 */
export function withoutShellProviderEnv(env) {
    const copy = { ...env };
    const dropped = SHELL_PROVIDER_ENV.filter((name) => copy[name]);
    for (const name of SHELL_PROVIDER_ENV) delete copy[name];
    return { env: copy, dropped };
}

/** Whether `node` args load an env file, i.e. a local (non-platform) run. */
export function loadsEnvFile(args) {
    return args.some((arg) => arg.startsWith("--env-file"));
}
