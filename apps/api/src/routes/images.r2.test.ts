import { describe, expect, it, vi } from "vitest";
import * as ObjectStorage from "@mosaic/object-storage";
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import { imageResponsePayload } from "./images.js";

const r2Mocks = vi.hoisted(() => ({
    getR2Object: vi.fn(),
}));

vi.mock("@mosaic/object-storage", async (importOriginal) => ({
    ...(await importOriginal<typeof ObjectStorage>()),
    getR2Object: r2Mocks.getR2Object,
}));

const storageKey =
    "datasets/dataset-1/11111111-1111-4111-8111-111111111111.png";
const r2Storage = {
    accountId: "synthetic-account",
    accessKeyId: "synthetic-access",
    secretAccessKey: "synthetic-secret",
    bucket: "synthetic-media",
    prefix: "tenant-media",
    endpoint: "http://127.0.0.1:9000",
};
const config: IApiConfig = {
    nodeEnv: "test",
    port: 3001,
    databaseUrl: "postgres://synthetic",
    storageAdapter: "r2",
    r2Storage,
    supabaseUrl: "",
    supabaseServiceRoleKey: "",
    supabaseStorageBucket: "",
    clerkSecretKey: "sk_test",
    mosaicTenancyMode: "single-org",
    mosaicAllowedEmailDomain: "example.com",
    mosaicLlmProvider: "openai",
    corsOrigins: [],
    sttCapabilityProbes: {},
    profilingEnabled: false,
    featureFlags: {} as IApiConfig["featureFlags"],
};

function imageDb(rows: unknown[]) {
    return {
        query: vi.fn(async () => ({ rows }) as never),
    } as unknown as IDb;
}

describe("R2 API image reads", () => {
    it("serves a private image only after the team and project lookup succeeds", async () => {
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        r2Mocks.getR2Object.mockResolvedValue(bytes);
        const response = await imageResponsePayload(
            imageDb([
                {
                    team_id: "team-1",
                    project_id: "project-1",
                    mime_type: "image/png",
                },
            ]),
            config,
            "team-1",
            "project-1",
            storageKey,
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/png");
        expect(response.headers.get("cache-control")).toBe(
            "private, max-age=3600",
        );
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        await expect(response.arrayBuffer()).resolves.toEqual(
            bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
            ),
        );
        expect(r2Mocks.getR2Object).toHaveBeenCalledWith(r2Storage, storageKey);
    });

    it("does not request R2 for a different tenant/project and hides missing objects", async () => {
        await expect(
            imageResponsePayload(
                imageDb([
                    {
                        team_id: "team-1",
                        project_id: "project-1",
                        mime_type: "image/png",
                    },
                ]),
                config,
                "team-other",
                "project-1",
                storageKey,
            ),
        ).rejects.toThrow("Not found");
        expect(r2Mocks.getR2Object).not.toHaveBeenCalled();

        r2Mocks.getR2Object.mockRejectedValue(
            new ObjectStorage.R2StorageError(
                "Failed to download object in R2 (404)",
                404,
                "NoSuchKey",
            ),
        );
        await expect(
            imageResponsePayload(
                imageDb([
                    {
                        team_id: "team-1",
                        project_id: "project-1",
                        mime_type: "image/png",
                    },
                ]),
                config,
                "team-1",
                "project-1",
                storageKey,
            ),
        ).rejects.toThrow("Not found");
    });
});
