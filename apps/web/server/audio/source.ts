import {
    deleteObject,
    loadObjectBytes,
    objectFilePath,
    objectPath,
    putObject,
    storeObject,
} from "../storage/objects";

export const SUPPORTED_AUDIO_MIME_TYPES = [
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/ogg",
    "audio/flac",
] as const;

export type SupportedAudioMimeType = (typeof SUPPORTED_AUDIO_MIME_TYPES)[number];

export interface IStoredAudio {
    storageKey: string;
    mimeType: SupportedAudioMimeType;
}

export async function storeAudio(
    bytes: Buffer,
    mimeType: string,
): Promise<IStoredAudio> {
    const normalizedMimeType = normalizeAudioMimeType(mimeType);
    const storageKey = await storeObject(bytes, normalizedMimeType);
    return { storageKey, mimeType: normalizedMimeType };
}

export async function putAudio(
    storageKey: string,
    bytes: Buffer,
    mimeType: string,
    options: { upsert?: boolean } = {},
): Promise<void> {
    await putObject(storageKey, bytes, normalizeAudioMimeType(mimeType), options);
}

export async function deleteAudio(storageKey: string): Promise<void> {
    await deleteObject(storageKey);
}

export async function loadAudioBytes(storageKey: string): Promise<Buffer> {
    return loadObjectBytes(storageKey);
}

export function audioObjectPath(storageKey: string): string {
    return objectPath(storageKey);
}

export function audioFilePath(storageKey: string): string {
    return objectFilePath(storageKey);
}

export function isSupportedAudioMimeType(
    mimeType: string,
): mimeType is SupportedAudioMimeType {
    return SUPPORTED_AUDIO_MIME_TYPES.includes(
        mimeType.trim().toLowerCase() as SupportedAudioMimeType,
    );
}

export function normalizeAudioMimeType(mimeType: string): SupportedAudioMimeType {
    const normalized = mimeType.trim().toLowerCase();
    if (isSupportedAudioMimeType(normalized)) return normalized;
    throw new Error(`Unsupported audio type: ${mimeType}`);
}
