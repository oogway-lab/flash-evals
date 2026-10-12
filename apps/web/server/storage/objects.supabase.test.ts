import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadObjectBytes, ObjectStorageError } from "./objects";

const STORAGE_KEY = "00000000-0000-4000-8000-000000000001";
const UPSTREAM_BODY =
    '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}';

describe("Supabase storage errors", () => {
    beforeEach(() => {
        vi.stubEnv("MOSAIC_STORAGE_ADAPTER", "supabase");
        vi.stubEnv("SUPABASE_URL", "https://project.supabase.example");
        vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
        vi.stubEnv("SUPABASE_STORAGE_BUCKET", "media");
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(UPSTREAM_BODY, { status: 403 })),
        );
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("keeps the upstream response body out of the error message", async () => {
        const error = await loadObjectBytes(STORAGE_KEY).catch(
            (err: unknown) => err,
        );

        expect(error).toBeInstanceOf(ObjectStorageError);
        const storageError = error as ObjectStorageError;
        expect(storageError.message).toBe(
            "Failed to download object in Supabase Storage (403)",
        );
        expect(storageError.message).not.toContain("row-level security");
        expect(storageError.status).toBe(403);
        expect(storageError.responseBody).toBe(UPSTREAM_BODY);
    });
});
