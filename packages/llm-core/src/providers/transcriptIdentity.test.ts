import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { audioTranscriptConfigHash } from "./transcriptIdentity.js";

const whisper = { providerId: "openai", canonicalModelId: "whisper-1" };
const config = '{"prompt":"names"}';

describe("audioTranscriptConfigHash", () => {
    it("keeps the existing hash when volume levelling is absent or off", () => {
        const existing = createHash("sha256").update(config).digest("hex");
        expect(audioTranscriptConfigHash(whisper, config)).toBe(existing);
        expect(audioTranscriptConfigHash(whisper, config, {})).toBe(existing);
        expect(
            audioTranscriptConfigHash(whisper, config, { levelVolume: false }),
        ).toBe(existing);
    });

    it("separates levelled transcripts from unlevelled ones", () => {
        const plain = audioTranscriptConfigHash(whisper, config);
        const levelled = audioTranscriptConfigHash(whisper, config, {
            levelVolume: true,
        });
        expect(levelled).not.toBe(plain);
        expect(levelled).toMatch(/^[0-9a-f]{64}$/);
        expect(
            audioTranscriptConfigHash(whisper, config, { levelVolume: true }),
        ).toBe(levelled);
    });
});
