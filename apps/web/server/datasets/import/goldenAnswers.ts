import type { LabelJson } from "../../db/jsonTypes";
import { addLabel } from "../service";
import {
    MAX_IMPORT_ROWS,
    MAX_TEXT_IMPORT_BYTES,
    RESERVED_LABEL_KEYS,
    formatBytes,
    importFailureReason,
    isRecord,
    parseJsonlLines,
    type IImportFailure,
    type IImportSummary,
} from "./shared";

export interface IGoldenItemRef {
    itemId: string;
    matchKeys: string[];
}

export function goldenItemRefsFromItems(
    items: Array<{ id: string; inputText: string | null }>,
): IGoldenItemRef[] {
    return items.map((item) => {
        const keys = [item.id];
        if (item.inputText?.trim()) keys.push(item.inputText.trim());
        return { itemId: item.id, matchKeys: keys };
    });
}

export interface IGoldenAnswerPair {
    itemId: string;
    label: LabelJson;
}

export interface IGoldenAnswerKeyPair {
    key: string;
    label: LabelJson;
}

export interface IGoldenAnswersPlan {
    pairs: IGoldenAnswerPair[];
    failures: IImportFailure[];
    rejected?: boolean;
}

export interface IGoldenAnswersByKeyPlan {
    pairs: IGoldenAnswerKeyPair[];
    failures: IImportFailure[];
    rejected?: boolean;
}

const GOLDEN_KEY_ALIASES = new Set(["key", "itemId", "item_id", "filename", "id"]);

export function prepareGoldenAnswersForItems(
    items: IGoldenItemRef[],
    content: string,
): IGoldenAnswersPlan {
    if (Buffer.byteLength(content, "utf8") > MAX_TEXT_IMPORT_BYTES) {
        return {
            pairs: [],
            rejected: true,
            failures: [
                {
                    reason: `Import file exceeds the ${formatBytes(MAX_TEXT_IMPORT_BYTES)} payload limit.`,
                },
            ],
        };
    }

    const parsedRows = parseGoldenAnswersPayload(content);
    if (parsedRows.rejected) {
        return { pairs: [], failures: parsedRows.failures, rejected: true };
    }

    // Prefer more specific keys (earlier in matchKeys: id > input_text >
    // source_name). Never let a lower-priority key silently clobber a higher-
    // priority claim from another item. Priority is position-based so a
    // trailing source_name never outranks another item's input_text.
    const keyToItem = new Map<string, string>();
    const keyPriority = new Map<string, number>();
    for (const item of items) {
        item.matchKeys.forEach((key, index) => {
            if (!key) return;
            // Higher number = more specific (index 0 is id).
            const priority = 1000 - index;
            const existingPriority = keyPriority.get(key);
            if (existingPriority === undefined || priority > existingPriority) {
                keyToItem.set(key, item.itemId);
                keyPriority.set(key, priority);
            }
        });
    }

    const matched = new Set<string>();
    const pairs: IGoldenAnswerPair[] = [];
    const failures: IImportFailure[] = [...parsedRows.failures];
    const seenKeys = new Set<string>();

    for (const { rowNumber, key, label } of parsedRows.rows) {
        if (!key) {
            failures.push({ row: rowNumber, reason: "Missing key (use key, itemId, or filename)." });
            continue;
        }
        if (seenKeys.has(key)) {
            failures.push({
                row: rowNumber,
                reason: `Duplicate key "${key}".`,
            });
            continue;
        }
        seenKeys.add(key);

        const labelCheck = assertGoldenLabelObject(label, rowNumber);
        if (!labelCheck.ok) {
            failures.push(labelCheck.failure);
            continue;
        }

        const itemId = keyToItem.get(key);
        if (!itemId) {
            failures.push({
                row: rowNumber,
                reason: `No dataset item matches key "${key}".`,
            });
            continue;
        }
        if (matched.has(itemId)) {
            failures.push({
                row: rowNumber,
                reason: `Item already matched by an earlier row (key "${key}").`,
            });
            continue;
        }

        pairs.push({ itemId, label: labelCheck.label });
        matched.add(itemId);
    }

    for (const item of items) {
        if (!matched.has(item.itemId)) {
            failures.push({
                fileName: item.matchKeys[0] ?? item.itemId,
                reason: "No golden answer row references this item.",
            });
        }
    }

    return { pairs, failures };
}

export function prepareGoldenAnswersByKey(
    requiredKeys: string[],
    content: string,
    keyLabel = "filename",
    mediaLabel = "image",
): IGoldenAnswersByKeyPlan {
    if (Buffer.byteLength(content, "utf8") > MAX_TEXT_IMPORT_BYTES) {
        return {
            pairs: [],
            rejected: true,
            failures: [
                {
                    reason: `Import file exceeds the ${formatBytes(MAX_TEXT_IMPORT_BYTES)} payload limit.`,
                },
            ],
        };
    }

    const parsedRows = parseGoldenAnswersPayload(content);
    if (parsedRows.rejected) {
        return { pairs: [], failures: parsedRows.failures, rejected: true };
    }

    const required = new Set(requiredKeys);
    const matched = new Set<string>();
    const pairs: IGoldenAnswerKeyPair[] = [];
    const failures: IImportFailure[] = [...parsedRows.failures];
    const seenKeys = new Set<string>();

    for (const { rowNumber, key, label } of parsedRows.rows) {
        if (!key) {
            failures.push({
                row: rowNumber,
                reason: `Missing ${keyLabel} (use filename, key, or id).`,
            });
            continue;
        }
        if (seenKeys.has(key)) {
            failures.push({
                row: rowNumber,
                reason: `Duplicate ${keyLabel} "${key}".`,
            });
            continue;
        }
        seenKeys.add(key);

        const labelCheck = assertGoldenLabelObject(label, rowNumber);
        if (!labelCheck.ok) {
            failures.push(labelCheck.failure);
            continue;
        }

        if (!required.has(key)) {
            failures.push({
                row: rowNumber,
                reason: `No uploaded ${mediaLabel} matches ${keyLabel} "${key}".`,
            });
            continue;
        }
        pairs.push({ key, label: labelCheck.label });
        matched.add(key);
    }

    for (const key of requiredKeys) {
        if (!matched.has(key)) {
            failures.push({
                fileName: key,
                reason: `No golden answer row references this ${mediaLabel}.`,
            });
        }
    }

    return { pairs, failures };
}

export async function importGoldenAnswersForItems(
    _datasetId: string,
    items: IGoldenItemRef[],
    content: string,
): Promise<IImportSummary> {
    const plan = prepareGoldenAnswersForItems(items, content);
    if (plan.rejected) {
        return { importedCount: 0, failures: plan.failures, rejected: true };
    }

    const failures = [...plan.failures];
    let importedCount = 0;

    for (const pair of plan.pairs) {
        try {
            await addLabel(pair.itemId, pair.label);
            importedCount++;
        } catch (err) {
            failures.push({
                row: undefined,
                reason: importFailureReason(err),
            });
        }
    }

    return { importedCount, failures };
}

interface IGoldenParsedRow {
    rowNumber?: number;
    key: string;
    label: unknown;
}

function parseGoldenAnswersPayload(content: string): {
    rows: IGoldenParsedRow[];
    failures: IImportFailure[];
    rejected?: boolean;
} {
    const trimmed = content.trim();
    if (!trimmed) {
        return {
            rows: [],
            failures: [{ reason: "Golden answers file is empty." }],
            rejected: true,
        };
    }

    if (trimmed.startsWith("[")) {
        try {
            const array = JSON.parse(trimmed) as unknown;
            if (!Array.isArray(array)) {
                return {
                    rows: [],
                    failures: [{ reason: "Golden answers array is invalid." }],
                    rejected: true,
                };
            }
            if (array.length > MAX_IMPORT_ROWS) {
                return {
                    rows: [],
                    failures: [{ reason: `Import is limited to ${MAX_IMPORT_ROWS} rows.` }],
                    rejected: true,
                };
            }
            const rows: IGoldenParsedRow[] = [];
            const failures: IImportFailure[] = [];
            array.forEach((entry, index) => {
                const normalized = normalizeGoldenAnswerEntry(entry);
                if (!normalized.ok) {
                    failures.push({
                        row: index + 1,
                        reason: normalized.reason,
                    });
                    return;
                }
                rows.push({
                    rowNumber: index + 1,
                    key: normalized.key,
                    label: normalized.label,
                });
            });
            return { rows, failures };
        } catch (err) {
            return {
                rows: [],
                failures: [
                    {
                        reason: importFailureReason(err),
                    },
                ],
                rejected: true,
            };
        }
    }

    const jsonl = parseJsonlLines(content, (parsed) => {
        const normalized = normalizeGoldenAnswerEntry(parsed);
        if (!normalized.ok) return normalized;
        return {
            ok: true,
            row: { key: normalized.key, label: normalized.label },
        };
    });
    if (jsonl.rejected) {
        return { rows: [], failures: jsonl.failures, rejected: true };
    }
    return {
        rows: jsonl.rows.map(({ rowNumber, row }) => ({
            rowNumber,
            key: row.key,
            label: row.label,
        })),
        failures: jsonl.failures,
    };
}

function normalizeGoldenAnswerEntry(
    value: unknown,
): { ok: true; key: string; label: unknown } | { ok: false; reason: string } {
    if (!isRecord(value)) {
        return { ok: false, reason: "Row must be a JSON object." };
    }

    if ("label" in value && value.label !== undefined) {
        if (!isRecord(value.label)) {
            return {
                ok: false,
                reason: "Golden answer must be a JSON object.",
            };
        }
        const key =
            typeof value.key === "string"
                ? value.key.trim()
                : typeof value.itemId === "string"
                  ? value.itemId.trim()
                  : typeof value.filename === "string"
                    ? value.filename.trim()
                    : typeof value.id === "string"
                      ? value.id.trim()
                      : "";
        return { ok: true, key, label: value.label };
    }

    const keyField = Object.keys(value).find((k) => GOLDEN_KEY_ALIASES.has(k));
    if (!keyField) {
        return {
            ok: false,
            reason: "Row must include key, itemId, or filename plus answer fields.",
        };
    }
    const key = String(value[keyField] ?? "").trim();
    const label = Object.fromEntries(
        Object.entries(value).filter(([k]) => !GOLDEN_KEY_ALIASES.has(k)),
    );
    return { ok: true, key, label };
}

function assertGoldenLabelObject(
    value: unknown,
    rowNumber?: number,
):
    | { ok: true; label: LabelJson }
    | { ok: false; failure: IImportFailure } {
    if (!isRecord(value)) {
        return {
            ok: false,
            failure: {
                row: rowNumber,
                reason: "Golden answer must be a JSON object.",
            },
        };
    }
    const reserved = Object.keys(value).find((key) =>
        RESERVED_LABEL_KEYS.has(key),
    );
    if (reserved) {
        return {
            ok: false,
            failure: {
                row: rowNumber,
                reason: `"${reserved}" is a reserved key and cannot be used.`,
            },
        };
    }
    return { ok: true, label: value };
}
