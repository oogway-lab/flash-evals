import type {
    ITranscriptSegment,
    ITranscriptSpeaker,
} from "../../../db/jsonTypes";
import { isRecord } from "../../../lib/objects";

export function audioUploadFilename(mimeType: string): string {
    switch (mimeType) {
        case "audio/mpeg":
        case "audio/mp3":
            return "audio.mp3";
        case "audio/mp4":
            return "audio.mp4";
        case "audio/wav":
        case "audio/x-wav":
            return "audio.wav";
        case "audio/webm":
            return "audio.webm";
        case "audio/ogg":
            return "audio.ogg";
        case "audio/flac":
            return "audio.flac";
        default:
            return "audio";
    }
}

export function bufferToUint8Array(buffer: Buffer): Uint8Array<ArrayBuffer> {
    const body = new Uint8Array(buffer.byteLength);
    body.set(buffer);
    return body;
}

export function audioUploadForm(bytes: Buffer, mimeType: string): FormData {
    const form = new FormData();
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    form.append(
        "file",
        new Blob([body], { type: mimeType }),
        audioUploadFilename(mimeType),
    );
    return form;
}

export function stringConfig(
    config: Record<string, unknown> | undefined,
    key: string,
): string | undefined {
    const value = config?.[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function booleanConfig(
    config: Record<string, unknown> | undefined,
    key: string,
    defaultValue: boolean,
): boolean {
    const value = config?.[key];
    return typeof value === "boolean" ? value : defaultValue;
}

export function numberConfig(
    config: Record<string, unknown> | undefined,
    key: string,
): number | undefined {
    const value = config?.[key];
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

export function stringProperty(
    value: unknown,
    key: string,
): string | undefined {
    if (!isRecord(value)) return undefined;
    const property = value[key];
    return typeof property === "string" && property.length > 0
        ? property
        : undefined;
}

export function firstStringProperty(
    value: Record<string, unknown>,
    keys: string[],
): string | undefined {
    for (const key of keys) {
        const property = stringProperty(value, key);
        if (property) return property;
    }
    return undefined;
}

export function numberProperty(
    value: unknown,
    key: string,
): number | undefined {
    if (!isRecord(value)) return undefined;
    const property = value[key];
    return typeof property === "number" && Number.isFinite(property)
        ? property
        : undefined;
}

export function firstNumberProperty(
    value: Record<string, unknown>,
    keys: string[],
): number | undefined {
    for (const key of keys) {
        const property = numberProperty(value, key);
        if (property !== undefined) return property;
    }
    return undefined;
}

export function speakersFromSegments(
    segments: ITranscriptSegment[],
): ITranscriptSpeaker[] {
    const speakers = new Set(
        segments
            .map((segment) => segment.speaker)
            .filter((speaker): speaker is string => Boolean(speaker)),
    );
    return [...speakers].map((speaker) => ({ id: speaker, label: speaker }));
}

export function transcriptSegments(value: unknown): ITranscriptSegment[] {
    if (!Array.isArray(value)) return [];
    return value.filter(isTranscriptSegment);
}

export function isTranscriptSegment(
    value: unknown,
): value is ITranscriptSegment {
    return (
        isRecord(value) &&
        typeof value.text === "string" &&
        (value.startMs === undefined || typeof value.startMs === "number") &&
        (value.endMs === undefined || typeof value.endMs === "number") &&
        (value.speaker === undefined || typeof value.speaker === "string") &&
        (value.language === undefined || typeof value.language === "string")
    );
}

export async function fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = 60_000,
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export { isRecord };
