import { createHash } from "node:crypto";
import { OPENROUTER_AUDIO_ADAPTER_VERSION } from "./openrouterAudio.js";

/** Shared by transcript writers and readers; the config string is canonical JSON. */
export function audioTranscriptConfigHash(
    identity: { providerId: string; canonicalModelId: string },
    canonicalConfig: string,
): string {
    const hash = createHash("sha256").update(canonicalConfig);
    if (
        identity.providerId === "openrouter" &&
        identity.canonicalModelId === "google/gemini-3.8-flash"
    )
        hash.update(OPENROUTER_AUDIO_ADAPTER_VERSION);
    return hash.digest("hex");
}
