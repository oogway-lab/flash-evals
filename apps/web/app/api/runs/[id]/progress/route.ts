import { NextResponse } from "next/server";
import { MosaicApiError } from "@mosaic/api-contract";
import { requireActiveProject } from "@/server/projects/activeProject";
import { authErrorResponse } from "@/server/auth/http";
import { serverApiClient } from "@/server/api/client";

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const principal = await requireActiveProject();
        const result = await serverApiClient().getRunProgressResult(
            principal.teamId,
            principal.projectId,
            id,
        );
        const response = NextResponse.json(result.data);
        if (result.requestId)
            response.headers.set("x-request-id", result.requestId);
        return response;
    } catch (err) {
        const authResponse = authErrorResponse(err);
        if (authResponse) return authResponse;
        if (err instanceof MosaicApiError && err.status === 404) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        throw err;
    }
}
