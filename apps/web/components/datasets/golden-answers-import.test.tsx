import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import type { IAnswerImportPreview } from "@mosaic/api-contract";
import { SttGoldenAnswersImport } from "./golden-answers-import";
import { pickOption } from "@/components/ui/test-utils";

beforeAll(() => {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

// The label names the dropzone button; files land on its hidden input.
function goldenFileInput(): HTMLInputElement {
    return document.getElementById("golden-answers-file") as HTMLInputElement;
}

function jsonFile(name: string, value: unknown): File {
    const content = JSON.stringify(value);
    return Object.assign(
        new File([content], name, { type: "application/json" }),
        { text: async () => content },
    );
}

const preview: IAnswerImportPreview = {
    fields: [{ name: "transcript", sample: "hello" }],
    proposedMapping: { transcript: "expectedTranscript" },
    rows: [
        {
            row: 1,
            fileName: "test_audio_1.json",
            key: "test_audio_1.json",
            itemId: "item-1",
            itemSourceName: "test_audio_1.wav",
            interpretation: "single_record",
            matchReason: "filename_stem",
            status: "importable",
            messages: [],
            label: { expectedTranscript: "hello" },
        },
        {
            row: 1,
            fileName: "unmatched.json",
            key: "unmatched.json",
            interpretation: "single_record",
            requiresItemSelection: true,
            status: "failing",
            messages: ["Choose the audio item for unmatched.json."],
        },
    ],
    importableCount: 1,
    warningCount: 0,
    failingCount: 1,
    itemOptions: [
        { itemId: "item-1", sourceName: "test_audio_1.wav" },
        { itemId: "item-2", sourceName: "other.wav" },
    ],
};

describe("SttGoldenAnswersImport", () => {
    it("shows derived transcript mapping and both transcript previews", async () => {
        const turnsPreview: IAnswerImportPreview = {
            fields: [
                {
                    name: "transcript",
                    sample: [{ text: "Hello.", speaker: "Priyanshu" }],
                    shape: "speaker_turn_transcript",
                },
                {
                    name: "__derivedExpectedTranscript",
                    sample: "Hello.",
                    derivedFrom: "transcript",
                },
                { name: "gold", sample: "Override" },
            ],
            proposedMapping: {
                transcript: "expectedSpeakerTurns",
                __derivedExpectedTranscript: "expectedTranscript",
                gold: "ignore",
            },
            rows: [
                {
                    row: 1,
                    fileName: "test_audio_1.json",
                    itemId: "item-1",
                    itemSourceName: "test_audio_1.wav",
                    status: "importable",
                    messages: [],
                    label: {
                        expectedSpeakerTurns: [
                            { text: "Hello.", speaker: "Priyanshu" },
                        ],
                        expectedTranscript: "Hello.",
                    },
                },
            ],
            importableCount: 1,
            warningCount: 0,
            failingCount: 0,
        };
        const previewAction = vi.fn(async (_data: FormData) => ({
            ok: true as const,
            preview: turnsPreview,
        }));
        render(
            <SttGoldenAnswersImport
                datasetId="dataset-1"
                previewAction={previewAction}
                commitAction={vi.fn(async () => ({
                    ok: true as const,
                    result: { importedCount: 1, failures: [] },
                }))}
            />,
        );
        fireEvent.change(goldenFileInput(), {
            target: {
                files: [
                    jsonFile("test_audio_1.json", {
                        transcript: [{ text: "Hello.", speaker: "Priyanshu" }],
                    }),
                ],
            },
        });
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Analyze fields" }),
            ).toBeEnabled(),
        );
        fireEvent.click(screen.getByRole("button", { name: "Analyze fields" }));

        expect(
            await screen.findByText("derived from transcript turns"),
        ).toBeInTheDocument();
        expect(screen.getByText("1 turns")).toBeInTheDocument();
        expect(screen.getAllByText("Hello.").length).toBeGreaterThan(0);

        fireEvent.click(
            screen.getByRole("combobox", {
                name: "Map __derivedExpectedTranscript",
            }),
        );
        pickOption(await screen.findByRole("option", { name: "Ignore" }));
        await waitFor(() => expect(previewAction).toHaveBeenCalledTimes(2));
        expect(
            JSON.parse(
                String(
                    (previewAction.mock.calls[1]?.[0] as FormData).get(
                        "mapping",
                    ),
                ),
            ),
        ).toMatchObject({
            transcript: "expectedSpeakerTurns",
            __derivedExpectedTranscript: "ignore",
        });

        // Selects are locked while the previous change re-analyses.
        await waitFor(() =>
            expect(
                screen.getByRole("combobox", { name: "Map gold" }),
            ).toBeEnabled(),
        );
        fireEvent.click(screen.getByRole("combobox", { name: "Map gold" }));
        pickOption(
            await screen.findByRole("option", { name: "Gold transcript" }),
        );
        await waitFor(() => expect(previewAction).toHaveBeenCalledTimes(3));
        expect(
            JSON.parse(
                String(
                    (previewAction.mock.calls[2]?.[0] as FormData).get(
                        "mapping",
                    ),
                ),
            ),
        ).toMatchObject({
            gold: "expectedTranscript",
            __derivedExpectedTranscript: "ignore",
        });
    });

    it("dims and locks the preview while a mapping change re-analyses", async () => {
        const preview = {
            fields: [{ name: "gold", sample: "Hello." }],
            proposedMapping: { gold: "ignore" },
            rows: [],
            importableCount: 1,
            warningCount: 0,
            failingCount: 0,
        };
        let finish!: (value: unknown) => void;
        const previewAction = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, preview })
            .mockImplementationOnce(
                () => new Promise((resolve) => (finish = resolve)),
            );
        render(
            <SttGoldenAnswersImport
                datasetId="dataset-1"
                previewAction={previewAction}
                commitAction={vi.fn()}
            />,
        );
        fireEvent.change(goldenFileInput(), {
            target: { files: [jsonFile("a.json", { gold: "Hello." })] },
        });
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Analyze fields" }),
            ).toBeEnabled(),
        );
        fireEvent.click(screen.getByRole("button", { name: "Analyze fields" }));
        const mapGold = await screen.findByRole("combobox", {
            name: "Map gold",
        });

        fireEvent.click(mapGold);
        pickOption(
            await screen.findByRole("option", { name: "Gold transcript" }),
        );

        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Re-analyzing…" }),
            ).toBeDisabled(),
        );
        const busy = document.querySelectorAll(
            '[data-slot="stale-region"][aria-busy="true"]',
        );
        expect(busy.length).toBe(2);
        busy.forEach((el) => expect(el).toHaveClass("opacity-60"));
        expect(
            screen.getByRole("combobox", { name: "Map gold" }),
        ).toBeDisabled();

        await act(async () => finish({ ok: true, preview }));
        expect(
            document.querySelector(
                '[data-slot="stale-region"][aria-busy="true"]',
            ),
        ).toBeNull();
        expect(
            screen.getByRole("combobox", { name: "Map gold" }),
        ).toBeEnabled();
    });

    it("submits every selected JSON file and shows per-file pairing status", async () => {
        const previewAction = vi.fn(async (_data: FormData) => ({
            ok: true as const,
            preview,
        }));
        render(
            <SttGoldenAnswersImport
                datasetId="dataset-1"
                previewAction={previewAction}
                commitAction={vi.fn(async (_data: FormData) => ({
                    ok: true as const,
                    result: { importedCount: 0, failures: [] },
                }))}
            />,
        );

        fireEvent.change(goldenFileInput(), {
            target: {
                files: [
                    jsonFile("test_audio_1.json", { transcript: "hello" }),
                    jsonFile("unmatched.json", { transcript: "other" }),
                ],
            },
        });
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Analyze fields" }),
            ).toBeEnabled(),
        );
        fireEvent.click(screen.getByRole("button", { name: "Analyze fields" }));

        await screen.findByText("Matched by filename stem");
        expect(
            screen.getByRole("combobox", {
                name: "Choose audio item for unmatched.json",
            }),
        ).toBeInTheDocument();
        const submitted = JSON.parse(
            String(
                (previewAction.mock.calls[0]?.[0] as FormData).get(
                    "answerFiles",
                ),
            ),
        ) as Array<{ fileName: string }>;
        expect(submitted.map((file) => file.fileName)).toEqual([
            "test_audio_1.json",
            "unmatched.json",
        ]);
    });

    it("removes commit eligibility when the latest preview fails", async () => {
        const previewAction = vi
            .fn<
                (
                    data: FormData,
                ) => Promise<
                    | { ok: true; preview: IAnswerImportPreview }
                    | { ok: false; error: string }
                >
            >()
            .mockResolvedValueOnce({ ok: true, preview })
            .mockResolvedValueOnce({ ok: false, error: "Preview failed" });
        render(
            <SttGoldenAnswersImport
                datasetId="dataset-1"
                previewAction={previewAction}
                commitAction={vi.fn(async () => ({
                    ok: true as const,
                    result: { importedCount: 0, failures: [] },
                }))}
            />,
        );
        fireEvent.change(goldenFileInput(), {
            target: {
                files: [jsonFile("test_audio_1.json", { transcript: "hello" })],
            },
        });
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Analyze fields" }),
            ).toBeEnabled(),
        );
        fireEvent.click(screen.getByRole("button", { name: "Analyze fields" }));
        await screen.findByRole("button", { name: "Commit import" });

        fireEvent.click(screen.getByRole("button", { name: "Analyze fields" }));

        await screen.findByText("Preview failed");
        expect(
            screen.queryByRole("button", { name: "Commit import" }),
        ).not.toBeInTheDocument();
    });

    it("shows the two explicit readings for an ambiguous file", async () => {
        const ambiguousPreview: IAnswerImportPreview = {
            ...preview,
            rows: [
                {
                    row: 1,
                    fileName: "unclear.json",
                    key: "unclear.json",
                    interpretation: "single_record",
                    interpretationAmbiguous: true,
                    requiresItemSelection: true,
                    status: "failing",
                    messages: ["Choose an interpretation."],
                },
            ],
            importableCount: 0,
            failingCount: 1,
        };
        render(
            <SttGoldenAnswersImport
                datasetId="dataset-1"
                previewAction={vi.fn(async () => ({
                    ok: true as const,
                    preview: ambiguousPreview,
                }))}
                commitAction={vi.fn(async () => ({
                    ok: true as const,
                    result: { importedCount: 0, failures: [] },
                }))}
            />,
        );
        fireEvent.change(goldenFileInput(), {
            target: {
                files: [jsonFile("unclear.json", { first: {}, version: 1 })],
            },
        });
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Analyze fields" }),
            ).toBeEnabled(),
        );
        fireEvent.click(screen.getByRole("button", { name: "Analyze fields" }));

        expect(
            await screen.findByRole("combobox", {
                name: "Interpret unclear.json",
            }),
        ).toBeInTheDocument();
    });
});
