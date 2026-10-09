import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export { REDACTED, redactSecrets, redactedErrorDetail } from "./redact.js";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ENVELOPE_VERSION = "v1";

export interface ISecretContext {
    teamId: string;
    provider: string;
}

export interface IEncryptedSecret {
    ciphertext: string;
    iv: string;
    authTag: string;
}

export function encryptSecret(
    plaintext: string,
    context: ISecretContext,
    encodedKey = encryptionKeyFromEnv(),
): IEncryptedSecret {
    const key = encryptionKey(encodedKey);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(authenticatedContext(context));
    const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
    ]);

    return {
        ciphertext: ciphertext.toString("base64"),
        iv: iv.toString("base64"),
        authTag: cipher.getAuthTag().toString("base64"),
    };
}

export function decryptSecret(
    encrypted: IEncryptedSecret,
    context: ISecretContext,
    encodedKey = encryptionKeyFromEnv(),
): string {
    const key = encryptionKey(encodedKey);
    try {
        const decipher = createDecipheriv(
            ALGORITHM,
            key,
            decodeStoredValue(encrypted.iv),
            // Without a fixed length, GCM accepts tags truncated to 4 bytes.
            { authTagLength: AUTH_TAG_BYTES },
        );
        decipher.setAAD(authenticatedContext(context));
        decipher.setAuthTag(decodeStoredValue(encrypted.authTag));
        return Buffer.concat([
            decipher.update(decodeStoredValue(encrypted.ciphertext)),
            decipher.final(),
        ]).toString("utf8");
    } catch {
        throw new Error(
            "Unable to decrypt secret: ciphertext or key is invalid.",
        );
    }
}

export function maskHint(secret: string): string {
    return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}

function authenticatedContext(context: ISecretContext): Buffer {
    return Buffer.from(
        `mosaic-provider-key:${ENVELOPE_VERSION}\0${context.teamId}\0${context.provider}`,
        "utf8",
    );
}

function encryptionKey(encodedKey: string | undefined): Buffer {
    if (!encodedKey) {
        throw new Error("MOSAIC_SECRETS_ENC_KEY is required.");
    }
    if (!isCanonicalBase64(encodedKey)) {
        throw new Error("MOSAIC_SECRETS_ENC_KEY must be valid base64.");
    }
    const key = Buffer.from(encodedKey, "base64");
    if (key.length !== KEY_BYTES) {
        throw new Error(
            `MOSAIC_SECRETS_ENC_KEY must decode to exactly ${KEY_BYTES} bytes.`,
        );
    }
    return key;
}

function encryptionKeyFromEnv(): string | undefined {
    return process.env.MOSAIC_SECRETS_ENC_KEY;
}

function isCanonicalBase64(value: string): boolean {
    if (value.length === 0 || value.length % 4 !== 0) return false;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
    return Buffer.from(value, "base64").toString("base64") === value;
}

function decodeStoredValue(value: string): Buffer {
    if (!isCanonicalBase64(value)) {
        throw new Error("Encrypted secret fields must be valid base64.");
    }
    return Buffer.from(value, "base64");
}
