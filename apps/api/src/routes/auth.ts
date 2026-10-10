import type {
    IPrincipalResponse,
    IResolvePrincipalRequest,
} from "@mosaic/api-contract";
import {
    isEmailAllowedForDomain,
    normalizeEmailAddress,
} from "@mosaic/api-contract";
import type { IApiConfig } from "../config.js";
import { isTransactionalDb, type IDb, withTransaction } from "../db.js";
import { ApiConflictError, ApiForbiddenError } from "../errors.js";

interface IUserRow {
    id: string;
    clerk_user_id: string | null;
    team_id: string;
    email: string;
    name: string | null;
    default_workspace_id: string | null;
}

type PrincipalInput = {
    clerkUserId: string;
    email: string;
    name: string | undefined;
};

type WorkspaceEnsurer = (
    db: IDb,
    user: IUserRow,
    input: PrincipalInput,
) => Promise<IUserRow>;

export async function resolvePrincipalPayload(
    db: IDb,
    config: IApiConfig,
    input: IResolvePrincipalRequest,
): Promise<IPrincipalResponse> {
    const identity = input.identity;
    if (!identity.email || !identity.emailVerified) {
        throw new ApiForbiddenError("A verified email address is required.");
    }

    const principalInput: PrincipalInput = {
        clerkUserId: identity.clerkUserId,
        email: normalizeEmailAddress(identity.email),
        name: identity.name,
    };

    if (
        (config.mosaicTenancyMode === "single-org" ||
            config.mosaicAllowedEmailDomain !== "") &&
        !isEmailAllowedForDomain(
            principalInput.email,
            config.mosaicAllowedEmailDomain,
        )
    ) {
        throw new ApiForbiddenError(
            config.mosaicAllowedEmailDomain
                ? `Only ${config.mosaicAllowedEmailDomain} email addresses can access this Flash Evals instance.`
                : "Sign-in is disabled until MOSAIC_ALLOWED_EMAIL_DOMAIN is configured.",
        );
    }

    if (config.mosaicTenancyMode === "isolated") {
        // Each new identity gets its own private team. A configured email
        // domain has already been enforced above.
        return resolveOrProvisionPrincipal(
            db,
            principalInput,
            ensureOwnWorkspace,
            provisionIsolatedTenant,
        );
    }

    if (!config.mosaicDefaultTeamId) {
        throw new ApiConflictError(
            "Flash Evals tenant configuration is missing.",
        );
    }

    return resolveOrProvisionPrincipal(
        db,
        principalInput,
        (d, user, inp) => ensureDefaultWorkspace(d, config, user, inp),
        (d, inp) => provisionTenantWorkspace(d, config, inp),
    );
}

async function resolveOrProvisionPrincipal(
    db: IDb,
    input: PrincipalInput,
    ensureWorkspace: WorkspaceEnsurer,
    provisionNew: (db: IDb, input: PrincipalInput) => Promise<IUserRow>,
): Promise<IPrincipalResponse> {
    const existingByClerkId = await findUserByClerkId(db, input.clerkUserId);
    if (existingByClerkId) {
        await syncUserProfileIfChanged(db, existingByClerkId, input);
        return toPrincipal(await ensureWorkspace(db, existingByClerkId, input));
    }

    const existingByEmail = await findUserByEmail(db, input.email);
    if (existingByEmail) {
        await linkExistingEmailUser(db, existingByEmail, input);
        const linked = await findUserByClerkId(db, input.clerkUserId);
        if (!linked) {
            throw new ApiConflictError(
                "Could not load linked Flash Evals user.",
            );
        }
        return toPrincipal(await ensureWorkspace(db, linked, input));
    }

    return toPrincipal(await provisionNew(db, input));
}

function toPrincipal(
    user: Pick<IUserRow, "id" | "team_id" | "default_workspace_id">,
): IPrincipalResponse {
    return {
        userId: user.id,
        teamId: user.team_id,
        ...(user.default_workspace_id
            ? { defaultWorkspaceId: user.default_workspace_id }
            : {}),
    };
}

async function findUserByClerkId(
    db: IDb,
    clerkUserId: string,
): Promise<IUserRow | undefined> {
    const result = await db.query<IUserRow>(
        `select id, clerk_user_id, team_id, email, name, default_workspace_id
        from users
        where clerk_user_id = $1
        limit 1`,
        [clerkUserId],
    );
    return result.rows[0];
}

async function findUserByEmail(
    db: IDb,
    email: string,
): Promise<IUserRow | undefined> {
    const result = await db.query<IUserRow>(
        `select id, clerk_user_id, team_id, email, name, default_workspace_id
        from users
        where email = $1
        limit 1`,
        [email],
    );
    return result.rows[0];
}

async function syncUserProfileIfChanged(
    db: IDb,
    user: Pick<IUserRow, "id" | "email" | "name">,
    next: { email: string; name: string | undefined },
): Promise<void> {
    const nameChanged = next.name !== undefined && next.name !== user.name;
    if (next.email === user.email && !nameChanged) return;

    await db.query(
        `update users
        set email = $1, name = coalesce($2, name)
        where id = $3`,
        [next.email, next.name ?? null, user.id],
    );
}

async function linkExistingEmailUser(
    db: IDb,
    user: IUserRow,
    identity: { clerkUserId: string; email: string; name: string | undefined },
): Promise<IPrincipalResponse> {
    if (user.clerk_user_id && user.clerk_user_id !== identity.clerkUserId) {
        throw new ApiForbiddenError(
            "Email is already linked to another account.",
        );
    }

    const result = await db.query<IUserRow>(
        `update users
        set clerk_user_id = $1, email = $2, name = coalesce($3, name)
        where id = $4 and (clerk_user_id is null or clerk_user_id = $1)
        returning id, clerk_user_id, team_id, email, name, default_workspace_id`,
        [identity.clerkUserId, identity.email, identity.name ?? null, user.id],
    );
    if (result.rows[0]) return toPrincipal(result.rows[0]);

    const concurrent = await findUserByEmail(db, identity.email);
    if (concurrent?.clerk_user_id === identity.clerkUserId) {
        return toPrincipal(concurrent);
    }
    throw new ApiForbiddenError("Email is already linked to another account.");
}

// Shared "claim the advisory lock, then recheck for a concurrent sign-in"
// skeleton for first-time provisioning. `createUser` is the only part that
// differs between single-org (join the configured team) and isolated
// (create a fresh team) — see provisionTenantWorkspace/provisionIsolatedTenant.
async function provisionWithinLock(
    db: IDb,
    input: PrincipalInput,
    ensureWorkspace: WorkspaceEnsurer,
    createUser: (tx: IDb, input: PrincipalInput) => Promise<IUserRow>,
): Promise<IUserRow> {
    return withTransaction(db, async (tx) => {
        if (isTransactionalDb(db)) {
            await tx.query(
                "select pg_advisory_xact_lock(hashtextextended($1, 0))",
                [input.email],
            );
        }

        const concurrentByClerkId = await findUserByClerkId(
            tx,
            input.clerkUserId,
        );
        if (concurrentByClerkId) {
            return ensureWorkspace(tx, concurrentByClerkId, input);
        }
        const concurrentByEmail = await findUserByEmail(tx, input.email);
        if (concurrentByEmail) {
            const principal = await linkExistingEmailUser(
                tx,
                concurrentByEmail,
                input,
            );
            const linked = await findUserByClerkId(tx, input.clerkUserId);
            if (linked) return ensureWorkspace(tx, linked, input);
            throw new ApiConflictError(
                `Could not load concurrently linked user ${principal.userId}.`,
            );
        }

        return createUser(tx, input);
    });
}

async function insertUser(
    tx: IDb,
    teamId: string,
    input: PrincipalInput,
): Promise<IUserRow | undefined> {
    const created = await tx.query<IUserRow>(
        `insert into users (clerk_user_id, team_id, email, name)
        values ($1, $2, $3, $4)
        on conflict do nothing
        returning id, clerk_user_id, team_id, email, name, default_workspace_id`,
        [input.clerkUserId, teamId, input.email, input.name ?? null],
    );
    return created.rows[0];
}

// The insert above races on (clerk_user_id) / (email) uniqueness; losing the
// race means someone else's concurrent request just created this identity.
async function resolveConcurrentInsertConflict(
    tx: IDb,
    input: PrincipalInput,
    ensureWorkspace: WorkspaceEnsurer,
): Promise<IUserRow> {
    const concurrent =
        (await findUserByClerkId(tx, input.clerkUserId)) ??
        (await findUserByEmail(tx, input.email));
    if (
        concurrent &&
        (concurrent.clerk_user_id === input.clerkUserId ||
            concurrent.clerk_user_id === null)
    ) {
        return ensureWorkspace(tx, concurrent, input);
    }
    throw new ApiConflictError("Could not create user for this identity.");
}

async function provisionTenantWorkspace(
    db: IDb,
    config: IApiConfig,
    input: PrincipalInput,
): Promise<IUserRow> {
    const teamId = config.mosaicDefaultTeamId!;
    const ensureWorkspace: WorkspaceEnsurer = (d, user, inp) =>
        ensureDefaultWorkspace(d, config, user, inp);

    return provisionWithinLock(db, input, ensureWorkspace, async (tx, inp) => {
        const user = await insertUser(tx, teamId, inp);
        if (!user) {
            return resolveConcurrentInsertConflict(tx, inp, ensureWorkspace);
        }
        return insertDefaultWorkspace(tx, teamId, user, inp);
    });
}

async function provisionIsolatedTenant(
    db: IDb,
    input: PrincipalInput,
): Promise<IUserRow> {
    return provisionWithinLock(
        db,
        input,
        ensureOwnWorkspace,
        async (tx, inp) => {
            const team = await tx.query<{ id: string }>(
                `insert into teams (name) values ($1) returning id`,
                [personalTeamName(inp)],
            );
            const teamId = team.rows[0]!.id;

            const user = await insertUser(tx, teamId, inp);
            if (!user) {
                return resolveConcurrentInsertConflict(
                    tx,
                    inp,
                    ensureOwnWorkspace,
                );
            }

            await tx.query(
                `update teams set owner_user_id = $1 where id = $2`,
                [user.id, teamId],
            );
            return insertDefaultWorkspace(tx, teamId, user, inp);
        },
    );
}

function personalTeamName(input: {
    name: string | undefined;
    email: string;
}): string {
    const owner = input.name?.trim() || input.email.split("@")[0] || "Personal";
    return `${owner}'s team`;
}

async function insertDefaultWorkspace(
    tx: IDb,
    teamId: string,
    user: IUserRow,
    input: { email: string; name: string | undefined },
): Promise<IUserRow> {
    const workspace = await tx.query<{ id: string }>(
        `insert into workspaces (team_id, name, owner_user_id)
        values ($1, $2, $3)
        returning id`,
        [teamId, personalWorkspaceName(input, user.id), user.id],
    );
    const workspaceId = workspace.rows[0]!.id;
    await tx.query(`update users set default_workspace_id = $1 where id = $2`, [
        workspaceId,
        user.id,
    ]);
    await tx.query<{ id: string }>(
        `insert into projects (team_id, workspace_id, name, created_by)
        values ($1, $2, 'Default', $3)
        returning id`,
        [teamId, workspaceId, user.id],
    );
    return { ...user, default_workspace_id: workspaceId };
}

async function ensureDefaultWorkspace(
    db: IDb,
    config: IApiConfig,
    user: IUserRow,
    input: { email: string; name: string | undefined },
): Promise<IUserRow> {
    const teamId = config.mosaicDefaultTeamId!;
    if (user.team_id !== teamId) {
        throw new ApiConflictError(
            "This Flash Evals account is not a member of the configured tenant.",
        );
    }
    return ensureWorkspaceUnderTeam(db, teamId, user, input);
}

// Isolated mode: every user already has their own team from signup, so there
// is no shared tenant id to check them against — just make sure it has a
// default workspace.
async function ensureOwnWorkspace(
    db: IDb,
    user: IUserRow,
    input: { email: string; name: string | undefined },
): Promise<IUserRow> {
    return ensureWorkspaceUnderTeam(db, user.team_id, user, input);
}

async function ensureWorkspaceUnderTeam(
    db: IDb,
    teamId: string,
    user: IUserRow,
    input: { email: string; name: string | undefined },
): Promise<IUserRow> {
    if (user.default_workspace_id) return user;

    return withTransaction(db, async (tx) => {
        if (isTransactionalDb(db)) {
            await tx.query(
                "select pg_advisory_xact_lock(hashtextextended($1, 0))",
                [`workspace:${user.id}`],
            );
        }
        const current = await findUserByClerkId(tx, user.clerk_user_id ?? "");
        if (!current) {
            throw new ApiConflictError("Could not load Flash Evals user.");
        }
        if (current.default_workspace_id) return current;

        return insertDefaultWorkspace(tx, teamId, current, input);
    });
}

function personalWorkspaceName(
    input: {
        name: string | undefined;
        email: string;
    },
    userId: string,
): string {
    const owner = input.name?.trim() || input.email.split("@")[0] || "Personal";
    return `${owner}'s workspace (${userId.slice(0, 8)})`;
}
