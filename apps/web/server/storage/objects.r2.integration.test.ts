// @vitest-environment node
import { createServer, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
    checkR2Bucket,
    createR2SignedUploadUrl,
    getR2ObjectPrefix,
    headR2Object,
    R2StorageError,
} from "@mosaic/object-storage";
import {
    deleteObject,
    getObjectStorageConfig,
    loadObjectBytes,
    objectPath,
    putObject,
} from "./objects";

const BUCKET = "synthetic-media";
const ACCESS_KEY = "synthetic-access";
const SECRET_KEY = "synthetic-secret";
const STORAGE_KEY =
    "datasets/synthetic-dataset/11111111-1111-4111-8111-111111111111.png";
const PREFIX = "tenant-media";

interface IStoredObject {
    bytes: Buffer;
    contentType: string;
}

interface ISignedUpload {
    contentType: string;
    ifNoneMatch: string;
}

function createS3Fixture() {
    const objects = new Map<string, IStoredObject>();
    const signedUploads = new Map<string, ISignedUpload>();
    let denyAccess = false;
    const server = createServer(async (request, response) => {
        const url = new URL(
            request.url ?? "/",
            "http://" + request.headers.host,
        );
        const rawPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
        const [bucket, ...segments] = rawPath.split("/");
        const key = segments.join("/");

        if (bucket !== BUCKET) {
            return sendError(response, 404, "NoSuchBucket");
        }
        if (denyAccess) return sendError(response, 403, "AccessDenied");

        if (url.searchParams.has("X-Amz-Algorithm")) {
            const signature = url.searchParams.get("X-Amz-Signature") ?? "";
            const credential = url.searchParams.get("X-Amz-Credential") ?? "";
            const signedHeaders =
                url.searchParams.get("X-Amz-SignedHeaders") ?? "";
            const expires = Number(url.searchParams.get("X-Amz-Expires"));
            const date = parseAmzDate(url.searchParams.get("X-Amz-Date"));
            const registration = signedUploads.get(key);
            const expired =
                !date ||
                !Number.isFinite(expires) ||
                Date.now() > date + expires * 1_000;
            if (
                !signature ||
                !credential.startsWith(ACCESS_KEY + "/") ||
                !signedHeaders.split(";").includes("content-type") ||
                !signedHeaders.split(";").includes("if-none-match") ||
                expired ||
                !registration ||
                request.headers["content-type"] !== registration.contentType ||
                request.headers["if-none-match"] !== registration.ifNoneMatch
            ) {
                return sendError(response, 403, "SignatureDoesNotMatch");
            }
        } else if (
            !request.headers.authorization?.includes(
                "Credential=" + ACCESS_KEY + "/",
            )
        ) {
            return sendError(response, 403, "AccessDenied");
        }

        if (request.method === "HEAD" && !key) {
            response.statusCode = 200;
            return response.end();
        }

        if (request.method === "PUT") {
            if (request.headers["if-none-match"] === "*" && objects.has(key)) {
                return sendError(response, 412, "PreconditionFailed");
            }
            const chunks: Buffer[] = [];
            for await (const chunk of request) {
                chunks.push(Buffer.from(chunk));
            }
            objects.set(key, {
                bytes: Buffer.concat(chunks),
                contentType:
                    request.headers["content-type"] ??
                    "application/octet-stream",
            });
            response.statusCode = 200;
            response.setHeader("ETag", '"synthetic-etag"');
            return response.end();
        }

        const stored = objects.get(key);
        if (request.method === "HEAD") {
            if (!stored) return sendError(response, 404, "NoSuchKey");
            response.statusCode = 200;
            response.setHeader("Content-Length", stored.bytes.byteLength);
            response.setHeader("Content-Type", stored.contentType);
            return response.end();
        }

        if (request.method === "GET") {
            if (!stored) return sendError(response, 404, "NoSuchKey");
            const range = request.headers.range;
            if (range) {
                const end = Number(/bytes=0-(\d+)/.exec(range)?.[1] ?? 0);
                const bytes = stored.bytes.subarray(0, end + 1);
                response.statusCode = 206;
                response.setHeader(
                    "Content-Range",
                    "bytes 0-" + (bytes.length - 1) + "/" + stored.bytes.length,
                );
                response.setHeader("Content-Length", bytes.length);
                response.setHeader("Content-Type", stored.contentType);
                return response.end(bytes);
            }
            response.statusCode = 200;
            response.setHeader("Content-Length", stored.bytes.byteLength);
            response.setHeader("Content-Type", stored.contentType);
            return response.end(stored.bytes);
        }

        if (request.method === "DELETE") {
            objects.delete(key);
            response.statusCode = 204;
            return response.end();
        }

        return sendError(response, 405, "MethodNotAllowed");
    });

    return {
        objects,
        signedUploads,
        server,
        setDenyAccess(value: boolean) {
            denyAccess = value;
        },
    };
}

function parseAmzDate(value: string | null): number | undefined {
    if (!value || !/^\d{8}T\d{6}Z$/.test(value)) return undefined;
    const iso =
        value.slice(0, 4) +
        "-" +
        value.slice(4, 6) +
        "-" +
        value.slice(6, 8) +
        "T" +
        value.slice(9, 11) +
        ":" +
        value.slice(11, 13) +
        ":" +
        value.slice(13, 15) +
        "Z";
    const timestamp = Date.parse(iso);
    return Number.isFinite(timestamp) ? timestamp : undefined;
}

function sendError(
    response: ServerResponse,
    status: number,
    code: string,
): void {
    response.statusCode = status;
    response.setHeader("Content-Type", "application/xml");
    response.end(
        "<Error><Code>" +
            code +
            "</Code><Message>" +
            code +
            "</Message></Error>",
    );
}

const fixture = createS3Fixture();

beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
        fixture.server.once("error", reject);
        fixture.server.listen(0, "127.0.0.1", resolve);
    });
    const address = fixture.server.address();
    if (!address || typeof address === "string") {
        throw new Error("Could not start the local S3 fixture.");
    }
    vi.stubEnv("MOSAIC_STORAGE_ADAPTER", "r2");
    vi.stubEnv("R2_ACCOUNT_ID", "synthetic-account");
    vi.stubEnv("R2_ACCESS_KEY_ID", ACCESS_KEY);
    vi.stubEnv("R2_SECRET_ACCESS_KEY", SECRET_KEY);
    vi.stubEnv("R2_BUCKET", BUCKET);
    vi.stubEnv("R2_STORAGE_PREFIX", PREFIX);
    vi.stubEnv("R2_ENDPOINT", "http://127.0.0.1:" + address.port);
});

afterAll(async () => {
    vi.unstubAllEnvs();
    if (fixture.server.listening) {
        await new Promise<void>((resolve, reject) =>
            fixture.server.close((error) =>
                error ? reject(error) : resolve(),
            ),
        );
    }
});

describe("R2 object adapter against a disposable local S3-compatible fixture", () => {
    it("shares namespaced object bytes, type, and size across upload, worker read, and delete", async () => {
        const bytes = Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
        ]);
        const config = getObjectStorageConfig();
        expect(config.adapter).toBe("r2");
        expect(objectPath(STORAGE_KEY)).toBe(PREFIX + "/" + STORAGE_KEY);

        await putObject(STORAGE_KEY, bytes, "image/png");
        await expect(loadObjectBytes(STORAGE_KEY)).resolves.toEqual(bytes);
        await expect(
            headR2Object(config.r2Storage!, STORAGE_KEY),
        ).resolves.toEqual({
            byteSize: bytes.byteLength,
            contentType: "image/png",
        });
        await expect(
            getR2ObjectPrefix(config.r2Storage!, STORAGE_KEY, 8),
        ).resolves.toEqual(new Uint8Array(bytes.subarray(0, 8)));
        await expect(checkR2Bucket(config.r2Storage!)).resolves.toBeUndefined();

        await deleteObject(STORAGE_KEY);
        await expect(loadObjectBytes(STORAGE_KEY)).rejects.toMatchObject({
            name: "R2StorageError",
            status: 404,
        });
        // S3 DeleteObject is idempotent for a missing key.
        await expect(deleteObject(STORAGE_KEY)).resolves.toBeUndefined();
    });

    it("limits signed upload URLs to one key, declared type, and expiry", async () => {
        const config = getObjectStorageConfig().r2Storage!;
        const key =
            "datasets/synthetic-dataset/22222222-2222-4222-8222-222222222222.png";
        fixture.signedUploads.set(PREFIX + "/" + key, {
            contentType: "image/png",
            ifNoneMatch: "*",
        });
        const url = await createR2SignedUploadUrl(config, key, "image/png");
        const parsed = new URL(url);
        expect(parsed.searchParams.get("X-Amz-Expires")).toBe("600");
        expect(parsed.searchParams.get("X-Amz-Signature")).toBeTruthy();
        expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toContain(
            "content-type",
        );
        expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toContain(
            "if-none-match",
        );
        expect(parsed.pathname).toContain(BUCKET + "/" + PREFIX + "/" + key);

        const accepted = await fetch(url, {
            method: "PUT",
            headers: {
                "Content-Type": "image/png",
                "If-None-Match": "*",
            },
            body: Buffer.from("synthetic png"),
        });
        expect(accepted.status).toBe(200);
        const reused = await fetch(url, {
            method: "PUT",
            headers: {
                "Content-Type": "image/png",
                "If-None-Match": "*",
            },
            body: Buffer.from("replacement png"),
        });
        expect(reused.status).toBe(412);
        const rejectedType = await fetch(url, {
            method: "PUT",
            headers: {
                "Content-Type": "image/jpeg",
                "If-None-Match": "*",
            },
            body: Buffer.from("synthetic jpg"),
        });
        expect(rejectedType.status).toBe(403);

        const expiringKey =
            "datasets/synthetic-dataset/33333333-3333-4333-8333-333333333333.png";
        fixture.signedUploads.set(PREFIX + "/" + expiringKey, {
            contentType: "image/png",
            ifNoneMatch: "*",
        });
        const expiringUrl = await createR2SignedUploadUrl(
            config,
            expiringKey,
            "image/png",
            1,
        );
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        const expired = await fetch(expiringUrl, {
            method: "PUT",
            headers: {
                "Content-Type": "image/png",
                "If-None-Match": "*",
            },
            body: Buffer.from("expired"),
        });
        expect(expired.status).toBe(403);
    });

    it("turns missing-object and permission errors into safe storage errors", async () => {
        const missingKey =
            "datasets/synthetic-dataset/44444444-4444-4444-8444-444444444444.png";
        await expect(loadObjectBytes(missingKey)).rejects.toMatchObject({
            name: "R2StorageError",
            status: 404,
        });

        fixture.setDenyAccess(true);
        try {
            const error = await loadObjectBytes(STORAGE_KEY).catch(
                (reason: unknown) => reason,
            );
            expect(error).toBeInstanceOf(R2StorageError);
            expect(error).toMatchObject({ status: 403 });
            expect((error as Error).message).not.toContain(SECRET_KEY);
            await expect(
                checkR2Bucket(getObjectStorageConfig().r2Storage!),
            ).rejects.toMatchObject({ status: 403 });
        } finally {
            fixture.setDenyAccess(false);
        }
    });
});
