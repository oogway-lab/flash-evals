import { describe, expect, it } from "vitest";
import { ConfigError, getApiConfig, resolveMcpOAuthConfig } from "./config.js";

const baseEnv = {
    DATABASE_URL: "postgres://user:pass@example.supabase.co:5432/postgres",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    SUPABASE_STORAGE_BUCKET: "flash-evals-images",
    CLERK_SECRET_KEY: "sk_test",
    CORS_ORIGINS: "https://web.example.com, http://localhost:3000",
    INTERNAL_API_TOKEN: "internal",
    FLASH_EVALS_ALLOWED_EMAIL_DOMAIN: "example.com",
};

describe("getApiConfig", () => {
    it("returns typed config from required env", () => {
        const config = getApiConfig({
            ...baseEnv,
            PORT: "4123",
            OPENAI_API_KEY: "sk-test",
            INTERNAL_API_TOKEN: "internal",
            SONIOX_API_KEY: "soniox-test",
            OPENROUTER_API_KEY: "openrouter-test",
            OPENROUTER_BASE_URL: "https://openrouter.example/api",
            BIFROST_API_KEY: "bifrost-test",
            BIFROST_BASE_URL: "https://bifrost.example/api",
            FLASH_EVALS_SECRETS_ENC_KEY: "encryption-key",
        });

        expect(config.port).toBe(4123);
        expect(config.databaseUrl).toBe(baseEnv.DATABASE_URL);
        expect(config.storageAdapter).toBe("supabase");
        expect(config.supabaseStorageBucket).toBe("flash-evals-images");
        expect(config.clerkSecretKey).toBe("sk_test");
        expect(config.flashEvalsAllowedEmailDomain).toBe("example.com");
        expect(config.flashEvalsLlmProvider).toBe("auto");
        expect(config.openaiApiKey).toBe("sk-test");
        expect(config.sonioxApiKey).toBe("soniox-test");
        expect(config.openrouterApiKey).toBe("openrouter-test");
        expect(config.openrouterBaseUrl).toBe("https://openrouter.example/api");
        expect(config.bifrostApiKey).toBe("bifrost-test");
        expect(config.bifrostBaseUrl).toBe("https://bifrost.example/api");
        expect(config.flashEvalsSecretsEncKey).toBe("encryption-key");
        expect(config.sttCapabilityProbes).toEqual({});
        expect(config.internalApiToken).toBe("internal");
        expect(config.profilingEnabled).toBe(false);
        expect(config.workflowLlmWritesEnabled).toBe(true);
        expect(config.flashEvalsMcpEnabled).toBe(false);
        expect(config.flashEvalsMcpAllowedOrigins).toEqual([]);
        expect(config.flashEvalsMcpRawTokenFallbackEnabled).toBe(false);
        expect(config.featureFlags).toMatchObject({
            analyticsEvents: false,
            errorTracking: false,
            profiling: false,
        });
        expect(config.corsOrigins).toEqual([
            "https://web.example.com",
            "http://localhost:3000",
        ]);
    });

    it("loads server-only R2 settings when the adapter is selected", () => {
        const config = getApiConfig({
            ...baseEnv,
            FLASH_EVALS_STORAGE_ADAPTER: "r2",
            R2_ACCOUNT_ID: "synthetic-account",
            R2_ACCESS_KEY_ID: "synthetic-access",
            R2_SECRET_ACCESS_KEY: "synthetic-secret",
            R2_BUCKET: "synthetic-media",
            R2_STORAGE_PREFIX: "tenant-media",
            R2_ENDPOINT: "http://127.0.0.1:9000",
        });

        expect(config.storageAdapter).toBe("r2");
        expect(config.r2Storage).toEqual({
            accountId: "synthetic-account",
            accessKeyId: "synthetic-access",
            secretAccessKey: "synthetic-secret",
            bucket: "synthetic-media",
            prefix: "tenant-media",
            endpoint: "http://127.0.0.1:9000",
        });
    });

    it("requires complete R2 credentials and rejects test endpoints in production", () => {
        expect(() =>
            getApiConfig({ ...baseEnv, FLASH_EVALS_STORAGE_ADAPTER: "r2" }),
        ).toThrow(
            /R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET/,
        );

        expect(() =>
            getApiConfig({
                ...baseEnv,
                NODE_ENV: "production",
                FLASH_EVALS_STORAGE_ADAPTER: "r2",
                R2_ACCOUNT_ID: "synthetic-account",
                R2_ACCESS_KEY_ID: "synthetic-access",
                R2_SECRET_ACCESS_KEY: "synthetic-secret",
                R2_BUCKET: "synthetic-media",
                R2_ENDPOINT: "http://127.0.0.1:9000",
            }),
        ).toThrow("R2_ENDPOINT is only allowed for local S3-compatible tests.");

        expect(() =>
            getApiConfig({
                ...baseEnv,
                FLASH_EVALS_STORAGE_ADAPTER: "r2",
                R2_ACCOUNT_ID: "synthetic-account",
                R2_ACCESS_KEY_ID: "synthetic-access",
                R2_SECRET_ACCESS_KEY: "synthetic-secret",
                R2_BUCKET: "synthetic-media",
                R2_ENDPOINT: "http://storage.example.test",
            }),
        ).toThrow("R2_ENDPOINT must be a loopback origin for local tests.");
    });

    it("keeps workflow LLM writes off by default in production", () => {
        const config = getApiConfig({
            ...baseEnv,
            NODE_ENV: "production",
            FLASH_EVALS_STORAGE_ADAPTER: "supabase",
            INTERNAL_API_TOKEN: "internal",
        });
        expect(config.workflowLlmWritesEnabled).toBe(false);
    });

    it("parses STT capability probe overrides", () => {
        const config = getApiConfig({
            ...baseEnv,
            FLASH_EVALS_STT_CAPABILITY_PROBES: JSON.stringify({
                "vercel:openai/whisper-1": {
                    status: "available",
                },
                "vercel:openai/gpt-4o-transcribe": {
                    status: "provider_error",
                    reason: "Beta access is not enabled for this account.",
                },
            }),
        });

        expect(config.sttCapabilityProbes).toEqual({
            "vercel:openai/whisper-1": { status: "available" },
            "vercel:openai/gpt-4o-transcribe": {
                status: "provider_error",
                reason: "Beta access is not enabled for this account.",
            },
        });
    });

    it("rejects invalid STT capability probe JSON", () => {
        expect(() =>
            getApiConfig({
                ...baseEnv,
                FLASH_EVALS_STT_CAPABILITY_PROBES: "{",
            }),
        ).toThrowError(
            new ConfigError(
                "FLASH_EVALS_STT_CAPABILITY_PROBES must be valid JSON",
            ),
        );
    });

    it("rejects unsupported STT capability probe statuses", () => {
        expect(() =>
            getApiConfig({
                ...baseEnv,
                FLASH_EVALS_STT_CAPABILITY_PROBES: JSON.stringify({
                    "vercel:openai/whisper-1": { status: "unknown" },
                }),
            }),
        ).toThrowError(
            new ConfigError(
                "FLASH_EVALS_STT_CAPABILITY_PROBES.vercel:openai/whisper-1.status is not supported",
            ),
        );
    });

    it("enables optional observability providers and flags from env", () => {
        const config = getApiConfig({
            ...baseEnv,
            FLASH_EVALS_ERROR_TRACKING_DSN: "https://errors.example",
            FLASH_EVALS_ANALYTICS_KEY: "analytics-key",
            FLASH_EVALS_ALERT_WEBHOOK_URL: "https://alerts.example",
            FLASH_EVALS_PROFILING_ENABLED: "true",
            FLASH_EVALS_FLAG_ANALYTICS_EVENTS: "on",
            FLASH_EVALS_FLAG_ERROR_TRACKING: "true",
            FLASH_EVALS_FLAG_PROFILING: "yes",
            FLASH_EVALS_MCP_ENABLED: "true",
            FLASH_EVALS_MCP_ALLOWED_ORIGINS: "https://claude.example.com",
            FLASH_EVALS_MCP_RESOURCE_URL: "https://api.example.com/mcp",
            FLASH_EVALS_MCP_OAUTH_CLIENT_ID: "oauth-client",
            FLASH_EVALS_MCP_RAW_TOKEN_FALLBACK_ENABLED: "true",
            FLASH_EVALS_MCP_TOKEN_PEPPER: "pepper",
            CLERK_PUBLISHABLE_KEY: "pk_test",
            CLERK_ISSUER: "https://clerk.example.com",
            CLERK_JWT_KEY:
                "-----BEGIN PUBLIC KEY-----\\nkey\\n-----END PUBLIC KEY-----",
            CLERK_AUTHORIZED_PARTIES: "https://claude.example.com",
        });

        expect(config.errorTrackingDsn).toBe("https://errors.example");
        expect(config.analyticsKey).toBe("analytics-key");
        expect(config.alertWebhookUrl).toBe("https://alerts.example");
        expect(config.profilingEnabled).toBe(true);
        expect(config.flashEvalsMcpEnabled).toBe(true);
        expect(config.flashEvalsMcpAllowedOrigins).toEqual([
            "https://claude.example.com",
        ]);
        expect(config.flashEvalsMcpResourceUrl).toBe(
            "https://api.example.com/mcp",
        );
        expect(config.flashEvalsMcpOAuthClientId).toBe("oauth-client");
        expect(config.flashEvalsMcpRawTokenFallbackEnabled).toBe(true);
        expect(config.flashEvalsMcpTokenPepper).toBe("pepper");
        expect(config.clerkPublishableKey).toBe("pk_test");
        expect(config.clerkIssuer).toBe("https://clerk.example.com");
        expect(config.clerkJwtKey).toContain("\nkey\n");
        expect(config.clerkAuthorizedParties).toEqual([
            "https://claude.example.com",
        ]);
        expect(config.featureFlags).toMatchObject({
            analyticsEvents: true,
            errorTracking: true,
            profiling: true,
        });
    });

    it("normalizes allowed email domain", () => {
        const config = getApiConfig({
            ...baseEnv,
            FLASH_EVALS_ALLOWED_EMAIL_DOMAIN: "@EXAMPLE.COM ",
        });

        expect(config.flashEvalsAllowedEmailDomain).toBe("example.com");
    });

    it("refuses to start without an allowed email domain", () => {
        for (const domain of [undefined, "", "  ", "@"]) {
            expect(() =>
                getApiConfig({
                    ...baseEnv,
                    FLASH_EVALS_ALLOWED_EMAIL_DOMAIN: domain,
                }),
            ).toThrow(
                "Missing required API env: FLASH_EVALS_ALLOWED_EMAIL_DOMAIN",
            );
        }
    });

    it("allows a missing email domain only with the insecure opt-in", () => {
        const config = getApiConfig({
            ...baseEnv,
            FLASH_EVALS_ALLOWED_EMAIL_DOMAIN: undefined,
            FLASH_EVALS_ALLOW_INSECURE_DEV_DEFAULTS: "true",
        });

        expect(config.flashEvalsAllowedEmailDomain).toBe("");
    });

    it("defaults to single-org tenancy", () => {
        const config = getApiConfig(baseEnv);
        expect(config.flashEvalsTenancyMode).toBe("single-org");
    });

    it("rejects an unknown tenancy mode", () => {
        expect(() =>
            getApiConfig({ ...baseEnv, FLASH_EVALS_TENANCY_MODE: "multi-org" }),
        ).toThrow('Invalid FLASH_EVALS_TENANCY_MODE value "multi-org"');
    });

    it("does not require an allowed email domain in isolated mode", () => {
        const config = getApiConfig({
            ...baseEnv,
            FLASH_EVALS_TENANCY_MODE: "isolated",
            FLASH_EVALS_ALLOWED_EMAIL_DOMAIN: undefined,
        });

        expect(config.flashEvalsTenancyMode).toBe("isolated");
        expect(config.flashEvalsAllowedEmailDomain).toBe("");
    });

    it("refuses a public email provider as the single-org allowed domain", () => {
        expect(() =>
            getApiConfig({
                ...baseEnv,
                FLASH_EVALS_ALLOWED_EMAIL_DOMAIN: "gmail.com",
            }),
        ).toThrow(/is a public email/);
    });

    it("allows a public email provider with the explicit override", () => {
        const config = getApiConfig({
            ...baseEnv,
            FLASH_EVALS_ALLOWED_EMAIL_DOMAIN: "gmail.com",
            FLASH_EVALS_ALLOW_PUBLIC_EMAIL_DOMAIN: "true",
        });

        expect(config.flashEvalsAllowedEmailDomain).toBe("gmail.com");
    });

    it("ignores the public-domain guard in isolated mode", () => {
        const config = getApiConfig({
            ...baseEnv,
            FLASH_EVALS_TENANCY_MODE: "isolated",
            FLASH_EVALS_ALLOWED_EMAIL_DOMAIN: "gmail.com",
        });

        expect(config.flashEvalsTenancyMode).toBe("isolated");
    });

    it("defaults run limits to a cell cap and no spend cap", () => {
        const config = getApiConfig(baseEnv);

        expect(config.maxRunCells).toBe(10_000);
        expect(config.teamDailySpendCapUsd).toBeUndefined();
    });

    it("parses run limit overrides", () => {
        const config = getApiConfig({
            ...baseEnv,
            FLASH_EVALS_MAX_RUN_CELLS: "2500",
            FLASH_EVALS_TEAM_DAILY_SPEND_CAP_USD: "25.50",
        });

        expect(config.maxRunCells).toBe(2500);
        expect(config.teamDailySpendCapUsd).toBe(25.5);
    });

    it("rejects invalid run limits", () => {
        for (const value of ["0", "-1", "1.5", "abc", "16001"]) {
            expect(() =>
                getApiConfig({ ...baseEnv, FLASH_EVALS_MAX_RUN_CELLS: value }),
            ).toThrow(
                "FLASH_EVALS_MAX_RUN_CELLS must be an integer between 1 and 16000",
            );
        }
        for (const value of ["0", "-5", "abc", "Infinity"]) {
            expect(() =>
                getApiConfig({
                    ...baseEnv,
                    FLASH_EVALS_TEAM_DAILY_SPEND_CAP_USD: value,
                }),
            ).toThrow(
                "FLASH_EVALS_TEAM_DAILY_SPEND_CAP_USD must be a positive number",
            );
        }
    });

    it("parses rate limit overrides and leaves them unset by default", () => {
        expect(getApiConfig(baseEnv)).toMatchObject({
            rateLimitLlmPerMinute: undefined,
            rateLimitRunsPerMinute: undefined,
        });
        expect(
            getApiConfig({
                ...baseEnv,
                FLASH_EVALS_RATE_LIMIT_LLM_PER_MINUTE: "5",
                FLASH_EVALS_RATE_LIMIT_RUNS_PER_MINUTE: "0",
            }),
        ).toMatchObject({
            rateLimitLlmPerMinute: 5,
            rateLimitRunsPerMinute: 0,
        });
    });

    it("rejects invalid rate limits", () => {
        for (const value of ["-1", "1.5", "abc"]) {
            expect(() =>
                getApiConfig({
                    ...baseEnv,
                    FLASH_EVALS_RATE_LIMIT_LLM_PER_MINUTE: value,
                }),
            ).toThrow(
                "FLASH_EVALS_RATE_LIMIT_LLM_PER_MINUTE must be a non-negative integer (0 disables it)",
            );
        }
    });

    it("parses Gateway provider mode", () => {
        const config = getApiConfig({
            ...baseEnv,
            FLASH_EVALS_LLM_PROVIDER: "gateway",
            AI_GATEWAY_API_KEY: "vck-test",
        });

        expect(config.flashEvalsLlmProvider).toBe("gateway");
        expect(config.aiGatewayApiKey).toBe("vck-test");
    });

    it("parses OpenRouter and Bifrost provider modes", () => {
        expect(
            getApiConfig({
                ...baseEnv,
                FLASH_EVALS_LLM_PROVIDER: "openrouter",
                OPENROUTER_API_KEY: "or-test",
            }).flashEvalsLlmProvider,
        ).toBe("openrouter");

        expect(
            getApiConfig({
                ...baseEnv,
                FLASH_EVALS_LLM_PROVIDER: "bifrost",
                BIFROST_API_KEY: "bf-test",
                BIFROST_BASE_URL: "https://bifrost.example/v1",
            }).flashEvalsLlmProvider,
        ).toBe("bifrost");
    });

    it("fails loudly when DATABASE_URL is missing", () => {
        expect(() =>
            getApiConfig({ ...baseEnv, DATABASE_URL: undefined }),
        ).toThrowError(
            new ConfigError("Missing required API env: DATABASE_URL"),
        );
    });

    it("starts local development without Clerk credentials", () => {
        expect(
            getApiConfig({
                DATABASE_URL: baseEnv.DATABASE_URL,
                INTERNAL_API_TOKEN: "local-token",
                FLASH_EVALS_ALLOW_INSECURE_DEV_DEFAULTS: "true",
            }),
        ).toMatchObject({ storageAdapter: "local", clerkSecretKey: "" });
    });

    it.each([undefined, "development", "production"])(
        "requires Clerk credentials without local opt-in (%s)",
        (nodeEnv) => {
            expect(() =>
                getApiConfig({
                    ...baseEnv,
                    NODE_ENV: nodeEnv,
                    CLERK_SECRET_KEY: undefined,
                }),
            ).toThrow("Missing required API env: CLERK_SECRET_KEY");
        },
    );

    it("requires Supabase storage env in production", () => {
        expect(() =>
            getApiConfig({
                ...baseEnv,
                NODE_ENV: "production",
                INTERNAL_API_TOKEN: "internal",
                SUPABASE_URL: undefined,
            }),
        ).toThrowError(
            new ConfigError("Missing required API env: SUPABASE_URL"),
        );
    });

    it("defaults to Supabase storage when NODE_ENV is unset", () => {
        expect(() =>
            getApiConfig({ ...baseEnv, SUPABASE_URL: undefined }),
        ).toThrowError(
            new ConfigError("Missing required API env: SUPABASE_URL"),
        );
    });

    it("allows local storage without Supabase env only with the insecure opt-in", () => {
        const localEnv = {
            DATABASE_URL: baseEnv.DATABASE_URL,
            CLERK_SECRET_KEY: "sk_test",
            INTERNAL_API_TOKEN: "internal",
            FLASH_EVALS_ALLOWED_EMAIL_DOMAIN: "example.com",
        };

        expect(
            getApiConfig({
                ...localEnv,
                FLASH_EVALS_ALLOW_INSECURE_DEV_DEFAULTS: "true",
            }),
        ).toMatchObject({ storageAdapter: "local", supabaseUrl: "" });
        expect(() =>
            getApiConfig({ ...localEnv, FLASH_EVALS_STORAGE_ADAPTER: "local" }),
        ).toThrowError(
            new ConfigError(
                "FLASH_EVALS_STORAGE_ADAPTER=local requires FLASH_EVALS_ALLOW_INSECURE_DEV_DEFAULTS=true",
            ),
        );
    });

    it("rejects the insecure opt-in in production", () => {
        expect(() =>
            getApiConfig({
                ...baseEnv,
                NODE_ENV: "production",
                FLASH_EVALS_STORAGE_ADAPTER: "local",
                FLASH_EVALS_ALLOW_INSECURE_DEV_DEFAULTS: "true",
            }),
        ).toThrowError(
            new ConfigError(
                "FLASH_EVALS_ALLOW_INSECURE_DEV_DEFAULTS cannot be enabled when NODE_ENV=production",
            ),
        );
    });

    it("requires CORS origins in production", () => {
        expect(() =>
            getApiConfig({
                ...baseEnv,
                NODE_ENV: "production",
                CORS_ORIGINS: "",
            }),
        ).toThrowError(
            new ConfigError("Missing required API env: CORS_ORIGINS"),
        );
    });

    it.each([undefined, "development", "production"])(
        "requires internal API token when NODE_ENV is %s",
        (nodeEnv) => {
            expect(() =>
                getApiConfig({
                    ...baseEnv,
                    NODE_ENV: nodeEnv,
                    INTERNAL_API_TOKEN: "",
                    FLASH_EVALS_ALLOW_INSECURE_DEV_DEFAULTS: "true",
                }),
            ).toThrowError(
                new ConfigError("Missing required API env: INTERNAL_API_TOKEN"),
            );
        },
    );

    it("rejects invalid ports", () => {
        expect(() => getApiConfig({ ...baseEnv, PORT: "nope" })).toThrowError(
            new ConfigError("PORT must be an integer between 1 and 65535"),
        );
    });

    it("rejects invalid provider modes", () => {
        expect(() =>
            getApiConfig({ ...baseEnv, FLASH_EVALS_LLM_PROVIDER: "other" }),
        ).toThrowError(
            new ConfigError(
                'Invalid FLASH_EVALS_LLM_PROVIDER value "other". Expected one of: auto, vercel-ai, openai, gateway, openrouter, bifrost.',
            ),
        );
    });

    it("resolves MCP OAuth config only when required env is complete", () => {
        const config = getApiConfig({
            ...baseEnv,
            FLASH_EVALS_MCP_ENABLED: "true",
            FLASH_EVALS_MCP_RESOURCE_URL: "http://127.0.0.1:3001/mcp",
            FLASH_EVALS_MCP_OAUTH_CLIENT_ID: "oauth-client",
            CLERK_ISSUER: "https://clerk.example.com",
            CLERK_PUBLISHABLE_KEY: "pk_test",
            CLERK_JWT_KEY: "jwt-key",
        });

        expect(resolveMcpOAuthConfig(config)).toMatchObject({
            resourceUrl: "http://127.0.0.1:3001/mcp",
            issuer: "https://clerk.example.com",
            secretKey: "sk_test",
            publishableKey: "pk_test",
            jwtKey: "jwt-key",
            clientId: "oauth-client",
            dynamicClients: false,
        });
    });

    it("fails closed when MCP OAuth is partially configured", () => {
        expect(() =>
            getApiConfig({
                ...baseEnv,
                FLASH_EVALS_MCP_ENABLED: "true",
                FLASH_EVALS_MCP_RESOURCE_URL: "https://api.example.com/mcp",
                CLERK_ISSUER: "https://clerk.example.com",
            }),
        ).toThrowError(/Missing required MCP OAuth env/);
    });

    it("rejects raw MCP token fallback in production", () => {
        expect(() =>
            getApiConfig({
                ...baseEnv,
                NODE_ENV: "production",
                INTERNAL_API_TOKEN: "internal",
                FLASH_EVALS_MCP_RAW_TOKEN_FALLBACK_ENABLED: "true",
            }),
        ).toThrowError(
            new ConfigError(
                "FLASH_EVALS_MCP_RAW_TOKEN_FALLBACK_ENABLED cannot be enabled in production.",
            ),
        );
    });

    it("requires HTTPS MCP resource URLs in production", () => {
        expect(() =>
            getApiConfig({
                ...baseEnv,
                NODE_ENV: "production",
                INTERNAL_API_TOKEN: "internal",
                FLASH_EVALS_MCP_ENABLED: "true",
                FLASH_EVALS_MCP_RESOURCE_URL: "http://api.example.com/mcp",
                FLASH_EVALS_MCP_OAUTH_CLIENT_ID: "oauth-client",
                CLERK_ISSUER: "https://clerk.example.com",
                CLERK_PUBLISHABLE_KEY: "pk_live",
                CLERK_JWT_KEY: "jwt-key",
            }),
        ).toThrowError(
            new ConfigError(
                "FLASH_EVALS_MCP_RESOURCE_URL must use https in production.",
            ),
        );
    });
});

describe("private development bind address", () => {
    it("accepts loopback and Tailscale IPv4 listeners", () => {
        for (const host of ["127.0.0.1", "100.64.0.10"]) {
            expect(
                getApiConfig({ ...baseEnv, FLASH_EVALS_API_BIND_HOST: host })
                    .bindHost,
            ).toBe(host);
        }
    });
    it("rejects wildcard, public, and non-Tailscale network listeners", () => {
        for (const host of [
            "0.0.0.0",
            "8.8.8.8",
            "100.63.255.255",
            "100.128.0.1",
            "192.168.1.2",
            "localhost",
        ]) {
            expect(() =>
                getApiConfig({ ...baseEnv, FLASH_EVALS_API_BIND_HOST: host }),
            ).toThrow("loopback or Tailscale IPv4");
        }
    });
});
