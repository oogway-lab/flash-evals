export interface IEditCounts {
    substitutions: number;
    deletions: number;
    insertions: number;
    referenceLength: number;
}

interface IEditRow {
    distance: Uint32Array;
    substitutions: Uint32Array;
    deletions: Uint32Array;
    insertions: Uint32Array;
}

const INITIAL_BAND_WIDTH = 64;
const UNREACHABLE = 0xffffffff;
// CPU-time guard only — memory stays O(min(n,m)) via the banded two-row DP.
// Sized so a full hour-long meeting transcript (~60k chars) against a fully
// dissimilar reference (~4B visited cells, tens of seconds) still scores,
// while a runaway pathological input cannot pin the worker indefinitely.
// A real 45-min field case (23k x 23k chars, ~529M cells) must pass.
const MAX_EDIT_CELLS = 4_000_000_000;
export const MAX_TRANSCRIPT_CHARACTERS = 2_000_000;

export function assertTranscriptSize(
    text: string,
    side: "reference" | "candidate",
    metric = "Transcript",
): void {
    assertTranscriptLength(text.length, side, metric);
}

export function assertTranscriptLength(
    length: number,
    side: "reference" | "candidate",
    metric = "Transcript",
): void {
    if (length <= MAX_TRANSCRIPT_CHARACTERS) return;
    throw new Error(
        `${metric} scoring rejected ${side} text with ${length} characters; maximum accepted length is ${MAX_TRANSCRIPT_CHARACTERS}.`,
    );
}

export function editCounts(
    reference: string[],
    candidate: string[],
    maxEditCells = MAX_EDIT_CELLS,
): IEditCounts {
    const referenceLength = reference.length;
    const { left, right } = trimSharedEdges(reference, candidate);
    if (left.length === 0 || right.length === 0) {
        return {
            substitutions: 0,
            deletions: left.length,
            insertions: right.length,
            referenceLength,
        };
    }

    const transposed = right.length > left.length;
    const rows = transposed ? right : left;
    const columns = transposed ? left : right;
    const counts = bandedEditCounts(rows, columns, !transposed, maxEditCells);
    return {
        substitutions: counts.substitutions,
        deletions: transposed ? counts.insertions : counts.deletions,
        insertions: transposed ? counts.deletions : counts.insertions,
        referenceLength,
    };
}

function bandedEditCounts(
    rows: string[],
    columns: string[],
    preferDeletion: boolean,
    maxEditCells: number,
): Omit<IEditCounts, "referenceLength"> {
    let band = Math.max(INITIAL_BAND_WIDTH, rows.length - columns.length);
    let visitedCellBudget = 0;
    while (true) {
        visitedCellBudget +=
            rows.length * Math.min(columns.length + 1, band * 2 + 1);
        if (visitedCellBudget > maxEditCells) {
            throw new Error(
                `Transcript scoring rejected an alignment requiring more than ${maxEditCells} edit cells; inputs are too long or dissimilar for safe exact scoring.`,
            );
        }
        const result = editCountsWithinBand(
            rows,
            columns,
            band,
            preferDeletion,
        );
        // An alignment costing at most `band` cannot leave this diagonal band,
        // so this is the same result as the unbounded matrix.
        if (result.distance <= band || band >= rows.length) return result;
        band = Math.min(rows.length, band * 2);
    }
}

function editCountsWithinBand(
    rows: string[],
    columns: string[],
    band: number,
    preferDeletion: boolean,
): Omit<IEditCounts, "referenceLength"> & { distance: number } {
    let previous = createRow(columns.length + 1);
    let current = createRow(columns.length + 1);
    const initialEnd = Math.min(columns.length, band);
    for (let column = 0; column <= initialEnd; column += 1) {
        previous.distance[column] = column;
        previous.insertions[column] = column;
    }
    if (initialEnd < columns.length) {
        previous.distance[initialEnd + 1] = UNREACHABLE;
    }

    for (let row = 1; row <= rows.length; row += 1) {
        const start = Math.max(0, row - band);
        const end = Math.min(columns.length, row + band);
        if (start === 0) {
            current.distance[0] = row;
            current.substitutions[0] = 0;
            current.deletions[0] = row;
            current.insertions[0] = 0;
        } else {
            current.distance[start - 1] = UNREACHABLE;
        }

        for (let column = Math.max(1, start); column <= end; column += 1) {
            if (rows[row - 1] === columns[column - 1]) {
                copyCell(current, column, previous, column - 1);
                continue;
            }
            chooseEdit(current, previous, column, preferDeletion);
        }
        if (end < columns.length) current.distance[end + 1] = UNREACHABLE;
        [previous, current] = [current, previous];
    }

    const column = columns.length;
    return {
        distance: previous.distance[column],
        substitutions: previous.substitutions[column],
        deletions: previous.deletions[column],
        insertions: previous.insertions[column],
    };
}

function chooseEdit(
    current: IEditRow,
    previous: IEditRow,
    column: number,
    preferDeletion: boolean,
): void {
    const substitution = previous.distance[column - 1] + 1;
    const deletion = previous.distance[column] + 1;
    const insertion = current.distance[column - 1] + 1;
    const best = Math.min(substitution, deletion, insertion);

    if (substitution === best) {
        copyCell(current, column, previous, column - 1);
        current.distance[column] = substitution;
        current.substitutions[column] += 1;
    } else if (
        (preferDeletion && deletion === best) ||
        (!preferDeletion && insertion !== best)
    ) {
        copyCell(current, column, previous, column);
        current.distance[column] = deletion;
        current.deletions[column] += 1;
    } else {
        copyCell(current, column, current, column - 1);
        current.distance[column] = insertion;
        current.insertions[column] += 1;
    }
}

function createRow(length: number): IEditRow {
    return {
        distance: new Uint32Array(length),
        substitutions: new Uint32Array(length),
        deletions: new Uint32Array(length),
        insertions: new Uint32Array(length),
    };
}

function copyCell(
    target: IEditRow,
    targetIndex: number,
    source: IEditRow,
    sourceIndex: number,
): void {
    target.distance[targetIndex] = source.distance[sourceIndex];
    target.substitutions[targetIndex] = source.substitutions[sourceIndex];
    target.deletions[targetIndex] = source.deletions[sourceIndex];
    target.insertions[targetIndex] = source.insertions[sourceIndex];
}

function trimSharedEdges(
    reference: string[],
    candidate: string[],
): { left: string[]; right: string[] } {
    let start = 0;
    const sharedLength = Math.min(reference.length, candidate.length);
    while (start < sharedLength && reference[start] === candidate[start])
        start += 1;

    let referenceEnd = reference.length;
    let candidateEnd = candidate.length;
    while (
        referenceEnd > start &&
        candidateEnd > start &&
        reference[referenceEnd - 1] === candidate[candidateEnd - 1]
    ) {
        referenceEnd -= 1;
        candidateEnd -= 1;
    }
    return {
        left: reference.slice(start, referenceEnd),
        right: candidate.slice(start, candidateEnd),
    };
}
