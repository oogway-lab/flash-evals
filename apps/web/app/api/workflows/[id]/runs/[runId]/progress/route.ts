import { NextResponse } from "next/server";
import { MosaicApiError } from "@mosaic/api-contract";
import { authErrorResponse } from "@/server/auth/http";
import { serverApiClient } from "@/server/api/client";
import { requireActiveProject } from "@/server/projects/activeProject";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string; runId: string }> },
) {
    try {
        const { id, runId } = await params;
        const principal = await requireActiveProject();
        return NextResponse.json(
            await serverApiClient().getWorkflowRunProgress(
                principal.teamId,
                principal.projectId,
                id,
                runId,
            ),
        );
    } catch (error) {
        const authResponse = authErrorResponse(error);
        if (authResponse) return authResponse;
        if (error instanceof MosaicApiError && error.status === 404)
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        throw error;
    }
}
