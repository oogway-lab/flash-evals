import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ObjectStorage from "@mosaic/object-storage";
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import { importImagesPayload, signUploadPayload } from "./datasets.js";

const r2Mocks = vi.hoisted(() => ({
    createR2SignedUploadUrl: vi.fn(),
    headR2Object: vi.fn(),
    getR2ObjectPrefix: vi.fn(),
    putR2Object: vi.fn(),
    deleteR2Object: vi.fn(),
}));

vi.mock("@mosaic/object-storage", async (importOriginal) => ({
    ...(await importOriginal<typeof ObjectStorage>()),
    createR2SignedUploadUrl: r2Mocks.createR2SignedUploadUrl,
    headR2Object: r2Mocks.headR2Object,
    getR2ObjectPrefix: r2Mocks.getR2ObjectPrefix,
    putR2Object: r2Mocks.putR2Object,
    deleteR2Object: r2Mocks.deleteR2Object,
}));

const STORAGE_KEY =
    "datasets/dataset-1/11111111-1111-4111-8111-111111111111.png";
const DATASET = {
    id: "dataset-1",
    team_id: "team-1",
    project_id: "project-1",
    name: "Dataset",
    purpose: "evaluation" as const,
    modality: "image" as const,
    pipeline_id: null,
    description: null,
    archived_at: null,
    created_by: "user-1",
    created_at: new Date(),
};
const PNG_HEAD = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
]);
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

function dbWithRows(rows: unknown[][]): IDb {
    const queue = [...rows];
    return {
        query: vi.fn(async () => ({ rows: queue.shift() ?? [] }) as never),
    };
}

describe("R2 dataset media routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        r2Mocks.createR2SignedUploadUrl.mockResolvedValue(
            "https://signed.example/put/synthetic",
        );
        r2Mocks.headR2Object.mockResolvedValue({
            byteSize: PNG_HEAD.byteLength,
            contentType: "image/png",
        });
        r2Mocks.getR2ObjectPrefix.mockResolvedValue(PNG_HEAD);
    });

    it("returns a dataset-scoped URL signed for the declared content type and short expiry", async () => {
        const result = await signUploadPayload(
            dbWithRows([[{ id: "project-1" }]]),
            config,
            {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                modality: "image",
                files: [
                    {
                        fileName: "plate.png",
                        byteSize: PNG_HEAD.byteLength,
                        contentType: "image/png",
                    },
                ],
            },
        );

        expect(result.targets).toHaveLength(1);
        expect(result.targets[0]?.storageKey).toMatch(
            /^datasets\/dataset-1\/[a-f0-9-]{36}\.png$/,
        );
        expect(result.targets[0]?.signedUrl).toBe(
            "https://signed.example/put/synthetic",
        );
        expect(result.targets[0]?.headers).toEqual({ "If-None-Match": "*" });
        expect(result.targets[0]?.expiresAt).toBeTruthy();
        expect(r2Mocks.createR2SignedUploadUrl).toHaveBeenCalledWith(
            r2Storage,
            result.targets[0]?.storageKey,
            "image/png",
        );
    });

    it("checks R2 object size and magic bytes before linking media to a dataset", async () => {
        const db = dbWithRows([[DATASET], [], [DATASET], [{ id: "item-1" }]]);
        await expect(
            importImagesPayload(db, config, {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                images: [
                    {
                        name: "plate.png",
                        mimeType: "image/png",
                        size: PNG_HEAD.byteLength,
                        storageKey: STORAGE_KEY,
                    },
                ],
            }),
        ).resolves.toEqual({ importedCount: 1, failures: [] });
        expect(r2Mocks.headR2Object).toHaveBeenCalledWith(
            r2Storage,
            STORAGE_KEY,
        );
        expect(r2Mocks.getR2ObjectPrefix).toHaveBeenCalledWith(
            r2Storage,
            STORAGE_KEY,
            16,
        );
    });

    it("rejects oversized, missing, denied, and cross-dataset objects without linking them", async () => {
        r2Mocks.headR2Object.mockResolvedValueOnce({
            byteSize: 20 * 1024 * 1024 + 1,
            contentType: "image/png",
        });
        const oversized = await importImagesPayload(
            dbWithRows([[DATASET], []]),
            config,
            {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                images: [
                    {
                        name: "large.png",
                        mimeType: "image/png",
                        size: 100,
                        storageKey: STORAGE_KEY,
                    },
                ],
            },
        );
        expect(oversized.failures[0]?.reason).toContain("per-file limit");
        expect(r2Mocks.getR2ObjectPrefix).not.toHaveBeenCalled();

        r2Mocks.headR2Object.mockRejectedValueOnce(
            new ObjectStorage.R2StorageError(
                "Failed to verify object in R2 (403)",
                403,
                "AccessDenied",
            ),
        );
        const denied = await importImagesPayload(
            dbWithRows([[DATASET], []]),
            config,
            {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                images: [
                    {
                        name: "denied.png",
                        mimeType: "image/png",
                        size: 100,
                        storageKey: STORAGE_KEY,
                    },
                ],
            },
        );
        expect(denied.failures[0]?.reason).toContain(
            "could not be verified (status 403)",
        );

        r2Mocks.headR2Object.mockRejectedValueOnce(
            new ObjectStorage.R2StorageError(
                "Failed to verify object in R2 (404)",
                404,
                "NoSuchKey",
            ),
        );
        const missing = await importImagesPayload(
            dbWithRows([[DATASET], []]),
            config,
            {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-1",
                images: [
                    {
                        name: "missing.png",
                        mimeType: "image/png",
                        size: 100,
                        storageKey: STORAGE_KEY,
                    },
                ],
            },
        );
        expect(missing.failures[0]?.reason).toContain(
            "Uploaded object not found",
        );

        await importImagesPayload(
            dbWithRows([[{ ...DATASET, id: "dataset-2" }], []]),
            config,
            {
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "dataset-2",
                images: [
                    {
                        name: "foreign.png",
                        mimeType: "image/png",
                        size: 100,
                        storageKey: STORAGE_KEY,
                    },
                ],
            },
        );
        expect(r2Mocks.headR2Object).toHaveBeenCalledTimes(3);
    });
});
