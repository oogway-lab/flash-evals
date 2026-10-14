import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import { ApiNotFoundError } from "../errors.js";
import { getR2Object } from "@mosaic/object-storage";
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
    range: string | null = null,
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
        const bytes = await fs
            .readFile(localMediaPath(storageKey))
            .catch(() => {
                throw new ApiNotFoundError();
            });
        return mediaBytesResponse(bytes, access.mime_type, range);
    }

    if (config.storageAdapter === "r2") {
        try {
            const bytes = await getR2Object(config.r2Storage!, storageKey);
            return mediaBytesResponse(bytes, access.mime_type, range);
        } catch {
            throw new ApiNotFoundError();
        }
    }

    const response = await fetchWithTimeout(
        supabaseObjectUrl(config, storageKey),
        {
            method: "GET",
            headers: {
                ...supabaseHeaders(config),
                ...(range ? { Range: range } : {}),
            },
        },
    );
    if (response.status === 416) {
        return new Response(null, {
            status: 416,
            headers: {
                "Content-Range":
                    response.headers.get("content-range") ?? "bytes */*",
            },
        });
    }
    if (!response.ok || !response.body) throw new ApiNotFoundError();
    return new Response(response.body, {
        status: response.status,
        headers: {
            "Content-Type": access.mime_type,
            "Cache-Control": "private, max-age=3600",
            ...Object.fromEntries(
                ["content-length", "content-range", "accept-ranges"].flatMap(
                    (name) => {
                        const value = response.headers.get(name);
                        return value ? [[name, value]] : [];
                    },
                ),
            ),
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

function supabaseHeaders(config: IApiConfig) {
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

/** Serve a single byte range so browsers can determine duration and seek audio. */
export function mediaBytesResponse(
    bytes: Uint8Array,
    contentType: string,
    range: string | null,
): Response {
    const size = bytes.byteLength;
    const headers = new Headers({
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
        "Content-Length": String(size),
    });
    // Malformed and multi-range requests may be ignored; do not claim support
    // for multipart responses that we cannot produce.
    const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
        return new Response(Uint8Array.from(bytes), { headers });
    const start = match[1]
        ? Number(match[1])
        : Math.max(0, size - Number(match[2]));
    const end =
        match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= size ||
        (!match[1] && Number(match[2]) === 0)
    ) {
        headers.set("Content-Range", `bytes */${size}`);
        headers.set("Content-Length", "0");
        return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(Uint8Array.from(bytes.subarray(start, end + 1)), {
        status: 206,
        headers,
    });
}
