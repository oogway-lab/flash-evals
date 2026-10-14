"use client";

import {
    MAX_IMPORT_FILE_COUNT,
    MAX_IMAGE_IMPORT_BYTES,
} from "@mosaic/api-contract";
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
            maxFiles={MAX_IMPORT_FILE_COUNT}
            maxTotalBytes={MAX_IMAGE_IMPORT_BYTES}
            multiple
            name={name}
            title="Drop images or click to browse"
            hint="PNG, JPEG, GIF, WebP · max 20MB each, 24MB and 100 files per upload"
        />
    );
}
