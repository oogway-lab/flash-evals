import { Buffer } from "buffer";
import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    audioFilePath,
    audioObjectPath,
    deleteAudio,
    loadAudioBytes,
    normalizeAudioMimeType,
    putAudio,
    storeAudio,
} from "./source";

const originalEnv = { ...process.env };
let uploadDir: string | undefined;

beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn());
    process.env = { ...originalEnv };
    uploadDir = await mkdtemp(path.join(os.tmpdir(), "mosaic-audio-"));
    process.env.UPLOAD_DIR = uploadDir;
});

afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = originalEnv;
    if (uploadDir) {
        await rm(uploadDir, { recursive: true, force: true });
        uploadDir = undefined;
    }
});

describe("local audio storage", () => {
    it("stores audio bytes on local disk by default in development", async () => {
        vi.stubEnv("NODE_ENV", "development");

        const stored = await storeAudio(Buffer.from("audio"), "audio/webm");

        expect(stored).toMatchObject({ mimeType: "audio/webm" });
        expect(stored.storageKey).toMatch(/^[a-f0-9-]{36}$/i);
        expect(await readFile(audioFilePath(stored.storageKey), "utf8")).toBe(
            "audio",
        );
        expect(await loadAudioBytes(stored.storageKey)).toEqual(
            Buffer.from("audio"),
        );
    });

    it("deletes stored local audio bytes", async () => {
        vi.stubEnv("NODE_ENV", "development");
        const stored = await storeAudio(Buffer.from("audio"), "audio/wav");

        await deleteAudio(stored.storageKey);

        await expect(readFile(audioFilePath(stored.storageKey))).rejects.toThrow();
    });

    it("resolves relative upload directories from the app workspace root", () => {
        process.env.UPLOAD_DIR = ".uploads";

        expect(audioFilePath("11111111-1111-4111-8111-111111111111")).toBe(
            path.resolve(
                process.cwd(),
                "../..",
                ".uploads",
                "11111111-1111-4111-8111-111111111111",
            ),
        );
    });
});

describe("Supabase audio storage", () => {
    beforeEach(() => {
        vi.stubEnv("NODE_ENV", "production");
        process.env.SUPABASE_URL = "https://example.supabase.co";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "secret";
        process.env.SUPABASE_STORAGE_BUCKET = "mosaic-media";
        process.env.SUPABASE_STORAGE_PREFIX = "uploads";
    });

    it("uploads audio bytes to Supabase in production", async () => {
        vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));

        await putAudio(
            "11111111-1111-4111-8111-111111111111",
            Buffer.from("audio"),
            "audio/mpeg",
        );

        expect(fetch).toHaveBeenCalledWith(
            "https://example.supabase.co/storage/v1/object/mosaic-media/uploads/11111111-1111-4111-8111-111111111111",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    apikey: "secret",
                    Authorization: "Bearer secret",
                    "Content-Type": "audio/mpeg",
                    "x-upsert": "false",
                }),
            }),
        );
    });

    it("uses the configured object prefix for audio paths", () => {
        expect(audioObjectPath("11111111-1111-4111-8111-111111111111")).toBe(
            "uploads/11111111-1111-4111-8111-111111111111",
        );
    });
});

describe("audio MIME types", () => {
    it("normalizes supported audio MIME types", () => {
        expect(normalizeAudioMimeType(" AUDIO/WEBM ")).toBe("audio/webm");
    });

    it("rejects unsupported audio MIME types", () => {
        expect(() => normalizeAudioMimeType("text/plain")).toThrow(
            "Unsupported audio type: text/plain",
        );
    });
});
