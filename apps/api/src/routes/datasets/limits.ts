export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const MAX_IMPORT_FILE_COUNT = 100;
export const MAX_TEXT_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 1_000;
export const MAX_JSONL_LINE_BYTES = 64 * 1024;
export const MAX_IMAGE_IMPORT_BYTES = 24 * 1024 * 1024;
export const MAX_AUDIO_IMPORT_BYTES = 250 * 1024 * 1024;

export const DATASET_IMPORT_LIMITS = Object.freeze({
    maxFileCount: MAX_IMPORT_FILE_COUNT,
    maxTextBytes: MAX_TEXT_IMPORT_BYTES,
    maxImageFileBytes: MAX_IMAGE_BYTES,
    maxImageBatchBytes: MAX_IMAGE_IMPORT_BYTES,
    maxAudioFileBytes: MAX_AUDIO_BYTES,
    maxAudioBatchBytes: MAX_AUDIO_IMPORT_BYTES,
});
