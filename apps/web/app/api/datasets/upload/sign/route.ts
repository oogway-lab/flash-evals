import { NextResponse } from "next/server";
import {
    MosaicApiError,
    type ISignedUploadFileRequest,
} from "@mosaic/api-contract";
import { requireActiveProject } from "@/server/projects/activeProject";
import { authErrorResponse } from "@/server/auth/http";
import { serverApiClient } from "@/server/api/client";

type UploadModality = "audio" | "image";

interface ISignUploadBody {
    datasetId?: unknown;
    modality?: unknown;
    files?: unknown;
}

function parseModality(value: unknown): UploadModality | undefined {
    return value === "audio" || value === "image" ? value : undefined;
}

function parseFiles(value: unknown): ISignedUploadFileRequest[] | undefined {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    const files: ISignedUploadFileRequest[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object") return undefined;
        const { fileName, byteSize, contentType } = entry as Record<
            string,
            unknown
        >;
        if (
            typeof fileName !== "string" ||
            typeof byteSize !== "number" ||
            !Number.isFinite(byteSize) ||
            typeof contentType !== "string"
        ) {
            return undefined;
        }
        files.push({ fileName, byteSize, contentType });
    }
    return files;
}

export async function POST(req: Request) {
    try {
        // Resolve team/project server-side from the authenticated principal +
        // active-project cookie (never trust client-supplied teamId/projectId).
        const principal = await requireActiveProject();

        let body: ISignUploadBody;
        try {
            body = (await req.json()) as ISignUploadBody;
        } catch {
            return NextResponse.json(
                { error: "Invalid JSON body." },
                { status: 400 },
            );
        }

        const datasetId =
            typeof body.datasetId === "string" ? body.datasetId : undefined;
        const modality = parseModality(body.modality);
        const files = parseFiles(body.files);

        if (!datasetId || !modality || !files) {
            return NextResponse.json(
                {
                    error: "Provide datasetId, modality, and a non-empty files array of { fileName, byteSize, contentType }.",
                },
                { status: 400 },
            );
        }

        const { targets } = await serverApiClient().createSignedUpload({
            teamId: principal.teamId,
            projectId: principal.projectId,
            datasetId,
            modality,
            files,
        });

        // Forward only what the browser needs to PUT bytes to storage.
        return NextResponse.json({
            targets: targets.map((target) => ({
                storageKey: target.storageKey,
                signedUrl: target.signedUrl,
                // R2 binds its create-only condition to the signed request.
                ...(target.headers ? { headers: target.headers } : {}),
                ...(target.expiresAt ? { expiresAt: target.expiresAt } : {}),
            })),
        });
    } catch (err) {
        const authResponse = authErrorResponse(err);
        if (authResponse) return authResponse;
        if (err instanceof MosaicApiError) {
            return NextResponse.json(
                { error: err.message },
                { status: err.status },
            );
        }
        return NextResponse.json(
            { error: "Could not prepare the upload. Please try again." },
            { status: 500 },
        );
    }
}
