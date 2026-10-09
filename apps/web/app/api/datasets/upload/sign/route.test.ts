import { beforeEach, describe, expect, it, vi } from "vitest";
import { MosaicApiError } from "@mosaic/api-contract";
import { UnauthorizedError } from "@/server/auth/session";

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
