import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MosaicApiError } from "@mosaic/api-contract";
import { UnauthorizedError } from "@/server/auth/session";
import { uploadFiles } from "@/lib/uploads/direct-upload";

const mockApiClient = vi.hoisted(() => ({
    createSignedUpload: vi.fn(),
}));

const requireActiveProject = vi.hoisted(() => vi.fn());

vi.mock("@/server/projects/activeProject", () => ({
    requireActiveProject: () => requireActiveProject(),
}));
vi.mock("@/server/api/client", () => ({
    serverApiClient: () => mockApiClient,
}));

import { POST } from "./route";

function post(body: unknown): Request {
    return new Request("http://localhost/api/datasets/upload/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

const validBody = {
    datasetId: "ds-1",
    modality: "image" as const,
    files: [{ fileName: "a.png", byteSize: 1024, contentType: "image/png" }],
};

beforeEach(() => {
    vi.clearAllMocks();
    requireActiveProject.mockResolvedValue({
        teamId: "team-1",
        projectId: "project-1",
        userId: "user-1",
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("POST /api/datasets/upload/sign", () => {
    it("forwards an authed request and returns signed targets", async () => {
        mockApiClient.createSignedUpload.mockResolvedValue({
            targets: [
                {
                    storageKey: "datasets/ds-1/abc.png",
                    signedUrl: "https://storage.example/sign?token=xyz",
                    token: "xyz",
                    expiresAt: "2026-07-13T18:00:00.000Z",
                },
            ],
        });

        const res = await POST(post(validBody));
        expect(res.status).toBe(200);

        const json = await res.json();
        expect(json).toEqual({
            targets: [
                {
                    storageKey: "datasets/ds-1/abc.png",
                    signedUrl: "https://storage.example/sign?token=xyz",
                    expiresAt: "2026-07-13T18:00:00.000Z",
                },
            ],
        });
        // Team/project resolved server-side, not trusted from the client body.
        expect(mockApiClient.createSignedUpload).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "ds-1",
            modality: "image",
            files: validBody.files,
        });
    });

    it.each([
        {
            modality: "image" as const,
            fileName: "a.png",
            contentType: "image/png",
        },
        {
            modality: "audio" as const,
            fileName: "a.wav",
            contentType: "audio/wav",
        },
    ])(
        "preserves create-only headers through the broker and browser for $modality uploads",
        async ({ modality, fileName, contentType }) => {
            const storageKey = `datasets/ds-1/${fileName}`;
            const signedUrl = "https://storage.example/create-only";
            mockApiClient.createSignedUpload.mockResolvedValue({
                targets: [
                    {
                        storageKey,
                        signedUrl,
                        headers: { "If-None-Match": "*" },
                    },
                ],
            });
            let storedFile: File | undefined;
            const fetchMock = vi.fn(
                async (input: RequestInfo | URL, init: RequestInit) => {
                    if (input === "/api/datasets/upload/sign") {
                        return POST(
                            new Request(
                                "http://localhost/api/datasets/upload/sign",
                                init,
                            ),
                        );
                    }
                    expect(input).toBe(signedUrl);
                    expect(init.method).toBe("PUT");
                    const headers = new Headers(init.headers);
                    expect(headers.get("Content-Type")).toBe(contentType);
                    expect(headers.get("If-None-Match")).toBe("*");
                    expect(headers.has("x-upsert")).toBe(false);
                    if (headers.get("If-None-Match") !== "*") {
                        return new Response(null, { status: 403 });
                    }
                    if (storedFile) return new Response(null, { status: 412 });
                    storedFile = init.body as File;
                    return new Response(null, { status: 200 });
                },
            );
            vi.stubGlobal("fetch", fetchMock);
            const file = new File(["original"], fileName, {
                type: contentType,
            });
            const result = await uploadFiles({
                datasetId: "ds-1",
                modality,
                files: [file],
            });
            expect(result.failures).toEqual([]);
            expect(result.uploaded).toEqual([
                { storageKey, fileName, contentType, byteSize: file.size },
            ]);
            expect(storedFile).toBe(file);

            // An already-created key must stay protected; a 412 must not trigger
            // an unconditional retry that could replace the original bytes.
            const replacement = new File(["replacement"], fileName, {
                type: contentType,
            });
            const retry = await uploadFiles({
                datasetId: "ds-1",
                modality,
                files: [replacement],
            });
            expect(retry.uploaded).toEqual([]);
            expect(retry.failures).toHaveLength(1);
            expect(retry.failures[0].error).toMatchObject({
                kind: "storage",
                fileName,
            });
            expect(retry.failures[0].error.message).toContain("412");
            expect(storedFile).toBe(file);
            expect(fetchMock).toHaveBeenCalledTimes(4);
            expect(mockApiClient.createSignedUpload).toHaveBeenCalledWith({
                teamId: "team-1",
                projectId: "project-1",
                datasetId: "ds-1",
                modality,
                files: [{ fileName, byteSize: replacement.size, contentType }],
            });
        },
    );

    it("returns 401 and does not call the API when unauthenticated", async () => {
        requireActiveProject.mockRejectedValue(
            new UnauthorizedError("Sign in required."),
        );

        const res = await POST(post(validBody));
        expect(res.status).toBe(401);
        await expect(res.json()).resolves.toEqual({
            error: "Sign in required.",
        });
        expect(mockApiClient.createSignedUpload).not.toHaveBeenCalled();
    });

    it("forwards a MosaicApiError 400 as a 400 with the friendly reason", async () => {
        mockApiClient.createSignedUpload.mockRejectedValue(
            new MosaicApiError(
                "Image import exceeds the 24MB batch limit.",
                400,
            ),
        );

        const res = await POST(post(validBody));
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toEqual({
            error: "Image import exceeds the 24MB batch limit.",
        });
    });

    it("returns 400 for a malformed body without calling the API", async () => {
        const res = await POST(post({ datasetId: "ds-1", modality: "nope" }));
        expect(res.status).toBe(400);
        expect(mockApiClient.createSignedUpload).not.toHaveBeenCalled();
    });
});
