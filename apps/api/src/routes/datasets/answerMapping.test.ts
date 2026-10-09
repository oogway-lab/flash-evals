import { describe, expect, it } from "vitest";
import { previewAnswerFiles, previewAnswerImport } from "./answerMapping.js";

const items = [
    {
        itemId: "item-1",
        inputText: null,
        sourceName: "call_014.mp3",
    },
];

describe("previewAnswerImport", () => {
    it("adopts diarized transcript arrays and derives the gold transcript", () => {
        const preview = previewAnswerFiles(
            [
                {
                    fileName: "call_014.json",
                    content: JSON.stringify({
                        transcript: [
                            { text: "Hello.", speaker: "Priyanshu" },
                            { text: "How are you?", speaker: "Asha" },
                        ],
                    }),
                },
            ],
            items,
        );

        expect(preview).toMatchObject({
            importableCount: 1,
            failingCount: 0,
            proposedMapping: {
                transcript: "expectedSpeakerTurns",
                __derivedExpectedTranscript: "expectedTranscript",
            },
            fields: [
                {
                    name: "transcript",
                    shape: "speaker_turn_transcript",
                },
                {
                    name: "__derivedExpectedTranscript",
                    derivedFrom: "transcript",
                },
            ],
        });
        expect(preview.rows[0]).toMatchObject({
            status: "importable",
            label: {
                expectedSpeakerTurns: [
                    { text: "Hello.", speaker: "Priyanshu" },
                    { text: "How are you?", speaker: "Asha" },
                ],
                expectedTranscript: "Hello. How are you?",
            },
        });
    });

    it("normalizes speaker-turn aliases and explicit transcript mappings", () => {
        const content = JSON.stringify([
            {
                file: "call_014.mp3",
                transcript: [
                    {
                        content: "Hello",
                        speaker_label: "A",
                        start: 0.25,
                        end: 1.5,
                    },
                    {
                        text: "there",
                        speaker_id: "B",
                        startMs: 1_500,
                        endMs: 2_000,
                    },
                ],
            },
        ]);
        const turns = previewAnswerImport(content, items);
        expect(turns.rows[0]?.label).toMatchObject({
            expectedSpeakerTurns: [
                { speaker: "A", text: "Hello", startMs: 250, endMs: 1_500 },
                {
                    speaker: "B",
                    text: "there",
                    startMs: 1_500,
                    endMs: 2_000,
                },
            ],
        });

        const transcript = previewAnswerImport(content, items, {
            transcript: "expectedTranscript",
        });
        expect(transcript.rows[0]).toMatchObject({
            status: "importable",
            label: { expectedTranscript: "Hello there" },
        });
    });

    it("omits ambiguous generic times and accepts turns without speakers", () => {
        const preview = previewAnswerImport(
            JSON.stringify([
                {
                    file: "call_014.mp3",
                    transcript: [
                        { text: "Hello", start: 1, end: 2 },
                        { text: "there", start: 2, end: 3 },
                    ],
                },
            ]),
            items,
        );

        expect(preview.rows[0]?.label).toMatchObject({
            expectedSpeakerTurns: [
                { speaker: "Speaker", text: "Hello" },
                { speaker: "Speaker", text: "there" },
            ],
            expectedTranscript: "Hello there",
        });
        expect(preview.rows[0]?.label?.expectedSpeakerTurns).toEqual([
            { speaker: "Speaker", text: "Hello" },
            { speaker: "Speaker", text: "there" },
        ]);
    });

    it("omits generic time conversions that overflow milliseconds", () => {
        const preview = previewAnswerImport(
            JSON.stringify([
                {
                    file: "call_014.mp3",
                    transcript: [
                        { text: "Hello", start: 0.5 },
                        { text: "there", start: Number.MAX_VALUE },
                    ],
                },
            ]),
            items,
        );

        expect(preview.rows[0]?.label?.expectedSpeakerTurns).toEqual([
            { speaker: "Speaker", text: "Hello", startMs: 500 },
            { speaker: "Speaker", text: "there" },
        ]);
    });

    it("keeps derived fields tied to their source and avoids source-name collisions", () => {
        const preview = previewAnswerImport(
            JSON.stringify([
                {
                    file: "call_014.mp3",
                    transcript: [{ text: "Hello", speaker: "A" }],
                    __derivedExpectedTranscript: "literal metadata",
                },
            ]),
            items,
        );
        const derived = preview.fields.find((field) => field.derivedFrom);
        expect(derived?.name).toBe("___derivedExpectedTranscript");
        expect(preview.rows[0]?.label).toMatchObject({
            expectedSpeakerTurns: [{ text: "Hello", speaker: "A" }],
            expectedTranscript: "Hello",
        });

        const derivedOnly = previewAnswerImport(
            JSON.stringify([
                {
                    file: "call_014.mp3",
                    transcript: [{ text: "Hello", speaker: "A" }],
                },
            ]),
            items,
            {
                transcript: "ignore",
                __derivedExpectedTranscript: "expectedTranscript",
            },
        );
        expect(derivedOnly.rows[0]?.label).toMatchObject({
            expectedTranscript: "Hello",
        });
    });

    it("rejects mixed transcript shapes and ignores extra automatic turn sources", () => {
        const mixed = previewAnswerImport(
            JSON.stringify([
                { file: "call_014.mp3", transcript: "hello" },
                {
                    file: "missing.mp3",
                    transcript: [{ text: "there", speaker: "A" }],
                },
            ]),
            items,
        );
        expect(mixed.rows[0]?.messages.join(" ")).toContain(
            "mixed string and speaker-turn array values",
        );

        const multiple = previewAnswerImport(
            JSON.stringify([
                {
                    file: "call_014.mp3",
                    transcript: [{ text: "one", speaker: "A" }],
                    segments: [{ text: "two", speaker: "B" }],
                },
            ]),
            items,
        );
        expect(multiple.proposedMapping).toMatchObject({
            transcript: "expectedSpeakerTurns",
            segments: "ignore",
        });
        expect(multiple.importableCount).toBe(1);
    });

    it("names found and accepted shapes for incompatible mappings", () => {
        const preview = previewAnswerImport(
            JSON.stringify([
                { file: "call_014.mp3", transcript: "plain text" },
            ]),
            items,
            { transcript: "expectedSpeakerTurns" },
        );

        expect(preview.rows[0]?.messages.join(" ")).toContain(
            "expectedSpeakerTurns found a string; accepted shape is an array of speaker turns",
        );
    });

    it("imports the field-report single record by filename stem without losing metadata", () => {
        const preview = previewAnswerFiles(
            [
                {
                    fileName: "test_audio_1.json",
                    content: JSON.stringify({
                        user_id: "0Q7-user",
                        memory_id: "memory-1",
                        title: "Daily note",
                        mom: "A concise memory",
                        transcript: "hello from the recording",
                    }),
                },
            ],
            [
                {
                    itemId: "item-1",
                    inputText: null,
                    sourceName: "test_audio_1.wav",
                    hasLabel: false,
                },
                {
                    itemId: "item-2",
                    inputText: null,
                    sourceName: "other.wav",
                    hasLabel: false,
                },
            ],
        );

        expect(preview.proposedMapping.transcript).toBe("expectedTranscript");
        expect(preview.rows).toEqual([
            expect.objectContaining({
                fileName: "test_audio_1.json",
                itemId: "item-1",
                itemSourceName: "test_audio_1.wav",
                interpretation: "single_record",
                matchReason: "filename_stem",
                status: "importable",
                label: {
                    expectedTranscript: "hello from the recording",
                    sourceMetadata: {
                        user_id: "0Q7-user",
                        memory_id: "memory-1",
                        title: "Daily note",
                        mom: "A concise memory",
                    },
                },
            }),
        ]);
    });

    it("asks for an item when a single-record filename is ambiguous and honors the previewed choice", () => {
        const batchItems = [
            {
                itemId: "item-1",
                inputText: null,
                sourceName: "first.wav",
                hasLabel: false,
            },
            {
                itemId: "item-2",
                inputText: null,
                sourceName: "second.wav",
                hasLabel: false,
            },
        ];
        const file = {
            fileName: "unmatched.json",
            content: JSON.stringify({ transcript: "hello" }),
        };

        const ambiguous = previewAnswerFiles([file], batchItems);
        expect(ambiguous.rows[0]).toMatchObject({
            status: "failing",
            requiresItemSelection: true,
            messages: ["Choose the audio item for unmatched.json."],
        });

        const selected = previewAnswerFiles(
            [{ ...file, itemId: "item-2" }],
            batchItems,
        );
        expect(selected.rows[0]).toMatchObject({
            status: "importable",
            itemId: "item-2",
            matchReason: "selected",
        });
    });

    it("keeps unnamed audio items available in the picker", () => {
        const preview = previewAnswerFiles(
            [
                {
                    fileName: "unmatched.json",
                    content: JSON.stringify({ transcript: "hello" }),
                },
            ],
            [
                {
                    itemId: "item-1",
                    inputText: null,
                    sourceName: null,
                    hasLabel: false,
                },
                {
                    itemId: "item-2",
                    inputText: "Fallback title",
                    sourceName: null,
                    hasLabel: false,
                },
            ],
        );

        expect(preview.itemOptions).toEqual([
            { itemId: "item-1", sourceName: "item-1" },
            { itemId: "item-2", sourceName: "Fallback title" },
        ]);
    });

    it("proposes the only unlabeled audio item when the filename does not match", () => {
        const preview = previewAnswerFiles(
            [
                {
                    fileName: "pipeline-output.json",
                    content: JSON.stringify({ transcript: "hello" }),
                },
            ],
            [
                {
                    itemId: "labeled",
                    inputText: null,
                    sourceName: "old.wav",
                    hasLabel: true,
                },
                {
                    itemId: "unlabeled",
                    inputText: null,
                    sourceName: "new.wav",
                    hasLabel: false,
                },
            ],
        );

        expect(preview.rows[0]).toMatchObject({
            itemId: "unlabeled",
            matchReason: "only_unlabeled",
            status: "importable",
        });
    });

    it("requires an explicit preview confirmation before replacing a stem-matched label", () => {
        const file = {
            fileName: "call.json",
            content: JSON.stringify({ transcript: "replacement" }),
        };
        const labeledItem = {
            itemId: "item-1",
            inputText: null,
            sourceName: "call.wav",
            hasLabel: true,
        };

        expect(previewAnswerFiles([file], [labeledItem]).rows[0]).toMatchObject(
            {
                status: "failing",
                requiresOverwriteConfirmation: true,
            },
        );
        const confirmed = previewAnswerFiles(
            [{ ...file, allowOverwrite: true }],
            [labeledItem],
        ).rows[0];
        expect(confirmed).toMatchObject({ status: "importable" });
        expect(confirmed?.requiresOverwriteConfirmation).toBeUndefined();
    });

    it("recognizes a wrapped label as one per-audio record", () => {
        const preview = previewAnswerFiles(
            [
                {
                    fileName: "call.json",
                    content: JSON.stringify({
                        label: { expectedTranscript: "hello" },
                    }),
                },
            ],
            [
                {
                    itemId: "item-1",
                    inputText: null,
                    sourceName: "call.wav",
                    hasLabel: false,
                },
            ],
        );

        expect(preview.rows[0]).toMatchObject({
            interpretation: "single_record",
            status: "importable",
            label: { expectedTranscript: "hello" },
        });
    });

    it("previews multiple per-audio files with independent pairing status", () => {
        const preview = previewAnswerFiles(
            [
                {
                    fileName: "first.json",
                    content: JSON.stringify({ transcript: "one" }),
                },
                {
                    fileName: "missing.json",
                    content: JSON.stringify({ transcript: "two" }),
                },
            ],
            [
                {
                    itemId: "item-1",
                    inputText: null,
                    sourceName: "first.wav",
                    hasLabel: false,
                },
                {
                    itemId: "item-2",
                    inputText: null,
                    sourceName: "second.wav",
                    hasLabel: false,
                },
            ],
        );

        expect(preview.importableCount).toBe(1);
        expect(preview.failingCount).toBe(1);
        expect(preview.rows[0]).toMatchObject({
            fileName: "first.json",
            itemId: "item-1",
        });
        expect(preview.rows[1]).toMatchObject({
            fileName: "missing.json",
            requiresItemSelection: true,
        });
    });

    it("explains genuinely ambiguous objects and accepts either explicit reading", () => {
        const file = {
            fileName: "unclear.json",
            content: JSON.stringify({
                first: { answer: "one" },
                second: { answer: "two" },
                version: 1,
            }),
        };
        const detected = previewAnswerFiles(
            [file],
            [
                {
                    itemId: "item-1",
                    inputText: null,
                    sourceName: "one.wav",
                    hasLabel: false,
                },
                {
                    itemId: "item-2",
                    inputText: null,
                    sourceName: "two.wav",
                    hasLabel: false,
                },
            ],
        );
        expect(detected.rows[0]).toMatchObject({
            interpretationAmbiguous: true,
            status: "failing",
        });
        expect(detected.rows[0]?.messages.join(" ")).toContain(
            "Choose an interpretation",
        );

        const asSingle = previewAnswerFiles(
            [{ ...file, interpretation: "single_record", itemId: "item-1" }],
            [
                {
                    itemId: "item-1",
                    inputText: null,
                    sourceName: "one.wav",
                    hasLabel: false,
                },
            ],
            { version: "costOutlierUsd" },
        );
        expect(asSingle.rows[0]?.interpretationAmbiguous).toBeUndefined();
    });

    it("keeps arrays, keyed answer objects, and JSONL as keyed-row imports", () => {
        const variants = [
            JSON.stringify([{ file: "call_014.mp3", transcript: "array" }]),
            JSON.stringify({
                "call_014.mp3": { transcript: "keyed" },
            }),
        ];

        for (const content of variants) {
            const preview = previewAnswerImport(content, items);
            expect(preview.rows[0]).toMatchObject({
                status: "importable",
                itemId: "item-1",
            });
        }

        const jsonl = previewAnswerImport(
            [
                JSON.stringify({
                    file: "call_014.mp3",
                    transcript: "jsonl",
                }),
                JSON.stringify({ file: "missing.mp3", transcript: "missing" }),
            ].join("\n"),
            items,
        );
        expect(jsonl.rows[0]).toMatchObject({
            status: "importable",
            itemId: "item-1",
        });
    });

    it("proposes aliases and previews mapped rows without writing", () => {
        const preview = previewAnswerImport(
            JSON.stringify([{ file: "call_014.mp3", gt: "hello" }]),
            items,
        );

        expect(preview.proposedMapping.gt).toBe("expectedTranscript");
        expect(preview.rows[0]).toMatchObject({
            status: "importable",
            label: { expectedTranscript: "hello" },
        });
    });

    it("accepts keyed objects and reports a filename near match", () => {
        const preview = previewAnswerImport(
            JSON.stringify({ "call_014.wav": { transcript: "hello" } }),
            items,
        );

        expect(preview.rows[0]?.status).toBe("failing");
        expect(preview.rows[0]?.messages.join(" ")).toContain(
            "closest match: call_014.mp3",
        );
    });

    it("returns row-specific speaker validation and malformed JSON errors", () => {
        const invalidTurns = previewAnswerImport(
            JSON.stringify([
                {
                    file: "call_014.mp3",
                    speakers: [{ speaker: 1, text: "hello" }],
                },
            ]),
            items,
        );
        expect(invalidTurns.rows[0]?.messages.join(" ")).toContain(
            "row 1: expectedSpeakerTurns[0].speaker",
        );

        const malformed = previewAnswerImport("{not-json", items);
        expect(malformed.failingCount).toBe(1);
        expect(malformed.rows[0]?.messages[0]).toContain("Invalid JSON");
    });

    it("validates every mapped STT reference field", () => {
        const preview = previewAnswerImport(
            JSON.stringify([
                {
                    file: "call_014.mp3",
                    latin: 42,
                    lang: false,
                    kind: "draft",
                    latency: "fast",
                    cost: Infinity,
                },
            ]),
            items,
            {
                latin: "expectedTranscriptLatin",
                lang: "expectedLanguage",
                kind: "referenceKind",
                latency: "latencySlaMs",
                cost: "costOutlierUsd",
            },
        );

        const messages = preview.rows[0]?.messages.join(" ");
        expect(messages).toContain("expectedTranscriptLatin must be a string");
        expect(messages).toContain("expectedLanguage must be a string");
        expect(messages).toContain("referenceKind must be one of");
        expect(messages).toContain("latencySlaMs must be a finite number");
        expect(messages).toContain("costOutlierUsd must be a finite number");
    });

    it("unwraps legacy labels and parses multi-line JSONL", () => {
        const preview = previewAnswerImport(
            [
                JSON.stringify({
                    key: "item-1",
                    label: { expectedTranscript: "hello" },
                }),
                JSON.stringify({
                    key: "missing",
                    label: { expectedTranscript: "bye" },
                }),
            ].join("\n"),
            items,
        );

        expect(preview.rows[0]).toMatchObject({
            status: "importable",
            itemId: "item-1",
            label: { expectedTranscript: "hello" },
        });
        expect(preview.rows[1]?.status).toBe("failing");
    });

    it("keeps an existing sourceMetadata object without nesting it", () => {
        const preview = previewAnswerImport(
            JSON.stringify([
                {
                    key: "item-1",
                    label: {
                        expectedTranscript: "hello",
                        sourceMetadata: { pipeline: "production" },
                    },
                },
            ]),
            items,
        );

        expect(preview.rows[0]?.label).toEqual({
            expectedTranscript: "hello",
            sourceMetadata: { pipeline: "production" },
        });
    });

    it("rejects invalid, duplicate, and empty mappings", () => {
        const content = JSON.stringify([
            { file: "call_014.mp3", gt: "hello", transcript: "hello" },
        ]);
        const duplicate = previewAnswerImport(content, items, {
            gt: "expectedTranscript",
            transcript: "expectedTranscript",
        });
        expect(duplicate.rows[0]?.messages.join(" ")).toContain(
            "Multiple source fields",
        );

        const invalid = previewAnswerImport(content, items, {
            gt: "unknown" as "ignore",
        });
        expect(invalid.rows[0]?.messages.join(" ")).toContain(
            'Mapped target "unknown" is not supported',
        );
    });

    it("enforces the import row limit", () => {
        const preview = previewAnswerImport(
            JSON.stringify(
                Array.from({ length: 1_001 }, (_, index) => ({
                    key: `item-${index}`,
                    transcript: "hello",
                })),
            ),
            items,
        );
        expect(preview.failingCount).toBe(1);
        expect(preview.rows[0]?.messages[0]).toContain("limited to 1000 rows");
    });

    it("caps invalid rows across a multi-file batch", () => {
        const invalidJsonl = Array.from(
            { length: 1_000 },
            () => "not-json",
        ).join("\n");
        const preview = previewAnswerFiles(
            [
                { fileName: "one.jsonl", content: invalidJsonl },
                { fileName: "two.jsonl", content: invalidJsonl },
            ],
            items,
        );

        expect(preview.rows).toHaveLength(1);
        expect(preview.rows[0]?.messages[0]).toContain(
            "limited to 1000 rows across all files",
        );
    });
});
