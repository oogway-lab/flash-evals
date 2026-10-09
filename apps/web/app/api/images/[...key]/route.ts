import { authErrorResponse } from "@/server/auth/http";
import { serverApiConfig } from "@/server/api/client";
import { requireActiveProject } from "@/server/projects/activeProject";
import { isStorageKey } from "@/server/storage/objects";

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ key: string[] }> },
) {
    // Catch-all because dataset-scoped keys minted by the signed-upload
    // endpoint contain slashes (`datasets/<datasetId>/<uuid><ext>`). A single
    // dynamic segment never matched them, so every image uploaded through the
    // signed path 404'd before any validation ran.
    const { key: segments } = await params;
    const key = (segments ?? []).map(decodeURIComponent).join("/");
    if (!isStorageKey(key)) {
        return new Response("Not found", { status: 404 });
    }

    try {
        const principal = await requireActiveProject();
        const { baseUrl, internalToken } = serverApiConfig();
        // The API matches a single path segment and decodes it, so the key
        // must travel encoded rather than as extra path segments.
        const url = new URL(`/api/images/${encodeURIComponent(key)}`, baseUrl);
        url.searchParams.set("teamId", principal.teamId);
        url.searchParams.set("projectId", principal.projectId);
        const response = await fetch(url, {
            headers: internalToken
                ? { "X-Mosaic-Internal-Token": internalToken }
                : undefined,
            cache: "no-store",
        });
        if (!response.ok || !response.body) {
            return new Response("Not found", { status: 404 });
        }

        const requestId = response.headers.get("x-request-id") ?? undefined;
        return new Response(response.body, {
            headers: {
                "Content-Type":
                    response.headers.get("content-type") ??
                    "application/octet-stream",
                "Cache-Control": "private, max-age=3600",
                ...(requestId ? { "x-request-id": requestId } : {}),
            },
        });
    } catch (err) {
        const authResponse = authErrorResponse(err);
        if (authResponse) return authResponse;
        return new Response("Not found", { status: 404 });
    }
}
