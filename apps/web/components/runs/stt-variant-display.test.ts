import { describe, expect, it } from "vitest";
import {
    formatPossiblyPartialCost,
    sttVariantDisplay,
    sttVariantDisplaysForTranscript,
    transcriptCostIncomplete,
} from "./stt-variant-display";

describe("partial transcription cost", () => {
    const format = (costUsd: number | undefined) =>
        costUsd === undefined ? "-" : `$${costUsd.toFixed(2)}`;

    it("detects a transcription spend with an unknown part", () => {
        expect(
            transcriptCostIncomplete({
                providerMetadata: {
                    transcriptionSpend: {
                        costUsd: 0.1,
                        costSource: "unavailable",
                    },
                },
            }),
        ).toBe(true);
        expect(
            transcriptCostIncomplete({
                providerMetadata: {
                    transcriptionSpend: {
                        costUsd: 0.1,
                        costSource: "computed",
                    },
                },
            }),
        ).toBe(false);
        expect(transcriptCostIncomplete({})).toBe(false);
    });

    it("formats the known part as a lower bound", () => {
        expect(formatPossiblyPartialCost(0.1, false, format)).toBe("$0.10");
        expect(formatPossiblyPartialCost(0.1, true, format)).toBe(
            "at least $0.10",
        );
        expect(formatPossiblyPartialCost(undefined, true, format)).toBe(
            "Unavailable",
        );
        expect(formatPossiblyPartialCost(0, true, format)).toBe("Unavailable");
    });
});

describe("sttVariantDisplay", () => {
    it("labels a variant and generically surfaces every differing config key", () => {
        const snapshot = {
            sttVariants: {
                on: {
                    variantKey: "on",
                    label: "Diarization on",
                    config: {
                        modelId: "soniox:stt-async-v5",
                        language: "hi",
                        config: { diarization: true, futureSetting: "strict" },
                    },
                },
                off: {
                    variantKey: "off",
                    label: "Diarization off",
                    config: {
                        modelId: "soniox:stt-async-v5",
                        config: { diarization: false, futureSetting: "loose" },
                    },
                },
            },
        };

        expect(
            sttVariantDisplay(snapshot, "stt:soniox:stt-async-v5#on"),
        ).toEqual({
            variantKey: "on",
            label: "Diarization on",
            baseModelId: "soniox:stt-async-v5",
            diffBadges: [
                "diarization: on",
                "future setting: strict",
                "language: hi",
            ],
            settingLabels: [],
        });
    });

    it("expands one cached transcript across identical duplicated variants", () => {
        const config = { modelId: "gpt-4o-mini-transcribe", config: {} };
        const snapshot = {
            sttVariants: {
                first: { variantKey: "first", label: "First", config },
                copy: { variantKey: "copy", label: "Copy", config },
            },
        };

        expect(
            sttVariantDisplaysForTranscript(snapshot, {
                sttModelId: config.modelId,
                language: "",
                configJson: {},
            }).map((display) => display.label),
        ).toEqual(["First", "Copy"]);
    });

    it("shows volume levelling and matches transcripts by it", () => {
        const base = { modelId: "elevenlabs:scribe_v2", config: {} };
        const snapshot = {
            sttVariants: {
                plain: { variantKey: "plain", label: "Plain", config: base },
                loud: {
                    variantKey: "loud",
                    label: "Levelled",
                    config: { ...base, levelVolume: true },
                },
            },
        };

        expect(
            sttVariantDisplay(snapshot, "stt:elevenlabs:scribe_v2#loud"),
        ).toMatchObject({ diffBadges: [], settingLabels: ["Volume levelled"] });
        expect(
            sttVariantDisplay(snapshot, "stt:elevenlabs:scribe_v2#plain"),
        ).toMatchObject({ diffBadges: [], settingLabels: [] });
        const transcript = {
            sttModelId: base.modelId,
            language: "",
            configJson: {},
        };
        expect(
            sttVariantDisplaysForTranscript(snapshot, transcript).map(
                (display) => display.label,
            ),
        ).toEqual(["Plain"]);
        expect(
            sttVariantDisplaysForTranscript(snapshot, {
                ...transcript,
                providerMetadata: { volumeLevelled: true },
            }).map((display) => display.label),
        ).toEqual(["Levelled"]);
    });

    it("preserves legacy display behavior without a variant key", () => {
        expect(
            sttVariantDisplay(
                { sttConfig: { modelId: "gpt-4o-transcribe" } },
                "stt:gpt-4o-transcribe",
            ),
        ).toBeUndefined();
    });
});
