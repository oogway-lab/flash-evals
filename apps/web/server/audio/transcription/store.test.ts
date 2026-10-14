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
