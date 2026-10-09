import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import type { IRunAudioTranscriptSummary } from "@mosaic/api-contract";
import { fmtDate } from "@/lib/format";
import { RunTranscriptPanel } from "./run-transcript-panel";

afterEach(cleanup);

function transcript(
    overrides: Partial<IRunAudioTranscriptSummary> = {},
): IRunAudioTranscriptSummary {
    return {
        id: "transcript-1",
        datasetItemId: "item-1",
        storageKey: "audio/sample.wav",
        providerId: "soniox",
        routeId: "soniox-async-v5",
        sttModelId: "soniox-v5",
        canonicalModelId: "soniox-v5",
        language: "hi",
        configJson: { diarization: true },
        transcript: "namaste duniya",
        rawText: "namaste duniya",
        normalizedText: "namaste duniya",
        detectedLanguage: "hi",
        segments: [
            { speaker: "S1", text: "namaste duniya", startMs: 0, endMs: 1000 },
        ],
        speakers: [{ id: "S1", label: "S1" }],
        providerMetadata: { provider: "soniox" },
        warnings: ["low confidence"],
        status: "completed",
        error: null,
        createdAt: "2026-07-06T08:30:00.000Z",
        variants: [
            {
                id: "variant-1",
                datasetItemId: "item-1",
                storageKey: "audio/sample.wav",
                sourceTranscriptHash:
                    "490ab276fd921e97afe4dd7108e2717919d8bc68ae1ee29910ca614be736e27a",
                variantKind: "latin",
                targetScript: "latin",
                targetLanguage: "hi",
                modelId: "gemini-2.5-flash",
                transcript: "namaste duniya",
                providerMetadata: { provider: "gateway" },
                status: "completed",
                error: null,
                createdAt: "2026-07-06T08:31:00.000Z",
            },
        ],
        ...overrides,
    };
}

describe("RunTranscriptPanel", () => {
    it("renders transcript artifacts and variants", () => {
        const { container } = render(
            <RunTranscriptPanel transcripts={[transcript()]} />,
        );

        expect(within(container).getByText("soniox-v5")).toBeTruthy();
        expect(
            within(container).getByText("soniox / soniox-async-v5"),
        ).toBeTruthy();
        expect(within(container).getAllByText("hi").length).toBeGreaterThan(0);
        expect(
            within(container).getAllByText("namaste duniya").length,
        ).toBeGreaterThan(1);
        expect(within(container).getByText("low confidence")).toBeTruthy();
        expect(within(container).getAllByText("latin").length).toBeGreaterThan(
            1,
        );
        expect(within(container).getByText("gemini-2.5-flash")).toBeTruthy();
        expect(within(container).getByText("STT config")).toBeTruthy();
        expect(container.textContent).toContain("diarization");
        expect(container.textContent).toContain("true");
    });

    it("formats the created time in UTC so server and client render the same text", () => {
        const { container } = render(
            <RunTranscriptPanel transcripts={[transcript()]} />,
        );

        expect(
            within(container).getByText(fmtDate("2026-07-06T08:30:00.000Z")),
        ).toBeTruthy();
    });
});
