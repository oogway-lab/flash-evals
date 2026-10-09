import { beforeEach, describe, expect, it, vi } from "vitest";

const requireActiveProject = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/projects/activeProject", () => ({
    requireActiveProject: () => requireActiveProject(),
}));
vi.mock("@/server/api/client", () => ({
    serverApiConfig: () => ({
        baseUrl: "http://api.local",
        internalToken: "token",
    }),
}));

import { GET } from "./route";

const LEGACY_KEY = "00000000-0000-4000-8000-000000000001";
const DATASET_KEY = "datasets/ds-1/00000000-0000-4000-8000-000000000001.jpeg";

function call(segments: string[]) {
    return GET(new Request("http://localhost/api/images"), {
        params: Promise.resolve({ key: segments }),
    });
}

function requestedUrl(): URL {
    return new URL(String(fetchMock.mock.calls[0]?.[0]));
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    requireActiveProject.mockResolvedValue({
        teamId: "team-1",
        projectId: "project-1",
    });
    fetchMock.mockResolvedValue(
        new Response("bytes", {
            headers: { "content-type": "image/jpeg" },
        }),
    );
});

describe("GET /api/images/[...key]", () => {
    it("serves a dataset-scoped key minted by the signed-upload endpoint", async () => {
        // These keys contain slashes, so a single dynamic segment never
        // matched them and every signed upload 404'd.
        const response = await call(DATASET_KEY.split("/"));

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("image/jpeg");
        // The API matches one path segment and decodes it, so the key must
        // travel encoded rather than as extra path segments.
        expect(requestedUrl().pathname).toBe(
            `/api/images/${encodeURIComponent(DATASET_KEY)}`,
        );
    });

    it("still serves a legacy bare-uuid key", async () => {
        const response = await call([LEGACY_KEY]);

        expect(response.status).toBe(200);
        expect(requestedUrl().pathname).toBe(`/api/images/${LEGACY_KEY}`);
    });

    it("scopes the upstream request to the caller's team and project", async () => {
        await call(DATASET_KEY.split("/"));

        const url = requestedUrl();
        expect(url.searchParams.get("teamId")).toBe("team-1");
        expect(url.searchParams.get("projectId")).toBe("project-1");
    });

    it.each([
        ["a traversal attempt", ["datasets", "..", "secret.jpeg"]],
        ["an unrecognised shape", ["not-a-key"]],
        ["an empty key", []],
    ])("rejects %s without calling the API", async (_label, segments) => {
        const response = await call(segments);

        expect(response.status).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns 404 when the API has no such object", async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

        const response = await call(DATASET_KEY.split("/"));

        expect(response.status).toBe(404);
    });
});
