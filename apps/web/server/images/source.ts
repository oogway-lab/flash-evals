import type { EvalImage } from "@mosaic/llm-core";
import {
    deleteObject,
    getObjectStorageConfig,
    loadObjectBytes,
    objectFilePath,
    objectPath,
    ObjectStorageConfigError,
    ObjectStorageError,
    putObject,
    storeObject,
    type IObjectStorageConfig,
    type ObjectStorageAdapter,
} from "../storage/objects";

export type ImageStorageAdapter = ObjectStorageAdapter;
export type IImageStorageConfig = IObjectStorageConfig;
export const ImageStorageConfigError = ObjectStorageConfigError;
export const ImageStorageError = ObjectStorageError;

export async function storeImage(
    bytes: Buffer,
    mimeType: string,
): Promise<string> {
    return storeObject(bytes, mimeType);
}

export async function putImage(
    storageKey: string,
    bytes: Buffer,
    mimeType: string,
    options: { upsert?: boolean } = {},
): Promise<void> {
    await putObject(storageKey, bytes, mimeType, options);
}

export async function deleteImage(storageKey: string): Promise<void> {
    await deleteObject(storageKey);
}

export async function loadImage(
    storageKey: string,
    mimeType: string,
): Promise<EvalImage> {
    const bytes = await loadImageBytes(storageKey);
    return { mimeType, base64Data: bytes.toString("base64") };
}

export async function loadImageBytes(storageKey: string): Promise<Buffer> {
    return loadObjectBytes(storageKey);
}

export function getImageStorageConfig(): IImageStorageConfig {
    return getObjectStorageConfig();
}

export function imageObjectPath(storageKey: string): string {
    return objectPath(storageKey);
}

export function imageFilePath(storageKey: string): string {
    return objectFilePath(storageKey);
}
