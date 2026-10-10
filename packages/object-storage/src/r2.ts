import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
    type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const R2_UPLOAD_URL_TTL_SECONDS = 10 * 60;
export const R2_CREATE_ONLY_UPLOAD_HEADER = "If-None-Match";
export const R2_CREATE_ONLY_UPLOAD_VALUE = "*";

const MAX_PRESIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const LEGACY_STORAGE_KEY = /^[a-f0-9-]{36}$/i;
const DATASET_SCOPED_STORAGE_KEY =
    /^datasets\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}(\.[A-Za-z0-9]{1,16})?$/;

export interface IR2StorageConfig {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    prefix?: string;
    endpoint?: string;
}

export class R2StorageError extends Error {
    constructor(
        message: string,
        readonly status?: number,
        readonly code?: string,
    ) {
        super(message);
        this.name = "R2StorageError";
    }
}

/** Read server-only R2 settings. R2_ENDPOINT is reserved for local S3 fixtures. */
export function createR2StorageConfig(
    env: NodeJS.ProcessEnv = process.env,
): IR2StorageConfig {
    const required = [
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
    ] as const;
    const missing = required.filter((key) => !env[key]?.trim());
    if (missing.length > 0) {
        throw new Error(`Missing R2 storage env var(s): ${missing.join(", ")}`);
    }

    const accountId = env.R2_ACCOUNT_ID!.trim();
    const endpoint = env.R2_ENDPOINT?.trim();
    if (!endpoint && !/^[a-f0-9]{32}$/i.test(accountId)) {
        throw new Error(
            "R2_ACCOUNT_ID must be a 32-character Cloudflare account ID.",
        );
    }
    if (endpoint) {
        let parsed: URL;
        try {
            parsed = new URL(endpoint);
        } catch {
            throw new Error("R2_ENDPOINT must be a valid absolute URL.");
        }
        if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
            throw new Error(
                "R2_ENDPOINT must be a loopback origin for local tests.",
            );
        }
        if (
            (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
            parsed.username ||
            parsed.password ||
            parsed.pathname !== "/" ||
            parsed.search ||
            parsed.hash
        ) {
            throw new Error(
                "R2_ENDPOINT must be an HTTP(S) origin without credentials, path, query, or fragment.",
            );
        }
        if (env.NODE_ENV === "production") {
            throw new Error(
                "R2_ENDPOINT is only allowed for local S3-compatible tests.",
            );
        }
    }

    const prefix = env.R2_STORAGE_PREFIX?.trim().replace(/^\/+|\/+$/g, "");
    if (
        prefix &&
        prefix.split("/").some((part) => !/^[A-Za-z0-9_-]{1,128}$/.test(part))
    ) {
        throw new Error(
            "R2_STORAGE_PREFIX must contain safe alphanumeric path segments.",
        );
    }

    return {
        accountId,
        accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
        bucket: env.R2_BUCKET!.trim(),
        ...(prefix ? { prefix } : {}),
        ...(endpoint ? { endpoint: endpoint.replace(/\/$/, "") } : {}),
    };
}

export function createR2StorageClient(config: IR2StorageConfig): S3Client {
    const options: S3ClientConfig = {
        region: "auto",
        endpoint:
            config.endpoint ??
            `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
        // Cloudflare's endpoint uses bucket subdomains; local S3 fixtures use
        // path-style addressing to avoid requiring wildcard DNS.
        ...(config.endpoint ? { forcePathStyle: true } : {}),
    };
    return new S3Client(options);
}

export function r2ObjectKey(
    config: Pick<IR2StorageConfig, "prefix">,
    storageKey: string,
): string {
    if (!isStorageKey(storageKey)) {
        throw new R2StorageError("Invalid storage key");
    }
    return config.prefix ? `${config.prefix}/${storageKey}` : storageKey;
}

export function isR2ObjectNotFound(error: unknown): boolean {
    const value = error as {
        name?: string;
        Code?: string;
        code?: string;
        $metadata?: { httpStatusCode?: number };
    } | null;
    return (
        value?.$metadata?.httpStatusCode === 404 ||
        [value?.name, value?.Code, value?.code].some((code) =>
            ["NoSuchKey", "NotFound"].includes(code ?? ""),
        )
    );
}

export async function createR2SignedUploadUrl(
    config: IR2StorageConfig,
    storageKey: string,
    contentType: string,
    expiresIn = R2_UPLOAD_URL_TTL_SECONDS,
): Promise<string> {
    if (
        !Number.isInteger(expiresIn) ||
        expiresIn < 1 ||
        expiresIn > MAX_PRESIGNED_URL_TTL_SECONDS
    ) {
        throw new R2StorageError("Invalid R2 signed URL expiry");
    }
    const client = createR2StorageClient(config);
    try {
        return await getSignedUrl(
            client,
            new PutObjectCommand({
                Bucket: config.bucket,
                Key: r2ObjectKey(config, storageKey),
                ContentType: contentType,
                IfNoneMatch: R2_CREATE_ONLY_UPLOAD_VALUE,
            }),
            {
                expiresIn,
                // The AWS SDK treats Content-Type as unsigned by default. R2
                // requires callers to explicitly request signing for this
                // header so a client cannot change the declared media type.
                signableHeaders: new Set([
                    "content-type",
                    R2_CREATE_ONLY_UPLOAD_HEADER.toLowerCase(),
                ]),
            },
        );
    } catch (error) {
        throw toR2StorageError("sign upload", error);
    } finally {
        client.destroy();
    }
}

export async function putR2Object(
    config: IR2StorageConfig,
    storageKey: string,
    bytes: Uint8Array,
    contentType: string,
): Promise<void> {
    await runR2(config, "upload object", (client) =>
        client.send(
            new PutObjectCommand({
                Bucket: config.bucket,
                Key: r2ObjectKey(config, storageKey),
                Body: bytes,
                ContentType: contentType,
            }),
        ),
    );
}

export async function getR2Object(
    config: IR2StorageConfig,
    storageKey: string,
): Promise<Buffer> {
    const response = await runR2(config, "download object", (client) =>
        client.send(
            new GetObjectCommand({
                Bucket: config.bucket,
                Key: r2ObjectKey(config, storageKey),
            }),
        ),
    );
    if (!response.Body) {
        throw new R2StorageError("R2 returned an empty object response");
    }
    return Buffer.from(await response.Body.transformToByteArray());
}

export async function getR2ObjectPrefix(
    config: IR2StorageConfig,
    storageKey: string,
    byteCount: number,
): Promise<Uint8Array> {
    if (!Number.isInteger(byteCount) || byteCount < 1) {
        throw new R2StorageError("Invalid R2 object prefix length");
    }
    const response = await runR2(config, "read object header", (client) =>
        client.send(
            new GetObjectCommand({
                Bucket: config.bucket,
                Key: r2ObjectKey(config, storageKey),
                Range: `bytes=0-${byteCount - 1}`,
            }),
        ),
    );
    if (!response.Body) {
        throw new R2StorageError("R2 returned an empty object response");
    }
    return (await response.Body.transformToByteArray()).subarray(0, byteCount);
}

export async function headR2Object(
    config: IR2StorageConfig,
    storageKey: string,
): Promise<{ byteSize: number; contentType?: string }> {
    const response = await runR2(config, "verify object", (client) =>
        client.send(
            new HeadObjectCommand({
                Bucket: config.bucket,
                Key: r2ObjectKey(config, storageKey),
            }),
        ),
    );
    if (response.ContentLength === undefined) {
        throw new R2StorageError("R2 object size is missing");
    }
    return {
        byteSize: response.ContentLength,
        ...(response.ContentType ? { contentType: response.ContentType } : {}),
    };
}

export async function deleteR2Object(
    config: IR2StorageConfig,
    storageKey: string,
): Promise<void> {
    await runR2(config, "delete object", (client) =>
        client.send(
            new DeleteObjectCommand({
                Bucket: config.bucket,
                Key: r2ObjectKey(config, storageKey),
            }),
        ),
    );
}

export async function checkR2Bucket(config: IR2StorageConfig): Promise<void> {
    await runR2(config, "check bucket access", (client) =>
        client.send(new HeadBucketCommand({ Bucket: config.bucket })),
    );
}

async function runR2<T>(
    config: IR2StorageConfig,
    action: string,
    operation: (client: S3Client) => Promise<T>,
): Promise<T> {
    const client = createR2StorageClient(config);
    try {
        return await operation(client);
    } catch (error) {
        throw toR2StorageError(action, error);
    } finally {
        client.destroy();
    }
}

function toR2StorageError(action: string, error: unknown): R2StorageError {
    if (error instanceof R2StorageError) return error;
    const value = error as {
        name?: string;
        Code?: string;
        code?: string;
        $metadata?: { httpStatusCode?: number };
    } | null;
    const status = value?.$metadata?.httpStatusCode;
    const code = value?.Code ?? value?.code ?? value?.name;
    return new R2StorageError(
        `Failed to ${action} in R2${status ? ` (${status})` : ""}`,
        status,
        code,
    );
}

function isStorageKey(storageKey: string): boolean {
    return (
        LEGACY_STORAGE_KEY.test(storageKey) ||
        DATASET_SCOPED_STORAGE_KEY.test(storageKey)
    );
}
