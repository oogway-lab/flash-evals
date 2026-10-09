import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import { ApiNotFoundError } from "../errors.js";
import { promises as fs } from "node:fs";
import { isStorageKey, localMediaPath } from "../mediaPaths.js";

interface IImageAccessRow {
    team_id: string;
    project_id: string;
    mime_type: string | null;
}

export async function imageResponsePayload(
    db: IDb,
    config: IApiConfig,
    teamId: string,
    projectId: string,
    storageKey: string,
): Promise<Response> {
    if (!isStorageKey(storageKey)) throw new ApiNotFoundError();
    const access = await getImageAccessForStorageKey(db, storageKey);
    if (
        !access ||
        access.team_id !== teamId ||
        access.project_id !== projectId ||
        !access.mime_type
    ) {
        throw new ApiNotFoundError();
    }

    if (config.storageAdapter === "local") {
        const bytes = await fs.readFile(localMediaPath(storageKey)).catch(() => {
            throw new ApiNotFoundError();
        });
        return new Response(bytes, {
            headers: {
                "Content-Type": access.mime_type,
                "Cache-Control": "private, max-age=3600",
            },
        });
    }

    const response = await fetchWithTimeout(supabaseObjectUrl(config, storageKey), {
        method: "GET",
        headers: supabaseHeaders(config),
    });
    if (!response.ok || !response.body) throw new ApiNotFoundError();
    return new Response(response.body, {
        headers: {
            "Content-Type": access.mime_type,
            "Cache-Control": "private, max-age=3600",
        },
    });
}

async function getImageAccessForStorageKey(
    db: IDb,
    storageKey: string,
): Promise<IImageAccessRow | undefined> {
    const result = await db.query<IImageAccessRow>(
        `select d.team_id, d.project_id, di.mime_type
        from dataset_items di
        inner join datasets d on di.dataset_id = d.id
        where di.storage_key = $1
        limit 1`,
        [storageKey],
    );
    return result.rows[0];
}

function supabaseObjectUrl(config: IApiConfig, storageKey: string): string {
    const bucket = encodeURIComponent(config.supabaseStorageBucket);
    const objectPath = encodeObjectPath(
        config.supabaseStoragePrefix
            ? `${config.supabaseStoragePrefix}/${storageKey}`
            : storageKey,
    );
    return `${config.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${objectPath}`;
}

function encodeObjectPath(objectPath: string): string {
    return objectPath.split("/").map(encodeURIComponent).join("/");
}

function supabaseHeaders(config: IApiConfig): HeadersInit {
    const token = config.supabaseServiceRoleKey;
    return {
        apikey: token,
        Authorization: `Bearer ${token}`,
    };
}

async function fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = 15_000,
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}
