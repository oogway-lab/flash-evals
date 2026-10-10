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

function syntheticToken(claims: Record<string, unknown> = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
        JSON.stringify({ alg: "RS256", typ: "at+jwt", kid: "synthetic" }),
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

describe("MCP OAuth diagnostics with the real Clerk SDK", () => {
    it("identifies the client-ID-as-azp failure for a signed OAuth JWT", async () => {
        await expect(
            resolveClerkOAuthSubject(syntheticToken(), oauthConfig),
        ).rejects.toMatchObject({ reason: "authorized_party_mismatch" });
    });

    it("accepts a signed token satisfying the existing checks", async () => {
        await expect(
            resolveClerkOAuthSubject(
                syntheticToken({ azp: oauthConfig.clientId }),
                oauthConfig,
            ),
        ).resolves.toBe("user_synthetic");
    });

    it("identifies an audience rejection without disclosing claims", async () => {
        await expect(
            resolveClerkOAuthSubject(
                syntheticToken({
                    azp: oauthConfig.clientId,
                    aud: "https://other.example/mcp",
                }),
                oauthConfig,
            ),
        ).rejects.toMatchObject({
            reason: "audience_mismatch",
            message: "Invalid or expired Clerk OAuth token.",
        });
    });
});
