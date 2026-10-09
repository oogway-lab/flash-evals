import { pathToFileURL } from "node:url";
import { getApiConfig } from "../config.js";
import { createDb } from "../db.js";
import { createMcpTokenSecret, hashMcpToken } from "../mcp/auth.js";

interface IUserRow {
    id: string;
    team_id: string;
}

function usage(): never {
    console.error(
        [
            "Usage:",
            '  pnpm --filter @mosaic/api mcp:token:create -- --email user@example.com --name "Claude Desktop"',
            "  pnpm --filter @mosaic/api mcp:token:revoke -- --token mcp_... | --token-id uuid",
        ].join("\n"),
    );
    process.exit(1);
}

function argValue(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    const value = index >= 0 ? process.argv[index + 1] : undefined;
    return value?.startsWith("--") ? undefined : value;
}

async function createToken(): Promise<void> {
    const email = argValue("--email")?.trim().toLowerCase();
    const name = argValue("--name")?.trim() || "MCP client";
    if (!email) usage();
    if (process.argv.includes("--team-id")) {
        throw new Error("--team-id is not supported for MCP tokens.");
    }

    const config = getApiConfig();
    const db = createDb(config);
    const userResult = await db.query<IUserRow>(
        "select id, team_id from users where lower(email) = $1 limit 1",
        [email],
    );
    const user = userResult.rows[0];
    if (!user) throw new Error(`No Flash Evals user found for ${email}.`);

    const teamId = user.team_id;
    const token = createMcpTokenSecret();
    const tokenHash = hashMcpToken(token, config.mosaicMcpTokenPepper);
    const tokenResult = await db.query<{ id: string }>(
        `insert into mcp_access_tokens (user_id, team_id, name, token_hash, created_by)
        values ($1, $2, $3, $4, $1)
        returning id`,
        [user.id, teamId, name, tokenHash],
    );

    console.info(
        JSON.stringify(
            {
                tokenId: tokenResult.rows[0]!.id,
                userId: user.id,
                teamId,
                token,
            },
            null,
            2,
        ),
    );
}

async function revokeToken(): Promise<void> {
    const token = argValue("--token")?.trim();
    const tokenId = argValue("--token-id")?.trim();
    if (!token && !tokenId) usage();

    const config = getApiConfig();
    const db = createDb(config);
    const result = token
        ? await db.query<{ id: string }>(
              `update mcp_access_tokens
              set revoked_at = now()
              where token_hash = $1 and revoked_at is null
              returning id`,
              [hashMcpToken(token, config.mosaicMcpTokenPepper)],
          )
        : await db.query<{ id: string }>(
              `update mcp_access_tokens
              set revoked_at = now()
              where id = $1 and revoked_at is null
              returning id`,
              [tokenId],
          );
    console.info(
        JSON.stringify({ revokedTokenIds: result.rows.map((row) => row.id) }),
    );
}

async function main(): Promise<void> {
    const action = process.argv[2];
    if (action === "create") {
        await createToken();
        return;
    }
    if (action === "revoke") {
        await revokeToken();
        return;
    }
    usage();
}

const isEntrypoint =
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
    main().catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
