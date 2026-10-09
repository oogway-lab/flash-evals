"use client";

import {
    FileDropzone,
    type IFileDropzoneProps,
} from "@/components/ui/file-dropzone";

/** Dataset media picker; see `FileDropzone` for behaviour. */
export function MediaFileDropzone(props: IFileDropzoneProps) {
    return <FileDropzone {...props} />;
}
