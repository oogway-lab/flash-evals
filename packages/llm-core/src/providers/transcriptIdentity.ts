import { createHash } from "node:crypto";
import { OPENROUTER_AUDIO_ADAPTER_VERSION } from "./openrouterAudio.js";

/**
 * FFmpeg filter that levels a recording to a standard loudness (EBU R128
 * target of -23 LUFS, -2 dBTP true peak, 11 LU range) before transcription.
 */
export const VOLUME_LEVELLING_FILTER = "loudnorm=I=-23:TP=-2:LRA=11";

/**
 * Part of the transcript identity hash: bump when the levelling filter or the
 * levelled samples (rate, channels, bit depth) change, so transcripts made from
 * different audio are not reused. The name records the original WAV output;
 * a lossless container change (WAV to FLAC) keeps the same samples and is
 * versioned in the web app's prepared-audio version instead.
 */
export const VOLUME_LEVELLING_VERSION = "loudnorm-i23-tp2-lra11-wav16k-mono.v1";

export interface IAudioTranscriptHashOptions {
    /** Audio was levelled before transcription; absent or false hashes as before. */
    levelVolume?: boolean;
}

/** Shared by transcript writers and readers; the config string is canonical JSON. */
export function audioTranscriptConfigHash(
    identity: { providerId: string; canonicalModelId: string },
    canonicalConfig: string,
    options: IAudioTranscriptHashOptions = {},
): string {
    const hash = createHash("sha256").update(canonicalConfig);
    if (
        identity.providerId === "openrouter" &&
        identity.canonicalModelId === "google/gemini-3.8-flash"
    )
        hash.update(OPENROUTER_AUDIO_ADAPTER_VERSION);
    if (options.levelVolume === true)
        hash.update(`\nlevel-volume:${VOLUME_LEVELLING_VERSION}`);
    return hash.digest("hex");
}
