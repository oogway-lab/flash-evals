import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadObjectBytes, putObject } from "./objects";

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
        const key = "6352ac02-29e9-4149-860b-73fd40f0e972";
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
