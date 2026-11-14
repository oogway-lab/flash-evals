import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";

vi.mock("../../db/client", () => ({ db: {} }));
import { transcriptIdentity } from "./store";

it("does not reuse native-script Gemini transcripts after the Latin STT change", () => {
    const legacyHash = createHash("sha256").update("{}").digest("hex");
    expect(
        transcriptIdentity("openrouter:google/gemini-3.8-flash", undefined)
            .configHash,
    ).not.toBe(legacyHash);
    expect(transcriptIdentity("openai:whisper-1", undefined).configHash).toBe(
        legacyHash,
    );
});

it("keeps the cache hash without volume levelling and separates it when on", () => {
    const plain = transcriptIdentity("elevenlabs:scribe_v2", {
        diarization: true,
    }).configHash;
    expect(
        transcriptIdentity("elevenlabs:scribe_v2", { diarization: true }, {})
            .configHash,
    ).toBe(plain);
    expect(
        transcriptIdentity(
            "elevenlabs:scribe_v2",
            { diarization: true },
            { levelVolume: false },
        ).configHash,
    ).toBe(plain);
    const levelled = transcriptIdentity(
        "elevenlabs:scribe_v2",
        { diarization: true },
        { levelVolume: true },
    );
    expect(levelled.configHash).not.toBe(plain);
    // The provider config itself is unchanged; only the cache key differs.
    expect(levelled.configJson).toEqual({ diarization: true });
});
