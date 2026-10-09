import { describe, expect, it, vi } from "vitest";
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import { ApiForbiddenError } from "../errors.js";
import { resolveApiFeatureFlags } from "../featureFlags.js";
import { resolvePrincipalPayload } from "./auth.js";

const config: IApiConfig = {
    nodeEnv: "test",
    port: 3001,
    databaseUrl: "postgres://example",
    storageAdapter: "supabase",
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role",
    supabaseStorageBucket: "mosaic-images",
    clerkSecretKey: "sk_test",
    mosaicTenancyMode: "single-org",
    mosaicAllowedEmailDomain: "example.com",
    mosaicDefaultTeamId: "11111111-1111-4111-8111-111111111111",
    mosaicLlmProvider: "openai",
    corsOrigins: [],
    sttCapabilityProbes: {},
    profilingEnabled: false,
    featureFlags: resolveApiFeatureFlags({}),
};

function dbWithRows(rows: unknown[][]): IDb {
    return {
        query: vi.fn(async () => ({ rows: rows.shift() ?? [] }) as never),
    };
}

describe("resolvePrincipalPayload", () => {
    it("creates a default workspace and project in the canonical tenant", async () => {
        const db = dbWithRows([
            [],
            [],
            [],
            [],
            [
                {
                    id: "user-1",
                    clerk_user_id: "clerk-1",
                    team_id: config.mosaicDefaultTeamId,
                    email: "alice@example.com",
                    name: "Alice",
                },
            ],
            [{ id: "workspace-1" }],
            [],
            [{ id: "project-default" }],
        ]);

        await expect(
            resolvePrincipalPayload(db, config, {
                identity: {
                    clerkUserId: "clerk-1",
                    email: " Alice@Example.com ",
                    emailVerified: true,
                    name: "Alice",
                },
            }),
        ).resolves.toEqual({
            userId: "user-1",
            teamId: config.mosaicDefaultTeamId,
            defaultWorkspaceId: "workspace-1",
        });
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("insert into workspaces"),
            [
                config.mosaicDefaultTeamId,
                "Alice's workspace (user-1)",
                "user-1",
            ],
        );
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("insert into projects"),
            [config.mosaicDefaultTeamId, "workspace-1", "user-1"],
        );
    });

    it("rejects unverified or disallowed identities before querying", async () => {
        const db = dbWithRows([]);

        await expect(
            resolvePrincipalPayload(db, config, {
                identity: {
                    clerkUserId: "clerk-1",
                    email: "alice@example.com",
                    emailVerified: false,
                },
            }),
        ).rejects.toBeInstanceOf(ApiForbiddenError);
        await expect(
            resolvePrincipalPayload(db, config, {
                identity: {
                    clerkUserId: "clerk-2",
                    email: "alice@not-allowed.example",
                    emailVerified: true,
                },
            }),
        ).rejects.toBeInstanceOf(ApiForbiddenError);
        expect(db.query).not.toHaveBeenCalled();
    });

    it("denies every email when no allowed domain is configured", async () => {
        const db = dbWithRows([]);

        await expect(
            resolvePrincipalPayload(
                db,
                { ...config, mosaicAllowedEmailDomain: "" },
                {
                    identity: {
                        clerkUserId: "clerk-1",
                        email: "alice@example.com",
                        emailVerified: true,
                    },
                },
            ),
        ).rejects.toThrow(
            "Sign-in is disabled until MOSAIC_ALLOWED_EMAIL_DOMAIN is configured.",
        );
        expect(db.query).not.toHaveBeenCalled();
    });

    it("requires MOSAIC_DEFAULT_TEAM_ID for new users", async () => {
        const db = dbWithRows([
            [],
            [],
            [],
            [],
            [{ id: "team-personal" }],
            [
                {
                    id: "user-1",
                    clerk_user_id: "clerk-1",
                    team_id: "team-personal",
                    email: "alice@example.com",
                    name: null,
                },
            ],
            [],
            [{ id: "project-default" }],
        ]);

        await expect(
            resolvePrincipalPayload(
                db,
                { ...config, mosaicDefaultTeamId: undefined },
                {
                    identity: {
                        clerkUserId: "clerk-1",
                        email: "alice@example.com",
                        emailVerified: true,
                    },
                },
            ),
        ).rejects.toThrow("Flash Evals tenant configuration is missing");
    });

    it("returns an existing canonical Clerk user with its default workspace", async () => {
        const db = dbWithRows([
            [
                {
                    id: "user-existing",
                    clerk_user_id: "clerk-1",
                    team_id: config.mosaicDefaultTeamId,
                    email: "alice@example.com",
                    name: "Alice",
                    default_workspace_id: "workspace-existing",
                },
            ],
        ]);
        await expect(
            resolvePrincipalPayload(db, config, {
                identity: {
                    clerkUserId: "clerk-1",
                    email: "alice@example.com",
                    emailVerified: true,
                    name: "Alice",
                },
            }),
        ).resolves.toEqual({
            userId: "user-existing",
            teamId: config.mosaicDefaultTeamId,
            defaultWorkspaceId: "workspace-existing",
        });
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("links an existing canonical email user without creating a workspace", async () => {
        const existing = {
            id: "user-existing",
            clerk_user_id: null,
            team_id: config.mosaicDefaultTeamId,
            email: "alice@example.com",
            name: "Alice",
            default_workspace_id: "workspace-existing",
        };
        const db = dbWithRows([
            [],
            [existing],
            [{ ...existing, clerk_user_id: "clerk-1" }],
            [{ ...existing, clerk_user_id: "clerk-1" }],
        ]);

        await expect(
            resolvePrincipalPayload(db, config, {
                identity: {
                    clerkUserId: "clerk-1",
                    email: "alice@example.com",
                    emailVerified: true,
                    name: "Alice",
                },
            }),
        ).resolves.toEqual({
            userId: "user-existing",
            teamId: config.mosaicDefaultTeamId,
            defaultWorkspaceId: "workspace-existing",
        });
        expect(db.query).toHaveBeenCalledTimes(4);
        expect(db.query).not.toHaveBeenCalledWith(
            expect.stringContaining("insert into teams"),
            expect.anything(),
        );
    });

    it("serializes concurrent first sign-in into one identity and workspace", async () => {
        let user: Record<string, unknown> | undefined;
        let teamsCreated = 0;
        let projectsCreated = 0;
        let tail = Promise.resolve();
        const query = vi.fn(async (sql: string, values: unknown[] = []) => {
            if (sql.includes("pg_advisory_xact_lock"))
                return { rows: [] } as never;
            if (sql.includes("where clerk_user_id")) {
                return {
                    rows: user?.clerk_user_id === values[0] ? [user] : [],
                } as never;
            }
            if (sql.includes("where email =")) {
                return {
                    rows: user?.email === values[0] ? [user] : [],
                } as never;
            }
            if (sql.includes("insert into workspaces")) {
                teamsCreated += 1;
                return { rows: [{ id: `workspace-${teamsCreated}` }] } as never;
            }
            if (sql.includes("insert into users")) {
                user = {
                    id: "user-1",
                    clerk_user_id: values[0],
                    team_id: values[1],
                    email: values[2],
                    name: values[3],
                };
                return { rows: [user] } as never;
            }
            if (sql.includes("update users set default_workspace_id")) {
                user = { ...user!, default_workspace_id: values[0] };
                return { rows: [] } as never;
            }
            if (sql.includes("insert into projects")) {
                projectsCreated += 1;
                return { rows: [{ id: "project-1" }] } as never;
            }
            return { rows: [] } as never;
        });
        const db = {
            query,
            transaction: <T>(run: (tx: IDb) => Promise<T>): Promise<T> => {
                const result = tail.then(() => run({ query } as IDb));
                tail = result.then(
                    () => undefined,
                    () => undefined,
                );
                return result;
            },
        } as IDb;
        const request = {
            identity: {
                clerkUserId: "clerk-race",
                email: "race@example.com",
                emailVerified: true,
                name: "Race",
            },
        };

        const principals = await Promise.all([
            resolvePrincipalPayload(db, config, request),
            resolvePrincipalPayload(db, config, request),
        ]);

        expect(principals).toEqual([
            {
                userId: "user-1",
                teamId: config.mosaicDefaultTeamId,
                defaultWorkspaceId: "workspace-1",
            },
            {
                userId: "user-1",
                teamId: config.mosaicDefaultTeamId,
                defaultWorkspaceId: "workspace-1",
            },
        ]);
        expect(teamsCreated).toBe(1);
        expect(projectsCreated).toBe(1);
    });
});

describe("resolvePrincipalPayload in isolated tenancy mode", () => {
    const isolatedConfig: IApiConfig = {
        ...config,
        mosaicTenancyMode: "isolated",
        mosaicAllowedEmailDomain: "",
        mosaicDefaultTeamId: undefined,
    };

    it("gives a brand-new signup its own team, regardless of email domain", async () => {
        const db = dbWithRows([
            [],
            [],
            [],
            [],
            [{ id: "team-1" }],
            [
                {
                    id: "user-1",
                    clerk_user_id: "clerk-1",
                    team_id: "team-1",
                    email: "newperson@gmail.com",
                    name: null,
                },
            ],
            [],
            [{ id: "workspace-1" }],
            [],
            [{ id: "project-1" }],
        ]);

        await expect(
            resolvePrincipalPayload(db, isolatedConfig, {
                identity: {
                    clerkUserId: "clerk-1",
                    email: "newperson@gmail.com",
                    emailVerified: true,
                },
            }),
        ).resolves.toEqual({
            userId: "user-1",
            teamId: "team-1",
            defaultWorkspaceId: "workspace-1",
        });
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("insert into teams"),
            ["newperson's team"],
        );
    });

    it("returns an existing isolated user under their own team unchanged", async () => {
        const db = dbWithRows([
            [
                {
                    id: "user-existing",
                    clerk_user_id: "clerk-1",
                    team_id: "team-existing",
                    email: "alice@example.com",
                    name: "Alice",
                    default_workspace_id: "workspace-existing",
                },
            ],
        ]);

        await expect(
            resolvePrincipalPayload(db, isolatedConfig, {
                identity: {
                    clerkUserId: "clerk-1",
                    email: "alice@example.com",
                    emailVerified: true,
                    name: "Alice",
                },
            }),
        ).resolves.toEqual({
            userId: "user-existing",
            teamId: "team-existing",
            defaultWorkspaceId: "workspace-existing",
        });
        expect(db.query).toHaveBeenCalledTimes(1);
    });
});
