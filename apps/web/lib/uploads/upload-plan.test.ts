import { describe, expect, it } from "vitest";
import { fileMatchesAccept, planUpload } from "./upload-plan";

const MB = 1024 * 1024;

function wav(name: string, size: number, lastModified = 1): File {
    const file = new File(["x"], name, { type: "audio/wav", lastModified });
    // jsdom derives size from the blob parts; override to hit the limits cheaply.
    Object.defineProperty(file, "size", { value: size });
    return file;
}

const limits = {
    accept: "audio/wav",
    maxBytes: 50 * MB,
    maxFiles: 3,
    maxTotalBytes: 100 * MB,
};

const names = (files: File[]) => files.map((file) => file.name);

describe("fileMatchesAccept", () => {
    it("matches extensions, exact types and wildcards", () => {
        const png = new File(["x"], "a.png", { type: "image/png" });
        expect(fileMatchesAccept(png, "image/png")).toBe(true);
        expect(fileMatchesAccept(png, "image/*")).toBe(true);
        expect(
            fileMatchesAccept(
                new File(["x"], "x.PNG", { type: "image/png" }),
                ".png",
            ),
        ).toBe(true);
        expect(fileMatchesAccept(png, ".csv,text/csv")).toBe(false);
    });
});

describe("planUpload", () => {
    it("includes everything that fits and totals it", () => {
        const plan = planUpload(
            [wav("a.wav", 10 * MB), wav("b.wav", 20 * MB)],
            limits,
        );
        expect(names(plan.included)).toEqual(["a.wav", "b.wav"]);
        expect(plan.excluded).toEqual([]);
        expect(plan.includedBytes).toBe(30 * MB);
    });

    it("leaves out wrong types, oversize files and duplicates with a reason", () => {
        const a = wav("a.wav", 1 * MB);
        const plan = planUpload(
            [
                a,
                new File(["x"], "notes.txt", { type: "text/plain" }),
                wav("huge.wav", 60 * MB),
                wav("a.wav", 1 * MB),
            ],
            limits,
        );
        expect(names(plan.included)).toEqual(["a.wav"]);
        expect(
            plan.excluded.map(({ file, reason }) => [file.name, reason]),
        ).toEqual([
            ["notes.txt", "unsupported-type"],
            ["huge.wav", "too-large"],
            ["a.wav", "duplicate"],
        ]);
    });

    it("fills the batch-size limit in picked order and still fits smaller files later", () => {
        const plan = planUpload(
            [
                wav("a.wav", 45 * MB),
                wav("b.wav", 45 * MB),
                wav("c.wav", 40 * MB),
                wav("d.wav", 5 * MB, 2),
            ],
            { ...limits, maxFiles: undefined },
        );
        expect(names(plan.included)).toEqual(["a.wav", "b.wav", "d.wav"]);
        expect(plan.excluded).toEqual([
            {
                file: expect.objectContaining({ name: "c.wav" }),
                reason: "over-batch-size",
            },
        ]);
        expect(plan.includedBytes).toBe(95 * MB);
    });

    it("leaves out files past the file-count limit", () => {
        const plan = planUpload(
            ["a", "b", "c", "d"].map((name) => wav(`${name}.wav`, MB)),
            limits,
        );
        expect(names(plan.included)).toEqual(["a.wav", "b.wav", "c.wav"]);
        expect(plan.excluded).toEqual([
            {
                file: expect.objectContaining({ name: "d.wav" }),
                reason: "too-many",
            },
        ]);
    });
});
