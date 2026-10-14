import {
    TRANSCRIPT_CHUNK_KEY_MARKER,
    type IRunDetailItem,
} from "@mosaic/api-contract";
import { describe, expect, it, vi } from "vitest";
import type { IDb } from "../../db.js";
import { audioTranscriptPayload } from "./transcripts.js";

const audioItem = {
    id: "00000000-0000-0000-0000-000000000001",
    type: "audio",
    mimeType: "audio/wav",
} as unknown as IRunDetailItem;

describe("audioTranscriptPayload", () => {
    it.each([
        [
            "with a selected STT config",
            [{ modelId: "openrouter/google/gemini-3.8-flash" }],
        ],
        ["without a selected STT config", []],
    ])("excludes prepared-chunk rows %s", async (_label, configs) => {
        const query = vi.fn(
            async (_sql: string, _values?: unknown[]) =>
                ({ rows: [] }) as never,
        );
        await audioTranscriptPayload(
            { query } as IDb,
            [audioItem],
            configs as never,
        );
        const transcriptSql = String(
            query.mock.calls.find(([sql]) =>
                String(sql).includes("from audio_transcripts"),
            )?.[0],
        );
        expect(transcriptSql).toContain(
            `strpos(storage_key, '${TRANSCRIPT_CHUNK_KEY_MARKER}') = 0`,
        );
    });
});
