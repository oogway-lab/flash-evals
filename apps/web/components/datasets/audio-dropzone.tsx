"use client";

import { ALLOWED_AUDIO_TYPES, MAX_AUDIO_BYTES } from "@mosaic/api-contract";
import { MediaFileDropzone } from "./media-file-dropzone";

// Same allowlist and limit the server enforces.
export const AUDIO_ACCEPT = ALLOWED_AUDIO_TYPES.join(",");
export const AUDIO_MAX_BYTES = MAX_AUDIO_BYTES;

export function AudioDropzone({ name }: { name: string }) {
    return (
        <MediaFileDropzone
            accept={AUDIO_ACCEPT}
            maxBytes={AUDIO_MAX_BYTES}
            name={name}
            title="Drop audio or click to browse"
            hint="MP3, MP4, AAC, WAV, WebM, Ogg, FLAC · max 50MB"
        />
    );
}
