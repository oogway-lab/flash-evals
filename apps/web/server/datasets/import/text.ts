import Papa from "papaparse";
import type { IParsedSchemaDescriptor, LabelJson } from "../../db/jsonTypes";
import { addTextItem } from "../service";
import {
    MAX_IMPORT_ROWS,
    MAX_TEXT_IMPORT_BYTES,
    formatBytes,
    isRecord,
    parseJsonlLines,
    rejectImport,
    validateImportLabel,
    importFailureReason,
    type IImportFailure,
    type IImportSummary,
    type ImportFormat,
} from "./shared";

interface IPreparedTextRow {
    inputText: string;
    label: LabelJson;
}

export interface IPreparedTextImport {
    rows: IPreparedTextRow[];
    failures: IImportFailure[];
    rejected?: boolean;
}

export function prepareTextImport(
    content: string,
    format: Exclude<ImportFormat, "images">,
    schema: IParsedSchemaDescriptor,
): IPreparedTextImport {
    const payloadBytes = Buffer.byteLength(content, "utf8");
    if (payloadBytes > MAX_TEXT_IMPORT_BYTES) {
        return rejectImport(
            `Import file exceeds the ${formatBytes(MAX_TEXT_IMPORT_BYTES)} payload limit.`,
            { rows: [] },
        );
    }

    return format === "jsonl"
        ? prepareJsonlImport(content, schema)
        : prepareCsvImport(content, schema);
}

export async function importTextItems(
    datasetId: string,
    content: string,
    format: Exclude<ImportFormat, "images">,
    schema: IParsedSchemaDescriptor,
): Promise<IImportSummary> {
    const prepared = prepareTextImport(content, format, schema);
    if (prepared.rejected) {
        return {
            importedCount: 0,
            failures: prepared.failures,
            rejected: true,
        };
    }

    const failures = [...prepared.failures];
    let importedCount = 0;
    for (const row of prepared.rows) {
        try {
            await addTextItem(datasetId, row.inputText, row.label);
            importedCount++;
        } catch (err) {
            failures.push({
                reason: importFailureReason(err),
            });
        }
    }

    return { importedCount, failures };
}

function prepareJsonlImport(
    content: string,
    schema: IParsedSchemaDescriptor,
): IPreparedTextImport {
    const jsonl = parseJsonlLines(content, (parsed) => normalizeJsonlRow(parsed));
    if (jsonl.rejected) {
        return rejectImport(jsonl.failures[0]?.reason ?? "Import rejected.", {
            rows: [],
        });
    }

    const rows: IPreparedTextRow[] = [];
    const failures: IImportFailure[] = [...jsonl.failures];

    for (const { rowNumber, row } of jsonl.rows) {
        const labelFailures = validateImportLabel(row.label, schema);
        if (labelFailures.length > 0) {
            failures.push({ row: rowNumber, reason: labelFailures.join("; ") });
            continue;
        }
        rows.push(row);
    }

    return { rows, failures };
}

function prepareCsvImport(
    content: string,
    schema: IParsedSchemaDescriptor,
): IPreparedTextImport {
    if (schema.fields.some((field) => field.type === "string[]")) {
        return rejectImport("CSV import does not support array fields; use JSONL.", {
            rows: [],
        });
    }

    const parsed = Papa.parse<Record<string, string>>(content, {
        header: true,
        skipEmptyLines: "greedy",
    });
    const dataRows = parsed.data;

    if (dataRows.length > MAX_IMPORT_ROWS) {
        return rejectImport(`Import is limited to ${MAX_IMPORT_ROWS} rows.`, {
            rows: [],
        });
    }

    const rows: IPreparedTextRow[] = [];
    // Row numbers are 1-based data-row ordinals (header excluded, blank lines skipped).
    // Parse errors and validation failures share this base (+2) so a reported row is locatable.
    const failures: IImportFailure[] = parsed.errors.map((error) => ({
        row: error.row === undefined ? undefined : error.row + 2,
        reason: error.message,
    }));

    const fieldByName = new Map(schema.fields.map((field) => [field.name, field]));

    dataRows.forEach((row, index) => {
        const label: LabelJson = {};
        for (const [key, value] of Object.entries(row)) {
            if (key === "inputText") continue;
            const trimmed = String(value ?? "").trim();
            if (trimmed === "") continue;
            const field = fieldByName.get(key);
            label[key] =
                field?.type === "number" && Number.isFinite(Number(trimmed))
                    ? Number(trimmed)
                    : trimmed;
        }

        const labelFailures = validateImportLabel(label, schema);
        if (labelFailures.length > 0) {
            failures.push({ row: index + 2, reason: labelFailures.join("; ") });
            return;
        }

        rows.push({ inputText: row.inputText ?? "", label });
    });

    return { rows, failures };
}

function normalizeJsonlRow(
    value: unknown,
): { ok: true; row: IPreparedTextRow } | { ok: false; reason: string } {
    if (!isRecord(value)) {
        return { ok: false, reason: "Row must be a JSON object." };
    }

    const inputText =
        typeof value.inputText === "string" ? value.inputText : "";
    const labelValue = isRecord(value.label)
        ? value.label
        : Object.fromEntries(
              Object.entries(value).filter(([key]) => key !== "inputText"),
          );
    const label = { ...labelValue };

    return { ok: true, row: { inputText, label } };
}