"use client";

import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "@mosaic/api-contract";
import { MediaFileDropzone } from "./media-file-dropzone";

// Same allowlist and limit the server enforces.
export const IMAGE_ACCEPT = ALLOWED_IMAGE_TYPES.join(",");
export const IMAGE_MAX_BYTES = MAX_IMAGE_BYTES;

export function ImageDropzone({ name }: { name: string }) {
    return (
        <MediaFileDropzone
            accept={IMAGE_ACCEPT}
            maxBytes={IMAGE_MAX_BYTES}
            name={name}
            title="Drop an image or click to browse"
            hint="PNG, JPEG, GIF, WebP · max 20MB"
        />
    );
}
