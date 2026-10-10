import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import {
    getObjectStorageConfig,
    loadObjectBytes,
    ObjectStorageConfigError,
    objectPath,
    putObject,
} from "./objects";

let dir: string;

beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mosaic-objects-"));
    process.env.MOSAIC_STORAGE_ADAPTER = "local";
    process.env.UPLOAD_DIR = dir;
});

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe("storage keys", () => {
    it("accepts legacy bare-uuid keys", async () => {
        const key = "00000000-0000-4000-8000-000000000002";
        await putObject(key, Buffer.from("legacy"), "audio/wav");
        expect((await loadObjectBytes(key)).toString()).toBe("legacy");
    });

    it("accepts dataset-scoped direct-upload keys (regression: STT run 'Invalid storage key')", async () => {
        const key =
            "datasets/d4b1dee5-5aa0-446e-8b9f-b8daeccda5fc/7f730b79-93da-424f-a594-47b1c231da5b.wav";
        await putObject(key, Buffer.from("direct"), "audio/wav");
        expect((await loadObjectBytes(key)).toString()).toBe("direct");
    });

    it("rejects traversal and malformed keys", async () => {
        for (const bad of [
            "datasets/../secrets",
            "/etc/passwd",
            "datasets/a/../../x.wav",
            "not-a-key",
        ]) {
            await expect(loadObjectBytes(bad)).rejects.toThrow(
                "Invalid storage key",
            );
        }
    });
});

describe("R2 storage configuration", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("uses the same validated prefix and safe keys for R2 object paths", () => {
        vi.stubEnv("MOSAIC_STORAGE_ADAPTER", "r2");
        vi.stubEnv("R2_ACCOUNT_ID", "synthetic-account");
        vi.stubEnv("R2_ACCESS_KEY_ID", "synthetic-access");
        vi.stubEnv("R2_SECRET_ACCESS_KEY", "synthetic-secret");
        vi.stubEnv("R2_BUCKET", "synthetic-media");
        vi.stubEnv("R2_STORAGE_PREFIX", "/tenant-media/");
        vi.stubEnv("R2_ENDPOINT", "http://127.0.0.1:9000");

        expect(getObjectStorageConfig()).toMatchObject({
            adapter: "r2",
            r2Storage: {
                bucket: "synthetic-media",
                prefix: "tenant-media",
            },
        });
        expect(
            objectPath(
                "datasets/team-a/11111111-1111-4111-8111-111111111111.png",
            ),
        ).toBe(
            "tenant-media/datasets/team-a/11111111-1111-4111-8111-111111111111.png",
        );
    });

    it("rejects missing credentials, unsafe prefixes, and implicit adapter selection", () => {
        vi.stubEnv("MOSAIC_STORAGE_ADAPTER", "r2");
        expect(() => getObjectStorageConfig()).toThrow(
            ObjectStorageConfigError,
        );

        vi.stubEnv("R2_ACCOUNT_ID", "synthetic-account");
        vi.stubEnv("R2_ACCESS_KEY_ID", "synthetic-access");
        vi.stubEnv("R2_SECRET_ACCESS_KEY", "synthetic-secret");
        vi.stubEnv("R2_BUCKET", "synthetic-media");
        vi.stubEnv("R2_STORAGE_PREFIX", "../other-tenant");
        vi.stubEnv("R2_ENDPOINT", "http://127.0.0.1:9000");
        expect(() => getObjectStorageConfig()).toThrow(
            /R2_STORAGE_PREFIX must contain safe alphanumeric path segments/,
        );

        vi.stubEnv("R2_STORAGE_PREFIX", "tenant-media");
        vi.stubEnv("MOSAIC_STORAGE_ADAPTER", "");
        expect(() => getObjectStorageConfig()).toThrow(
            /R2 storage settings are set but MOSAIC_STORAGE_ADAPTER is not/,
        );
    });
});
