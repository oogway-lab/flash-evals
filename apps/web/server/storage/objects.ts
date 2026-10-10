import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
    createR2StorageConfig,
    deleteR2Object,
    getR2Object,
    putR2Object,
    r2ObjectKey,
    type IR2StorageConfig,
} from "@mosaic/object-storage";

export type ObjectStorageAdapter = "supabase" | "local" | "r2";

export class ObjectStorageConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ObjectStorageConfigError";
    }
}

export class ObjectStorageError extends Error {
    constructor(
        message: string,
        readonly status?: number,
        // Upstream response text. Kept off `message` so it can be logged
        // without ever being shown to a user.
        readonly responseBody?: string,
    ) {
        super(message);
        this.name = "ObjectStorageError";
    }
}

export interface IObjectStorageConfig {
    adapter: ObjectStorageAdapter;
    supabaseUrl?: string;
    supabaseServiceRoleKey?: string;
    supabaseStorageBucket?: string;
    supabaseStoragePrefix?: string;
    r2Storage?: IR2StorageConfig;
}

export async function storeObject(
    bytes: Buffer,
    mimeType: string,
): Promise<string> {
    const key = randomUUID();
    await putObject(key, bytes, mimeType);
    return key;
}

export async function putObject(
    storageKey: string,
    bytes: Buffer,
    mimeType: string,
    options: { upsert?: boolean } = {},
): Promise<void> {
    assertStorageKey(storageKey);
    const config = getObjectStorageConfig();

    if (config.adapter === "local") {
        const filePath = objectFilePath(storageKey);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, bytes);
        return;
    }

    if (config.adapter === "r2") {
        await putR2Object(config.r2Storage!, storageKey, bytes, mimeType);
        return;
    }

    await uploadToSupabase(config, storageKey, bytes, mimeType, options.upsert);
}

export async function deleteObject(storageKey: string): Promise<void> {
    assertStorageKey(storageKey);
    const config = getObjectStorageConfig();

    if (config.adapter === "local") {
        await fs.rm(objectFilePath(storageKey), { force: true });
        return;
    }

    if (config.adapter === "r2") {
        await deleteR2Object(config.r2Storage!, storageKey);
        return;
    }

    await deleteFromSupabase(config, storageKey);
}

export async function loadObjectBytes(storageKey: string): Promise<Buffer> {
    assertStorageKey(storageKey);
    const config = getObjectStorageConfig();

    if (config.adapter === "local") {
        return fs.readFile(objectFilePath(storageKey));
    }

    if (config.adapter === "r2") {
        return getR2Object(config.r2Storage!, storageKey);
    }

    return downloadFromSupabase(config, storageKey);
}

// Local storage is the default for development and tests. Production defaults
// to Supabase; R2 must be selected explicitly in each server environment.
export function getObjectStorageConfig(
    env: NodeJS.ProcessEnv = process.env,
): IObjectStorageConfig {
    const adapter = resolveAdapter(env);
    if (adapter === "local") return { adapter };

    if (adapter === "r2") {
        try {
            return {
                adapter,
                r2Storage: createR2StorageConfig(env),
            };
        } catch (error) {
            throw new ObjectStorageConfigError(
                error instanceof Error
                    ? error.message
                    : "Invalid R2 storage configuration.",
            );
        }
    }

    const required = [
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_STORAGE_BUCKET",
    ] as const;
    const missing = required.filter((key) => !env[key]?.trim());
    if (missing.length > 0) {
        throw new ObjectStorageConfigError(
            `Missing Supabase Storage env var(s): ${missing.join(", ")}`,
        );
    }

    return {
        adapter,
        supabaseUrl: env.SUPABASE_URL!.replace(/\/+$/, ""),
        supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
        supabaseStorageBucket: env.SUPABASE_STORAGE_BUCKET!,
        supabaseStoragePrefix: normalizePrefix(env.SUPABASE_STORAGE_PREFIX),
    };
}

export function objectPath(storageKey: string): string {
    assertStorageKey(storageKey);
    const config = getObjectStorageConfig();
    if (config.adapter === "r2") {
        return r2ObjectKey(config.r2Storage!, storageKey);
    }
    const prefix = normalizePrefix(process.env.SUPABASE_STORAGE_PREFIX);
    return prefix ? `${prefix}/${storageKey}` : storageKey;
}

export function objectFilePath(storageKey: string): string {
    assertStorageKey(storageKey);
    const baseDir = uploadDir(process.env.UPLOAD_DIR);
    return path.join(baseDir, storageKey);
}

function uploadDir(configured: string | undefined): string {
    const trimmed = configured?.trim();
    if (!trimmed) return defaultUploadDir();
    if (path.isAbsolute(trimmed)) return trimmed;
    return path.resolve(appWorkspaceRoot(), trimmed);
}

function defaultUploadDir(): string {
    return path.join(appWorkspaceRoot(), ".uploads");
}

function appWorkspaceRoot(): string {
    const cwd = process.cwd();
    if (path.basename(path.dirname(cwd)) === "apps") {
        return path.resolve(cwd, "../..");
    }
    return cwd;
}

function resolveAdapter(env: NodeJS.ProcessEnv): ObjectStorageAdapter {
    const requested = (
        env.MOSAIC_STORAGE_ADAPTER ??
        env.MOSAIC_IMAGE_STORAGE_ADAPTER ??
        ""
    )
        .trim()
        .toLowerCase();
    if (requested === "local") {
        if (env.NODE_ENV === "production") {
            throw new ObjectStorageConfigError(
                "MOSAIC_STORAGE_ADAPTER=local is not allowed in production",
            );
        }
        return "local";
    }
    if (requested === "r2") return "r2";
    if (requested && requested !== "supabase") {
        throw new ObjectStorageConfigError(
            `Unsupported MOSAIC_STORAGE_ADAPTER value: ${requested}`,
        );
    }
    if (requested === "supabase") return "supabase";

    const hasR2Settings = [
        env.R2_ACCOUNT_ID,
        env.R2_ACCESS_KEY_ID,
        env.R2_SECRET_ACCESS_KEY,
        env.R2_BUCKET,
    ].some((value) => Boolean(value?.trim()));
    if (hasR2Settings) {
        throw new ObjectStorageConfigError(
            "R2 storage settings are set but MOSAIC_STORAGE_ADAPTER is not. Set MOSAIC_STORAGE_ADAPTER=r2 in every API and worker environment.",
        );
    }
    if (env.NODE_ENV === "production") return "supabase";

    // Dev/test default remains local when no adapter is set. Fail loudly when
    // Supabase credentials are present but the adapter was left implicit —
    // that usually means a worker is missing NODE_ENV=production (or an
    // explicit MOSAIC_STORAGE_ADAPTER=supabase) while web has it, so web
    // writes to Supabase and the worker reads empty local disk (ENOENT on
    // every audio/image load). Set MOSAIC_STORAGE_ADAPTER=local intentionally
    // if you really want local disk despite Supabase env vars.
    //
    // Railway workers must set NODE_ENV=production or
    // MOSAIC_STORAGE_ADAPTER=supabase so they share the web object's store.
    const hasSupabaseCredentials =
        Boolean(env.SUPABASE_URL?.trim()) &&
        Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim()) &&
        Boolean(env.SUPABASE_STORAGE_BUCKET?.trim());
    if (hasSupabaseCredentials) {
        throw new ObjectStorageConfigError(
            "Supabase storage credentials are set but MOSAIC_STORAGE_ADAPTER is not. " +
                "Set MOSAIC_STORAGE_ADAPTER=supabase (shared/deployed environments " +
                "including workers) or MOSAIC_STORAGE_ADAPTER=local for intentional " +
                "local-only use. Railway workers need NODE_ENV=production or " +
                "MOSAIC_STORAGE_ADAPTER=supabase so they read the same store as web.",
        );
    }
    return "local";
}

function normalizePrefix(prefix: string | undefined): string | undefined {
    const trimmed = prefix?.trim().replace(/^\/+|\/+$/g, "");
    return trimmed || undefined;
}

function supabaseObjectUrl(
    config: IObjectStorageConfig,
    storageKey: string,
): string {
    const bucket = encodeURIComponent(config.supabaseStorageBucket!);
    const objectPathValue = encodeObjectPath(
        config.supabaseStoragePrefix
            ? `${config.supabaseStoragePrefix}/${storageKey}`
            : storageKey,
    );
    return `${config.supabaseUrl}/storage/v1/object/${bucket}/${objectPathValue}`;
}

function supabaseBucketUrl(config: IObjectStorageConfig): string {
    const bucket = encodeURIComponent(config.supabaseStorageBucket!);
    return `${config.supabaseUrl}/storage/v1/object/${bucket}`;
}

function encodeObjectPath(value: string): string {
    return value.split("/").map(encodeURIComponent).join("/");
}

function supabaseHeaders(config: IObjectStorageConfig): HeadersInit {
    const token = config.supabaseServiceRoleKey!;
    return {
        apikey: token,
        Authorization: `Bearer ${token}`,
    };
}

async function uploadToSupabase(
    config: IObjectStorageConfig,
    storageKey: string,
    bytes: Buffer,
    mimeType: string,
    upsert = false,
): Promise<void> {
    const response = await fetchWithTimeout(
        supabaseObjectUrl(config, storageKey),
        {
            method: "POST",
            headers: {
                ...supabaseHeaders(config),
                "Content-Type": mimeType,
                "Cache-Control": "3600",
                "x-upsert": upsert ? "true" : "false",
            },
            body: bufferBody(bytes),
        },
    );
    await assertSupabaseOk(response, "upload object");
}

async function downloadFromSupabase(
    config: IObjectStorageConfig,
    storageKey: string,
): Promise<Buffer> {
    const response = await fetchWithTimeout(
        supabaseObjectUrl(config, storageKey),
        {
            method: "GET",
            headers: supabaseHeaders(config),
        },
    );
    await assertSupabaseOk(response, "download object");
    return Buffer.from(await response.arrayBuffer());
}

async function deleteFromSupabase(
    config: IObjectStorageConfig,
    storageKey: string,
): Promise<void> {
    const objectPathValue = config.supabaseStoragePrefix
        ? `${config.supabaseStoragePrefix}/${storageKey}`
        : storageKey;
    const response = await fetchWithTimeout(supabaseBucketUrl(config), {
        method: "DELETE",
        headers: {
            ...supabaseHeaders(config),
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefixes: [objectPathValue] }),
    });
    await assertSupabaseOk(response, "delete object");
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

async function assertSupabaseOk(
    response: Response,
    action: string,
): Promise<void> {
    if (response.ok) return;
    const body = await response.text().catch(() => "");
    throw new ObjectStorageError(
        `Failed to ${action} in Supabase Storage (${response.status})`,
        response.status,
        body || undefined,
    );
}

// Mirrors the canonical patterns in apps/api/src/mediaPaths.ts: legacy bare
// UUID keys plus dataset-scoped keys minted by the signed-upload endpoint
// (`datasets/<datasetId>/<uuid><ext>`). Bounded + safe: no leading slash, no
// `..`, only `[A-Za-z0-9_-]` per segment with an optional file extension.
const LEGACY_STORAGE_KEY = /^[a-f0-9-]{36}$/i;
const DATASET_SCOPED_STORAGE_KEY =
    /^datasets\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}(\.[A-Za-z0-9]{1,16})?$/;

export function isStorageKey(storageKey: string): boolean {
    return (
        LEGACY_STORAGE_KEY.test(storageKey) ||
        DATASET_SCOPED_STORAGE_KEY.test(storageKey)
    );
}

function assertStorageKey(storageKey: string): void {
    if (!isStorageKey(storageKey)) {
        throw new ObjectStorageError("Invalid storage key");
    }
}

function bufferBody(bytes: Buffer): ArrayBuffer {
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    return body.buffer;
}
