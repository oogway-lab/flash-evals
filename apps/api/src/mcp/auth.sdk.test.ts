import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IMcpOAuthConfig } from "../config.js";
import { resolveClerkOAuthSubject } from "./auth.js";

// Ephemeral synthetic keys only. Exercise the installed Clerk verifier rather
// than mocking authenticateRequest, without any external request or credential.
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
});
const oauthConfig: IMcpOAuthConfig = {
    resourceUrl: "https://api.example.com/mcp",
    issuer: "https://clerk.example.com",
    publishableKey: `pk_test_${Buffer.from("clerk.example.com$").toString("base64")}`,
    secretKey: "sk_test_synthetic",
    jwtKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    clientId: "synthetic-client",
    dynamicClients: false,
};

function syntheticToken(
    claims: Record<string, unknown> = {},
    typ = "at+jwt",
): string {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
        JSON.stringify({ alg: "RS256", typ, kid: "synthetic" }),
    ).toString("base64url");
    const payload = Buffer.from(
        JSON.stringify({
            iss: oauthConfig.issuer,
            sub: "user_synthetic",
            aud: oauthConfig.resourceUrl,
            client_id: oauthConfig.clientId,
            iat: now,
            nbf: now - 5,
            exp: now + 300,
            scope: "email profile offline_access",
            ...claims,
        }),
    ).toString("base64url");
    const input = `${header}.${payload}`;
    return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

describe("MCP OAuth validation with the real Clerk SDK", () => {
    it.each([
        undefined,
        "",
        "https://different.example.com",
        "https://clerk.example.com/",
        "https://clerk.example.com.attacker.test",
        123,
        ["https://clerk.example.com"],
    ])("rejects a trusted-key OAuth JWT with issuer %s", async (iss) => {
        await expect(
            resolveClerkOAuthSubject(syntheticToken({ iss }), oauthConfig),
        ).rejects.toMatchObject({ reason: "issuer_mismatch" });
    });

    it("accepts the other RFC 9068 access-JWT header type with the exact issuer", async () => {
        await expect(
            resolveClerkOAuthSubject(
                syntheticToken({}, "application/at+jwt"),
                oauthConfig,
            ),
        ).resolves.toBe("user_synthetic");
    });
    it("accepts a signed OAuth JWT with client_id and no session azp", async () => {
        await expect(
            resolveClerkOAuthSubject(syntheticToken(), oauthConfig),
        ).resolves.toBe("user_synthetic");
    });

    it("preserves explicitly configured azp admission", async () => {
        const restricted = {
            ...oauthConfig,
            authorizedParties: ["https://web.example.com"],
        };
        await expect(
            resolveClerkOAuthSubject(syntheticToken(), restricted),
        ).rejects.toMatchObject({ reason: "authorized_party_mismatch" });
        await expect(
            resolveClerkOAuthSubject(
                syntheticToken({ azp: "https://other.example.com" }),
                restricted,
            ),
        ).rejects.toMatchObject({ reason: "authorized_party_mismatch" });
        await expect(
            resolveClerkOAuthSubject(
                syntheticToken({ azp: "https://web.example.com" }),
                restricted,
            ),
        ).resolves.toBe("user_synthetic");
    });

    it.each(["other-client", "", undefined])(
        "rejects a signed OAuth JWT whose client_id is %s",
        async (client_id) => {
            await expect(
                resolveClerkOAuthSubject(
                    syntheticToken({ client_id }),
                    oauthConfig,
                ),
            ).rejects.toThrow(
                "OAuth token was not issued for this Flash Evals MCP client.",
            );
        },
    );

    it("identifies an audience rejection without disclosing claims", async () => {
        await expect(
            resolveClerkOAuthSubject(
                syntheticToken({ aud: "https://other.example/mcp" }),
                oauthConfig,
            ),
        ).rejects.toMatchObject({
            reason: "audience_mismatch",
            message: "Invalid or expired Clerk OAuth token.",
        });
    });

    it.each([undefined, "", []])(
        "rejects a missing or empty audience %s",
        async (aud) => {
            await expect(
                resolveClerkOAuthSubject(syntheticToken({ aud }), oauthConfig),
            ).rejects.toMatchObject({ reason: "audience_mismatch" });
        },
    );

    it("rejects an expired signed OAuth JWT", async () => {
        await expect(
            resolveClerkOAuthSubject(
                syntheticToken({ exp: Math.floor(Date.now() / 1000) - 30 }),
                oauthConfig,
            ),
        ).rejects.toMatchObject({ reason: "expired_token" });
    });

    it("rejects a signed session JWT", async () => {
        await expect(
            resolveClerkOAuthSubject(syntheticToken({}, "JWT"), oauthConfig),
        ).rejects.toThrow("Invalid or expired Clerk OAuth token.");
    });

    it("rejects a signed OAuth JWT with no subject", async () => {
        await expect(
            resolveClerkOAuthSubject(
                syntheticToken({ sub: undefined }),
                oauthConfig,
            ),
        ).rejects.toThrow("Invalid or expired Clerk OAuth token.");
    });

    it("rejects a JWT signed with another issuer's key", async () => {
        const otherKey = generateKeyPairSync("rsa", {
            modulusLength: 2048,
        }).publicKey;
        await expect(
            resolveClerkOAuthSubject(syntheticToken(), {
                ...oauthConfig,
                jwtKey: otherKey
                    .export({ type: "spki", format: "pem" })
                    .toString(),
            }),
        ).rejects.toMatchObject({ reason: "invalid_signature" });
    });
});
