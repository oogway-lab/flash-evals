"use client";

import {
    MAX_IMPORT_FILE_COUNT,
    MAX_AUDIO_IMPORT_BYTES,
} from "@flash-evals/api-contract";
import {
    AUDIO_ACCEPT,
    AUDIO_MAX_BYTES,
} from "@/components/datasets/audio-dropzone";
import { MediaFileDropzone } from "./media-file-dropzone";

export function BulkAudioDropzone({ name }: { name: string }) {
    return (
        <MediaFileDropzone
            accept={AUDIO_ACCEPT}
            maxBytes={AUDIO_MAX_BYTES}
            maxFiles={MAX_IMPORT_FILE_COUNT}
            maxTotalBytes={MAX_AUDIO_IMPORT_BYTES}
            multiple
            name={name}
            title="Drop audio files or click to browse"
            hint="MP3, MP4, AAC, WAV, WebM, Ogg, FLAC · max 50MB each, 250MB and 100 files per upload"
        />
    );
}
