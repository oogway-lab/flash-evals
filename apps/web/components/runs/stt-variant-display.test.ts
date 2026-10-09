import { describe, expect, it } from "vitest";
import {
    sttVariantDisplay,
    sttVariantDisplaysForTranscript,
} from "./stt-variant-display";

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

    it("preserves legacy display behavior without a variant key", () => {
        expect(
            sttVariantDisplay(
                { sttConfig: { modelId: "gpt-4o-transcribe" } },
                "stt:gpt-4o-transcribe",
            ),
        ).toBeUndefined();
    });
});
