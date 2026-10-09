import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskHint } from "./index.js";

const VALID_KEY = Buffer.alloc(32, 7).toString("base64");
const CONTEXT = { teamId: "team-1", provider: "openai" };

describe("secret encryption", () => {
    it("round-trips a secret without storing plaintext", () => {
        const encrypted = encryptSecret(
            "sk-super-secret-1234",
            CONTEXT,
            VALID_KEY,
        );

        expect(encrypted.ciphertext).not.toContain("sk-super-secret-1234");
        expect(encrypted.iv).not.toBe("");
        expect(encrypted.authTag).not.toBe("");
        expect(decryptSecret(encrypted, CONTEXT, VALID_KEY)).toBe(
            "sk-super-secret-1234",
        );
    });

    it("uses a fresh IV for every encryption", () => {
        const first = encryptSecret("same-secret", CONTEXT, VALID_KEY);
        const second = encryptSecret("same-secret", CONTEXT, VALID_KEY);

        expect(first.iv).not.toBe(second.iv);
        expect(first.ciphertext).not.toBe(second.ciphertext);
    });

    it("rejects tampered ciphertext and authentication tags", () => {
        const encrypted = encryptSecret("secret", CONTEXT, VALID_KEY);
        const tamperedCiphertext = Buffer.from(encrypted.ciphertext, "base64");
        tamperedCiphertext[0] = tamperedCiphertext[0]! ^ 1;

        expect(() =>
            decryptSecret(
                {
                    ...encrypted,
                    ciphertext: tamperedCiphertext.toString("base64"),
                },
                CONTEXT,
                VALID_KEY,
            ),
        ).toThrow(/decrypt secret/i);
        expect(() =>
            decryptSecret(
                {
                    ...encrypted,
                    authTag: Buffer.alloc(16).toString("base64"),
                },
                CONTEXT,
                VALID_KEY,
            ),
        ).toThrow(/decrypt secret/i);
    });

    it("rejects a truncated authentication tag", () => {
        const encrypted = encryptSecret("secret", CONTEXT, VALID_KEY);
        const truncatedTag = Buffer.from(encrypted.authTag, "base64").subarray(
            0,
            4,
        );

        expect(() =>
            decryptSecret(
                { ...encrypted, authTag: truncatedTag.toString("base64") },
                CONTEXT,
                VALID_KEY,
            ),
        ).toThrow(/decrypt secret/i);
    });

    it("rejects missing, malformed, and wrong-length encryption keys", () => {
        expect(() => encryptSecret("secret", CONTEXT, undefined)).toThrow(
            /MOSAIC_SECRETS_ENC_KEY.*required/i,
        );
        expect(() => encryptSecret("secret", CONTEXT, "not base64!")).toThrow(
            /MOSAIC_SECRETS_ENC_KEY.*base64/i,
        );
        expect(() =>
            encryptSecret(
                "secret",
                CONTEXT,
                Buffer.alloc(31).toString("base64"),
            ),
        ).toThrow(/MOSAIC_SECRETS_ENC_KEY.*32 bytes/i);
    });

    it("rejects a secret under a different team or provider context", () => {
        const encrypted = encryptSecret("secret", CONTEXT, VALID_KEY);
        expect(() =>
            decryptSecret(
                encrypted,
                { ...CONTEXT, teamId: "team-2" },
                VALID_KEY,
            ),
        ).toThrow(/decrypt secret/i);
        expect(() =>
            decryptSecret(
                encrypted,
                { ...CONTEXT, provider: "soniox" },
                VALID_KEY,
            ),
        ).toThrow(/decrypt secret/i);
    });
});

describe("maskHint", () => {
    it("reveals only the last four characters", () => {
        expect(maskHint("sk-super-secret-1234")).toBe("••••1234");
        expect(maskHint("abcde")).toBe("••••bcde");
    });

    it("never reveals a short secret", () => {
        expect(["", "a", "ab", "abc", "abcd"].map(maskHint)).toEqual([
            "••••",
            "••••",
            "••••",
            "••••",
            "••••",
        ]);
    });
});
