import { describe, expect, it, vi } from "vitest";

vi.mock("./service", () => ({
    addAudioItem: vi.fn(),
    addImageItem: vi.fn(),
    addTextItem: vi.fn(),
    addLabel: vi.fn(),
    DUPLICATE_ITEM_SOURCE_NAME_MESSAGE:
        "An item with this filename already exists in the dataset.",
    DuplicateItemSourceNameError: class DuplicateItemSourceNameError extends Error {},
}));

import {
    MAX_IMPORT_FILE_COUNT,
    MAX_IMPORT_ROWS,
    MAX_JSONL_LINE_BYTES,
    MAX_TEXT_IMPORT_BYTES,
    type IAudioImportFile,
    type IImageImportFile,
    importAudioItems,
    importFreeformAudioAnswerItems,
    importImageItems,
    importFreeformImageAnswerItems,
    importGoldenAnswersForItems,
    importPairedItems,
    prepareGoldenAnswersByKey,
    prepareGoldenAnswersForItems,
    prepareTextImport,
    preparePairedImport,
    validateAudioImportFiles,
    validateImageImportFiles,
} from "./import";
import { addAudioItem, addImageItem, addLabel } from "./service";
import { parseSchema } from "./schemaForm";

const pairedSchema = parseSchema({
    type: "object",
    additionalProperties: true,
    required: ["calories"],
    properties: {
        calories: { type: "number" },
        dish: { type: "string" },
    },
});
if (!pairedSchema.ok) throw new Error(pairedSchema.error);

function fakeImageFile(name: string, size = 100): IImageImportFile {
    return {
        name,
        type: "image/png",
        size,
        arrayBuffer: async () => new ArrayBuffer(size),
    };
}

function fakeAudioFile(name: string, size = 100): IAudioImportFile {
    return {
        name,
        type: "audio/webm",
        size,
        arrayBuffer: async () => new ArrayBuffer(size),
    };
}

const textSchema = parseSchema({
    type: "object",
    additionalProperties: false,
    required: ["answer"],
    properties: {
        answer: { type: "string" },
        confidence: { type: "number" },
    },
});
if (!textSchema.ok) throw new Error(textSchema.error);

const arraySchema = parseSchema({
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
        items: { type: "array", items: { type: "string" } },
    },
});
if (!arraySchema.ok) throw new Error(arraySchema.error);

describe("prepareTextImport", () => {
    it("imports valid JSONL rows and reports invalid rows with reasons", () => {
        const lines = Array.from({ length: 20 }, (_, index) => {
            if (index === 2) return JSON.stringify({ inputText: "q3" });
            if (index === 7) {
                return JSON.stringify({
                    inputText: "q8",
                    answer: "yes",
                    confidence: "high",
                });
            }
            if (index === 12) {
                return JSON.stringify({
                    inputText: "q13",
                    answer: "yes",
                    notes: "extra",
                });
            }
            return JSON.stringify({
                inputText: `q${index + 1}`,
                answer: "yes",
                confidence: 0.9,
            });
        });

        const result = prepareTextImport(
            lines.join("\n"),
            "jsonl",
            textSchema.schema,
        );

        expect(result.rows).toHaveLength(17);
        expect(result.failures).toHaveLength(3);
        expect(result.failures.map((failure) => failure.row)).toEqual([3, 8, 13]);
    });

    it("parses CSV scalar columns into labels", () => {
        const result = prepareTextImport(
            "inputText,answer,confidence\nQuestion,Yes,0.8\n",
            "csv",
            textSchema.schema,
        );

        expect(result.failures).toEqual([]);
        expect(result.rows).toEqual([
            {
                inputText: "Question",
                label: { answer: "Yes", confidence: 0.8 },
            },
        ]);
    });

    it("reports malformed JSONL rows without blocking valid rows", () => {
        const result = prepareTextImport(
            `${JSON.stringify({ inputText: "q1", answer: "Yes" })}\n{broken`,
            "jsonl",
            textSchema.schema,
        );

        expect(result.rows).toHaveLength(1);
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].reason).toBeTruthy();
    });

    it("rejects payloads and row counts over hard limits without partial rows", () => {
        const oversized = prepareTextImport(
            "x".repeat(MAX_TEXT_IMPORT_BYTES + 1),
            "jsonl",
            textSchema.schema,
        );
        const tooManyRows = prepareTextImport(
            Array.from({ length: MAX_IMPORT_ROWS + 1 }, () =>
                JSON.stringify({ answer: "Yes" }),
            ).join("\n"),
            "jsonl",
            textSchema.schema,
        );

        expect(oversized).toMatchObject({ rejected: true, rows: [] });
        expect(tooManyRows).toMatchObject({ rejected: true, rows: [] });
    });

    it("fails an overlong JSONL line before parsing and keeps other rows", () => {
        const result = prepareTextImport(
            [
                JSON.stringify({ answer: "Yes" }),
                `{"answer":"${"x".repeat(MAX_JSONL_LINE_BYTES)}"}`,
            ].join("\n"),
            "jsonl",
            textSchema.schema,
        );

        expect(result.rows).toHaveLength(1);
        expect(result.failures).toEqual([
            expect.objectContaining({ row: 2, reason: expect.stringContaining("line") }),
        ]);
    });

    it("skips whitespace-only cells instead of coercing them (number → 0)", () => {
        const result = prepareTextImport(
            "inputText,answer,confidence\nQ,Yes,   \n",
            "csv",
            textSchema.schema,
        );

        expect(result.failures).toEqual([]);
        expect(result.rows).toEqual([
            { inputText: "Q", label: { answer: "Yes" } },
        ]);
    });

    it("rejects CSV for schemas with array fields", () => {
        expect(
            prepareTextImport("inputText,items\nPlate,oatmeal\n", "csv", arraySchema.schema),
        ).toMatchObject({
            rejected: true,
            rows: [],
            failures: [
                expect.objectContaining({ reason: expect.stringContaining("use JSONL") }),
            ],
        });
    });
});

describe("validateImageImportFiles", () => {
    it("rejects over-limit image batches without partial inserts", () => {
        const files = Array.from({ length: MAX_IMPORT_FILE_COUNT + 1 }, (_, index) => ({
            name: `image-${index}.png`,
            type: "image/png",
            size: 1,
            arrayBuffer: async () => new ArrayBuffer(1),
        }));

        expect(validateImageImportFiles(files)).toMatchObject({
            importedCount: 0,
            rejected: true,
        });
    });

    it("reports per-file image failures while allowing valid files", () => {
        const result = validateImageImportFiles([
            {
                name: "ok.png",
                type: "image/png",
                size: 10,
                arrayBuffer: async () => new ArrayBuffer(10),
            },
            {
                name: "bad.txt",
                type: "text/plain",
                size: 10,
                arrayBuffer: async () => new ArrayBuffer(10),
            },
        ]);

        expect(result).toEqual({
            importedCount: 1,
            failures: [
                {
                    fileName: "bad.txt",
                    reason: "Unsupported image type: text/plain.",
                },
            ],
        });
    });

    it("reports duplicate valid filenames in the same upload", () => {
        const result = validateImageImportFiles([
            fakeImageFile("same.png"),
            fakeImageFile("same.png"),
            fakeImageFile("other.png"),
        ]);

        expect(result).toEqual({
            importedCount: 2,
            failures: [
                {
                    fileName: "same.png",
                    reason: "Duplicate filename in upload.",
                },
            ],
        });
    });

    it("rejects whitespace-only filenames so dedup is not silently skipped", () => {
        const result = validateImageImportFiles([
            fakeImageFile("   "),
            fakeImageFile("ok.png"),
        ]);

        expect(result.importedCount).toBe(1);
        expect(result.failures).toContainEqual({
            fileName: "   ",
            reason: "Image filename is required.",
        });
    });
});

describe("validateAudioImportFiles", () => {
    it("reports per-file audio failures while allowing valid files", () => {
        const result = validateAudioImportFiles([
            fakeAudioFile("ok.webm"),
            {
                name: "bad.txt",
                type: "text/plain",
                size: 10,
                arrayBuffer: async () => new ArrayBuffer(10),
            },
        ]);

        expect(result).toEqual({
            importedCount: 1,
            failures: [
                {
                    fileName: "bad.txt",
                    reason: "Unsupported audio type: text/plain.",
                },
            ],
        });
    });

    it("rejects whitespace-only audio filenames so dedup is not skipped", () => {
        const result = validateAudioImportFiles([
            fakeAudioFile("   "),
            fakeAudioFile("ok.webm"),
        ]);

        expect(result.importedCount).toBe(1);
        expect(result.failures).toContainEqual({
            fileName: "   ",
            reason: "Audio filename is required.",
        });
    });
});

describe("importAudioItems", () => {
    it("imports valid audio files with source names", async () => {
        vi.mocked(addAudioItem).mockClear();

        const summary = await importAudioItems("ds1", [fakeAudioFile("sample.webm")]);

        expect(summary).toEqual({ importedCount: 1, failures: [] });
        expect(addAudioItem).toHaveBeenCalledWith(
            "ds1",
            expect.any(Buffer),
            "audio/webm",
            undefined,
            undefined,
            "sample.webm",
        );
    });
});

describe("importFreeformAudioAnswerItems", () => {
    it("imports audio files with STT reference labels keyed by filename", async () => {
        vi.mocked(addAudioItem).mockClear();
        const label = {
            key: "call.webm",
            referenceKind: "silver",
            expectedTranscript: "नमस्ते दुनिया",
            expectedTranscriptLatin: "namaste duniya",
            expectedSpeakerTurns: [
                { speaker: "A", text: "namaste", startMs: 0, endMs: 500 },
            ],
            domainTerms: ["namaste"],
            expectedNumbers: [5],
        };

        const summary = await importFreeformAudioAnswerItems(
            "ds1",
            [fakeAudioFile("call.webm")],
            JSON.stringify(label),
        );

        expect(summary).toEqual({ importedCount: 1, failures: [] });
        expect(addAudioItem).toHaveBeenCalledWith(
            "ds1",
            expect.any(Buffer),
            "audio/webm",
            undefined,
            expect.objectContaining({
                referenceKind: "silver",
                expectedTranscript: "नमस्ते दुनिया",
                expectedTranscriptLatin: "namaste duniya",
            }),
            "call.webm",
        );
    });

    it("rejects malformed STT speaker labels before storing audio", async () => {
        vi.mocked(addAudioItem).mockClear();

        const summary = await importFreeformAudioAnswerItems(
            "ds1",
            [fakeAudioFile("call.webm")],
            JSON.stringify({
                key: "call.webm",
                referenceKind: "human_gold",
                expectedSpeakerTurns: [{ speaker: "A" }],
            }),
        );

        expect(summary.importedCount).toBe(0);
        expect(summary.failures).toContainEqual({
            fileName: "call.webm",
            reason: "expectedSpeakerTurns must contain speaker/text objects with optional numeric startMs/endMs.",
        });
        expect(addAudioItem).not.toHaveBeenCalled();
    });
});

describe("importImageItems", () => {
    it("imports a valid file sharing a name with a rejected one (no skip-by-name)", async () => {
        const summary = await importImageItems("ds1", [
            {
                name: "dup.png",
                type: "image/png",
                size: 10,
                arrayBuffer: async () => new ArrayBuffer(10),
            },
            {
                name: "dup.png",
                type: "text/plain",
                size: 10,
                arrayBuffer: async () => new ArrayBuffer(10),
            },
        ]);

        expect(summary.importedCount).toBe(1);
        expect(addImageItem).toHaveBeenCalledTimes(1);
        expect(addImageItem).toHaveBeenCalledWith(
            "ds1",
            expect.any(Buffer),
            "image/png",
            undefined,
            undefined,
            "dup.png",
        );
        expect(summary.failures).toEqual([
            { fileName: "dup.png", reason: "Unsupported image type: text/plain." },
        ]);
    });

    it("skips duplicate valid filenames in the same image import", async () => {
        vi.mocked(addImageItem).mockClear();
        const summary = await importImageItems("ds1", [
            fakeImageFile("dup.png"),
            fakeImageFile("dup.png"),
            fakeImageFile("unique.png"),
        ]);

        expect(summary.importedCount).toBe(2);
        expect(addImageItem).toHaveBeenCalledTimes(2);
        expect(summary.failures).toContainEqual({
            fileName: "dup.png",
            reason: "Duplicate filename in upload.",
        });
    });
});

describe("preparePairedImport", () => {
    it("AE3: pairs matching rows and reports rows whose image is missing", () => {
        const fileNames = Array.from({ length: 17 }, (_, i) => `img${i}.png`);
        const header = "filename,calories";
        const goodRows = fileNames.map((name) => `${name},100`);
        const badRows = ["missingA.png,100", "missingB.png,100", "missingC.png,100"];
        const csv = [header, ...goodRows, ...badRows].join("\n");

        const plan = preparePairedImport(fileNames, csv, pairedSchema.schema);

        expect(plan.items).toHaveLength(17);
        expect(plan.failures).toHaveLength(3);
        expect(plan.failures.every((f) => f.reason.includes("No uploaded image"))).toBe(
            true,
        );
    });

    it("R13: reports a row with no image and an image with no row distinctly", () => {
        const csv = "filename,calories\na.png,100\nc.png,100";
        const plan = preparePairedImport(["a.png", "b.png"], csv, pairedSchema.schema);

        expect(plan.items.map((i) => i.fileName)).toEqual(["a.png"]);
        const rowFailure = plan.failures.find((f) => f.row !== undefined);
        const fileFailure = plan.failures.find((f) => f.fileName !== undefined);
        expect(rowFailure?.reason).toContain('No uploaded image named "c.png"');
        expect(fileFailure).toEqual({
            fileName: "b.png",
            reason: "No spreadsheet row references this image.",
        });
    });

    it("reports a duplicate filename in the sheet without double-inserting", () => {
        const csv = "filename,calories\na.png,100\na.png,200";
        const plan = preparePairedImport(["a.png"], csv, pairedSchema.schema);

        expect(plan.items).toHaveLength(1);
        expect(plan.failures).toContainEqual({
            row: 3,
            reason: 'Duplicate filename "a.png".',
        });
    });

    it("fails a row with an invalid factual field; valid rows still import", () => {
        const csv = "filename,calories\na.png,100\nb.png,";
        const plan = preparePairedImport(["a.png", "b.png"], csv, pairedSchema.schema);

        expect(plan.items.map((i) => i.fileName)).toEqual(["a.png"]);
        const failure = plan.failures.find((f) => f.row === 3);
        expect(failure?.reason).toContain("calories");
    });

    it("rejects array-typed schemas with a clear message", () => {
        const plan = preparePairedImport(["a.png"], "filename\na.png", arraySchema.schema);
        expect(plan.rejected).toBe(true);
        expect(plan.failures[0].reason).toContain("array fields");
    });

    it("rejects a spreadsheet with no filename column", () => {
        const plan = preparePairedImport(["a.png"], "calories\n100", pairedSchema.schema);
        expect(plan.rejected).toBe(true);
        expect(plan.failures[0].reason).toContain("filename");
    });

    it("rejects an unknown answer column instead of silently storing it", () => {
        const csv = "filename,calories,calroies\na.png,100,oops";
        const plan = preparePairedImport(["a.png"], csv, pairedSchema.schema);
        expect(plan.rejected).toBe(true);
        expect(plan.failures[0].reason).toContain("calroies");
    });

    it("rejects a reserved-key column (prototype-pollution guard)", () => {
        const csv = "filename,calories,constructor\na.png,100,evil";
        const plan = preparePairedImport(["a.png"], csv, pairedSchema.schema);
        expect(plan.rejected).toBe(true);
        expect(plan.failures[0].reason).toContain("constructor");
    });
});

describe("importPairedItems", () => {
    it("R13: rejects over the file-count cap with zero inserts", async () => {
        vi.mocked(addImageItem).mockClear();
        const files = Array.from({ length: MAX_IMPORT_FILE_COUNT + 1 }, (_, i) =>
            fakeImageFile(`img${i}.png`),
        );
        const summary = await importPairedItems(
            "dataset-1",
            files,
            "filename,calories\nimg0.png,100",
            pairedSchema.schema,
        );
        expect(summary.rejected).toBe(true);
        expect(summary.importedCount).toBe(0);
        expect(addImageItem).not.toHaveBeenCalled();
    });

    it("inserts paired items and attaches the parsed label", async () => {
        vi.mocked(addImageItem).mockClear();
        const summary = await importPairedItems(
            "dataset-1",
            [fakeImageFile("a.png"), fakeImageFile("b.png")],
            "filename,calories,dish\na.png,350,oatmeal\nb.png,200,toast",
            pairedSchema.schema,
        );
        expect(summary.importedCount).toBe(2);
        expect(addImageItem).toHaveBeenCalledWith(
            "dataset-1",
            expect.any(Buffer),
            "image/png",
            undefined,
            { calories: 350, dish: "oatmeal" },
            "a.png",
        );
    });

    it("does not import ambiguous duplicate uploaded filenames", async () => {
        vi.mocked(addImageItem).mockClear();
        const summary = await importPairedItems(
            "dataset-1",
            [fakeImageFile("a.png"), fakeImageFile("a.png")],
            "filename,calories\na.png,350",
            pairedSchema.schema,
        );

        expect(summary.importedCount).toBe(0);
        expect(addImageItem).not.toHaveBeenCalled();
        expect(summary.failures).toContainEqual({
            fileName: "a.png",
            reason: "Duplicate filename in upload.",
        });
    });

    it("reports a duplicate uploaded file once, not also as unmatched", async () => {
        vi.mocked(addImageItem).mockClear();
        const summary = await importPairedItems(
            "dataset-1",
            [fakeImageFile("a.png"), fakeImageFile("a.png"), fakeImageFile("b.png")],
            "filename,calories\nb.png,200",
            pairedSchema.schema,
        );

        expect(summary.importedCount).toBe(1);
        expect(addImageItem).toHaveBeenCalledTimes(1);
        expect(summary.failures).toEqual([
            { fileName: "a.png", reason: "Duplicate filename in upload." },
        ]);
    });
});

describe("prepareGoldenAnswersByKey", () => {
    it("pairs answers to uploaded image filenames", () => {
        const plan = prepareGoldenAnswersByKey(
            ["a.png", "b.png"],
            [
                JSON.stringify({ filename: "a.png", label: { answer: "salad" } }),
                JSON.stringify({ filename: "b.png", answer: "soup" }),
            ].join("\n"),
        );

        expect(plan.failures).toEqual([]);
        expect(plan.pairs).toEqual([
            { key: "a.png", label: { answer: "salad" } },
            { key: "b.png", label: { answer: "soup" } },
        ]);
    });

    it("reports missing answer rows and rows without matching images", () => {
        const plan = prepareGoldenAnswersByKey(
            ["a.png", "b.png"],
            JSON.stringify({ filename: "c.png", label: { answer: "salad" } }),
        );

        expect(plan.pairs).toEqual([]);
        expect(plan.failures).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    row: 1,
                    reason: expect.stringContaining("No uploaded image"),
                }),
                {
                    fileName: "a.png",
                    reason: "No golden answer row references this image.",
                },
                {
                    fileName: "b.png",
                    reason: "No golden answer row references this image.",
                },
            ]),
        );
    });

    it("rejects answer files over the text import limit", () => {
        const plan = prepareGoldenAnswersByKey(
            ["a.png"],
            "x".repeat(MAX_TEXT_IMPORT_BYTES + 1),
        );

        expect(plan).toMatchObject({
            rejected: true,
            pairs: [],
        });
        expect(plan.failures[0].reason).toContain("Import file exceeds");
    });
});

describe("importFreeformImageAnswerItems", () => {
    it("inserts uploaded images with filename-matched labels", async () => {
        vi.mocked(addImageItem).mockClear();
        const summary = await importFreeformImageAnswerItems(
            "dataset-1",
            [fakeImageFile("a.png"), fakeImageFile("b.png")],
            [
                JSON.stringify({ filename: "a.png", label: { answer: "salad" } }),
                JSON.stringify({ filename: "b.png", label: { answer: "soup" } }),
            ].join("\n"),
        );

        expect(summary.importedCount).toBe(2);
        expect(summary.failures).toEqual([]);
        expect(addImageItem).toHaveBeenCalledWith(
            "dataset-1",
            expect.any(Buffer),
            "image/png",
            undefined,
            { answer: "salad" },
            "a.png",
        );
    });

    it("does not import ambiguous duplicate filenames with freeform answers", async () => {
        vi.mocked(addImageItem).mockClear();
        const summary = await importFreeformImageAnswerItems(
            "dataset-1",
            [fakeImageFile("a.png"), fakeImageFile("a.png")],
            JSON.stringify({ filename: "a.png", label: { answer: "salad" } }),
        );

        expect(summary.importedCount).toBe(0);
        expect(addImageItem).not.toHaveBeenCalled();
        expect(summary.failures).toContainEqual({
            fileName: "a.png",
            reason: "Duplicate filename in upload.",
        });
    });

    it("reports a duplicate uploaded file once, not also as unmatched", async () => {
        vi.mocked(addImageItem).mockClear();
        const summary = await importFreeformImageAnswerItems(
            "dataset-1",
            [fakeImageFile("a.png"), fakeImageFile("a.png"), fakeImageFile("b.png")],
            JSON.stringify({ filename: "b.png", label: { answer: "soup" } }),
        );

        expect(summary.importedCount).toBe(1);
        expect(addImageItem).toHaveBeenCalledTimes(1);
        expect(summary.failures).toEqual([
            { fileName: "a.png", reason: "Duplicate filename in upload." },
        ]);
    });
});

describe("prepareGoldenAnswersForItems", () => {
    const items = [
        { itemId: "item-0", matchKeys: ["item-0", "img0.png"] },
        { itemId: "item-1", matchKeys: ["item-1", "img1.png"] },
        { itemId: "item-2", matchKeys: ["item-2", "img2.png"] },
        { itemId: "item-3", matchKeys: ["item-3", "img3.png"] },
        { itemId: "item-4", matchKeys: ["item-4", "img4.png"] },
        { itemId: "item-5", matchKeys: ["item-5", "img5.png"] },
        { itemId: "item-6", matchKeys: ["item-6", "img6.png"] },
        { itemId: "item-7", matchKeys: ["item-7", "img7.png"] },
        { itemId: "item-8", matchKeys: ["item-8", "img8.png"] },
        { itemId: "item-9", matchKeys: ["item-9", "img9.png"] },
    ];

    it("AE2: pairs eight matching keys and reports two orphan items", () => {
        const lines = items.slice(0, 8).map((item) =>
            JSON.stringify({ key: item.matchKeys[1], label: { score: 8 } }),
        );
        const plan = prepareGoldenAnswersForItems(items, lines.join("\n"));

        expect(plan.pairs).toHaveLength(8);
        const orphanFailures = plan.failures.filter((f) => f.fileName);
        expect(orphanFailures).toHaveLength(2);
        expect(orphanFailures.map((f) => f.fileName)).toEqual([
            "item-8",
            "item-9",
        ]);
    });

    it("rejects duplicate keys in JSONL", () => {
        const content = [
            JSON.stringify({ key: "item-0", label: { score: 1 } }),
            JSON.stringify({ key: "item-0", label: { score: 2 } }),
        ].join("\n");
        const plan = prepareGoldenAnswersForItems([items[0]], content);

        expect(plan.pairs).toHaveLength(1);
        expect(plan.failures).toContainEqual({
            row: 2,
            reason: 'Duplicate key "item-0".',
        });
    });

    it("rejects answer values that are arrays", () => {
        const content = JSON.stringify({ key: "item-0", label: [1, 2] });
        const plan = prepareGoldenAnswersForItems([items[0]], content);

        expect(plan.pairs).toHaveLength(0);
        expect(plan.failures[0].reason).toContain("JSON object");
    });

    it("rejects JSONL lines over the byte limit", () => {
        const longKey = "x".repeat(MAX_JSONL_LINE_BYTES);
        const content = JSON.stringify({ key: longKey, label: { score: 1 } });
        const plan = prepareGoldenAnswersForItems([items[0]], content);

        expect(plan.pairs).toHaveLength(0);
        expect(plan.failures[0].reason).toContain("JSONL line limit");
    });

    it("rejects labels carrying reserved keys", () => {
        const content =
            '{"key":"item-0","label":{"__proto__":{"polluted":true},"score":1}}';
        const plan = prepareGoldenAnswersForItems([items[0]], content);

        expect(plan.pairs).toHaveLength(0);
        expect(plan.failures[0].reason).toContain("reserved key");
    });

    it("does not let source_name clobber another item's input_text match key", () => {
        // Fixed slots: [id, input_text, source_name]. Item B's source_name
        // equals item A's input_text; the more specific claim (input_text)
        // must win so golden answers bind to the correct items.
        const collisionItems = [
            {
                itemId: "item-a",
                matchKeys: ["item-a", "shared-key", "clip-a.wav"],
            },
            {
                itemId: "item-b",
                matchKeys: ["item-b", "other prompt", "shared-key"],
            },
        ];
        const content = [
            JSON.stringify({ key: "shared-key", label: { score: 1 } }),
            JSON.stringify({ key: "item-b", label: { score: 2 } }),
        ].join("\n");
        const plan = prepareGoldenAnswersForItems(collisionItems, content);

        expect(plan.pairs).toEqual(
            expect.arrayContaining([
                { itemId: "item-a", label: { score: 1 } },
                { itemId: "item-b", label: { score: 2 } },
            ]),
        );
        expect(plan.pairs).toHaveLength(2);
        // Item A is matched via its input_text, not overwritten by B.
        expect(plan.pairs.find((pair) => pair.itemId === "item-a")?.label).toEqual({
            score: 1,
        });
    });
});

describe("importGoldenAnswersForItems", () => {
    it("writes labels for matched pairs", async () => {
        vi.mocked(addLabel).mockClear();
        const content = JSON.stringify({
            key: "item-0",
            label: { score: 8, title: "oatmeal" },
        });
        const summary = await importGoldenAnswersForItems(
            "dataset-1",
            [{ itemId: "item-0", matchKeys: ["item-0"] }],
            content,
        );

        expect(summary.importedCount).toBe(1);
        expect(addLabel).toHaveBeenCalledWith("item-0", {
            score: 8,
            title: "oatmeal",
        });
    });
});
