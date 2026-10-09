import { Buffer } from "buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    deleteImage,
    getImageStorageConfig,
    ImageStorageConfigError,
    imageObjectPath,
    loadImage,
    putImage,
    storeImage,
} from "./source";

const originalEnv = { ...process.env };

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env = { ...originalEnv };
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = originalEnv;
});

describe("getImageStorageConfig", () => {
    it("defaults tests to the local adapter", () => {
        vi.stubEnv("NODE_ENV", "test");

        expect(getImageStorageConfig()).toEqual({ adapter: "local" });
    });

    it("defaults development to the local adapter", () => {
        vi.stubEnv("NODE_ENV", "development");

        expect(getImageStorageConfig()).toEqual({ adapter: "local" });
    });

    it("requires Supabase storage config outside explicit local mode", () => {
        vi.stubEnv("NODE_ENV", "production");
        delete process.env.SUPABASE_URL;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        delete process.env.SUPABASE_STORAGE_BUCKET;

        expect(() => getImageStorageConfig()).toThrow(ImageStorageConfigError);
    });

    it("rejects local image storage in production", () => {
        vi.stubEnv("NODE_ENV", "production");
        process.env.MOSAIC_STORAGE_ADAPTER = "local";

        expect(() => getImageStorageConfig()).toThrow(
            "MOSAIC_STORAGE_ADAPTER=local is not allowed in production",
        );
    });

    it("normalizes Supabase config", () => {
        vi.stubEnv("NODE_ENV", "production");
        process.env.SUPABASE_URL = "https://example.supabase.co/";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "secret";
        process.env.SUPABASE_STORAGE_BUCKET = "mosaic-images";
        process.env.SUPABASE_STORAGE_PREFIX = "/team-a/";

        expect(getImageStorageConfig()).toEqual({
            adapter: "supabase",
            supabaseUrl: "https://example.supabase.co",
            supabaseServiceRoleKey: "secret",
            supabaseStorageBucket: "mosaic-images",
            supabaseStoragePrefix: "team-a",
        });
    });
});

describe("Supabase image storage", () => {
    beforeEach(() => {
        vi.stubEnv("NODE_ENV", "production");
        process.env.SUPABASE_URL = "https://example.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "secret";
        process.env.SUPABASE_STORAGE_BUCKET = "mosaic-images";
        process.env.SUPABASE_STORAGE_PREFIX = "uploads";
    });

    it("uploads image bytes and returns a storage key", async () => {
        vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));

        const key = await storeImage(Buffer.from("image"), "image/png");

        expect(key).toMatch(/^[a-f0-9-]{36}$/i);
        expect(fetch).toHaveBeenCalledWith(
            `https://example.supabase.co/storage/v1/object/mosaic-images/uploads/${key}`,
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    apikey: "secret",
                    Authorization: "Bearer secret",
                    "Content-Type": "image/png",
                    "x-upsert": "false",
                }),
            }),
        );
        const [, init] = vi.mocked(fetch).mock.calls[0]!;
        expect(Buffer.from(init?.body as ArrayBuffer).toString()).toBe("image");
    });

    it("downloads bytes for run execution", async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(Buffer.from("image"), { status: 200 }),
        );

        const image = await loadImage(
            "11111111-1111-4111-8111-111111111111",
            "image/jpeg",
        );

        expect(image).toEqual({
            mimeType: "image/jpeg",
            base64Data: Buffer.from("image").toString("base64"),
        });
        expect(fetch).toHaveBeenCalledWith(
            "https://example.supabase.co/storage/v1/object/mosaic-images/uploads/11111111-1111-4111-8111-111111111111",
            expect.objectContaining({ method: "GET" }),
        );
    });

    it("removes the object path from Supabase Storage", async () => {
        vi.mocked(fetch).mockResolvedValue(new Response("[]", { status: 200 }));

        await deleteImage("11111111-1111-4111-8111-111111111111");

        expect(fetch).toHaveBeenCalledWith(
            "https://example.supabase.co/storage/v1/object/mosaic-images",
            expect.objectContaining({
                method: "DELETE",
                body: JSON.stringify({
                    prefixes: ["uploads/11111111-1111-4111-8111-111111111111"],
                }),
            }),
        );
    });

    it("uploads a fixed storage key for seed image restores", async () => {
        vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));

        await putImage(
            "11111111-1111-4111-8111-111111111111",
            Buffer.from("seed"),
            "image/jpeg",
            { upsert: true },
        );

        expect(fetch).toHaveBeenCalledWith(
            "https://example.supabase.co/storage/v1/object/mosaic-images/uploads/11111111-1111-4111-8111-111111111111",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    "Content-Type": "image/jpeg",
                    "x-upsert": "true",
                }),
            }),
        );
    });
});

describe("imageObjectPath", () => {
    it("applies the configured storage prefix", () => {
        process.env.SUPABASE_STORAGE_PREFIX = "/uploads/";

        expect(imageObjectPath("11111111-1111-4111-8111-111111111111")).toBe(
            "uploads/11111111-1111-4111-8111-111111111111",
        );
    });
});
