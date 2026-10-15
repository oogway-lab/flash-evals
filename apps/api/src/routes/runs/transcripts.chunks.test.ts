import {
    canonicalJsonString,
    sttModelIdentityForId,
    TRANSCRIPT_CHUNK_KEY_MARKER,
    type IRunDetailItem,
} from "@mosaic/api-contract";
import { createHash } from "node:crypto";
import {
    audioTranscriptConfigHash,
    OPENROUTER_AUDIO_ADAPTER_VERSION,
} from "@mosaic/llm-core";
import { describe, expect, it, vi } from "vitest";
import type { IDb } from "../../db.js";
import { audioTranscriptPayload } from "./transcripts.js";

const audioItem = {
    id: "00000000-0000-0000-0000-000000000001",
    type: "audio",
    mimeType: "audio/wav",
} as unknown as IRunDetailItem;

describe("audioTranscriptPayload", () => {
    it.each([1, 2])(
        "reads current Gemini transcripts with %i selected configs and excludes legacy native-script rows",
        async (configCount) => {
            const config = {
                modelId: "openrouter:google/gemini-3.8-flash",
                config: { prompt: "Romanize" },
            };
            const identity = sttModelIdentityForId(config.modelId);
            const canonical = canonicalJsonString(config.config);
            // This is the hash written by the worker, including the adapter contract.
            const versionedHash = createHash("sha256")
                .update(canonical)
                .update(OPENROUTER_AUDIO_ADAPTER_VERSION)
                .digest("hex");
            const row = {
                id: "current",
                dataset_item_id: audioItem.id,
                storage_key: "audio/sample.wav",
                provider_id: identity.providerId,
                route_id: identity.routeId,
                stt_model_id: config.modelId,
                canonical_model_id: identity.canonicalModelId,
                language: "",
                config_json: config.config,
                config_hash: versionedHash,
                transcript: "Namaste",
                segments_json: [],
                speakers_json: [],
                warnings: [],
                status: "completed",
                created_at: "2026-10-15T00:00:00Z",
            };
            const query = vi.fn(
                async (sql: string, values?: unknown[]) =>
                    ({
                        rows: sql.includes("from audio_transcripts")
                            ? [
                                  row,
                                  {
                                      ...row,
                                      id: "legacy",
                                      config_hash: createHash("sha256")
                                          .update(canonical)
                                          .digest("hex"),
                                  },
                              ].filter(
                                  (item) =>
                                      !sql.includes("config_hash = $6") ||
                                      item.config_hash === values?.[5],
                              )
                            : [],
                    }) as never,
            );
            const result = await audioTranscriptPayload(
                { query },
                [audioItem],
                Array.from({ length: configCount }, () => config),
            );
            expect(result.map((item) => item.id)).toEqual(["current"]);
            if (configCount === 1)
                expect(query.mock.calls[0]?.[1]?.[5]).toBe(versionedHash);
            expect(audioTranscriptConfigHash(identity, canonical)).toBe(
                versionedHash,
            );
        },
    );
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
