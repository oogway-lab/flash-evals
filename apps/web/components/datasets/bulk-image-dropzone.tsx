"use client";

import {
    IMAGE_ACCEPT,
    IMAGE_MAX_BYTES,
} from "@/components/datasets/image-dropzone";
import { MediaFileDropzone } from "./media-file-dropzone";

export function BulkImageDropzone({ name }: { name: string }) {
    return (
        <MediaFileDropzone
            accept={IMAGE_ACCEPT}
            maxBytes={IMAGE_MAX_BYTES}
            multiple
            name={name}
            title="Drop images or click to browse"
            hint="PNG, JPEG, GIF, WebP · max 20MB each"
        />
    );
}
