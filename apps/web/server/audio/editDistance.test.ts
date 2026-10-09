import { describe, expect, it } from "vitest";
import { editCounts, type IEditCounts } from "./editDistance";

// V8 instrumentation distorts wall-clock measurements; regular unit tests keep
// enforcing these performance budgets while coverage runs still test results.
const checkPerformanceBudgets = process.env.MOSAIC_COVERAGE_RUN !== "1";

describe("editCounts", () => {
    it("matches the matrix implementation on deterministic random fixtures", () => {
        const random = seededRandom(42);
        const alphabet = ["a", "b", "c", "d"];
        for (let fixture = 0; fixture < 100; fixture += 1) {
            const reference = Array.from(
                { length: Math.floor(random() * 201) },
                () => alphabet[Math.floor(random() * alphabet.length)],
            );
            const candidate = Array.from(
                { length: Math.floor(random() * 201) },
                () => alphabet[Math.floor(random() * alphabet.length)],
            );
            expect(editCounts(reference, candidate)).toEqual(
                matrixEditCounts(reference, candidate),
            );
        }
    });

    it("rejects a pathological high-distance alignment within ten seconds", () => {
        const startedAt = performance.now();

        expect(() =>
            editCounts(
                Array.from({ length: 25_000 }, () => "a"),
                Array.from({ length: 25_000 }, () => "b"),
                500_000_000,
            ),
        ).toThrow("inputs are too long or dissimilar for safe exact scoring");
        if (checkPerformanceBudgets) {
            expect(performance.now() - startedAt).toBeLessThan(10_000);
        }
    }, 15_000);

    it("scores a real-world 45-minute meeting shape under the default cap (field regression)", () => {
        // Field case 2026-07-15: 23k-char candidate vs 23k-char gold with real
        // dissimilarity accumulated ~1.3B projected cells across band
        // doublings and was wrongly rejected by the old 500M cap.
        const reference = Array.from({ length: 8_000 }, () => "a");
        const candidate = Array.from({ length: 8_000 }, () => "b");
        const counts = editCounts(reference, candidate);
        expect(counts.substitutions).toBe(8_000);
        expect(counts.deletions).toBe(0);
        expect(counts.insertions).toBe(0);
    }, 30_000);
});

function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0;
        return state / 0x1_0000_0000;
    };
}

function matrixEditCounts(
    reference: string[],
    candidate: string[],
): IEditCounts {
    const distances = Array.from({ length: reference.length + 1 }, () =>
        Array.from({ length: candidate.length + 1 }, () => 0),
    );
    for (let row = 0; row <= reference.length; row += 1)
        distances[row][0] = row;
    for (let column = 0; column <= candidate.length; column += 1) {
        distances[0][column] = column;
    }
    for (let row = 1; row <= reference.length; row += 1) {
        for (let column = 1; column <= candidate.length; column += 1) {
            const substitution =
                reference[row - 1] === candidate[column - 1] ? 0 : 1;
            distances[row][column] = Math.min(
                distances[row - 1][column] + 1,
                distances[row][column - 1] + 1,
                distances[row - 1][column - 1] + substitution,
            );
        }
    }

    let row = reference.length;
    let column = candidate.length;
    let substitutions = 0;
    let deletions = 0;
    let insertions = 0;
    while (row > 0 || column > 0) {
        if (
            row > 0 &&
            column > 0 &&
            reference[row - 1] === candidate[column - 1] &&
            distances[row][column] === distances[row - 1][column - 1]
        ) {
            row -= 1;
            column -= 1;
        } else if (
            row > 0 &&
            column > 0 &&
            distances[row][column] === distances[row - 1][column - 1] + 1
        ) {
            substitutions += 1;
            row -= 1;
            column -= 1;
        } else if (
            row > 0 &&
            distances[row][column] === distances[row - 1][column] + 1
        ) {
            deletions += 1;
            row -= 1;
        } else {
            insertions += 1;
            column -= 1;
        }
    }
    return {
        substitutions,
        deletions,
        insertions,
        referenceLength: reference.length,
    };
}
