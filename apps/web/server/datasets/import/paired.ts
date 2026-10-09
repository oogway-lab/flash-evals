import Papa from "papaparse";
import type { IParsedSchemaDescriptor, LabelJson } from "../../db/jsonTypes";
import {
    addImageItem,
} from "../service";
import { prepareGoldenAnswersByKey } from "./goldenAnswers";
import {
    MAX_IMPORT_ROWS,
    MAX_TEXT_IMPORT_BYTES,
    RESERVED_LABEL_KEYS,
    formatBytes,
    importFailureReason,
    validateImportLabel,
    type IImageImportFile,
    type IImportFailure,
    type IImportSummary,
} from "./shared";
import { partitionImageImportFiles } from "./images";

export interface IPairedPlanItem {
    fileName: string;
    label: LabelJson;
}

export interface IPairedPlan {
    items: IPairedPlanItem[];
    failures: IImportFailure[];
    rejected?: boolean;
}

export function preparePairedImport(
    fileNames: string[],
    csvContent: string,
    schema: IParsedSchemaDescriptor,
): IPairedPlan {
    if (schema.fields.some((field) => field.type === "string[]")) {
        return {
            items: [],
            rejected: true,
            failures: [
                {
                    reason: "Spreadsheet import does not support array fields; add those items individually.",
                },
            ],
        };
    }
    if (Buffer.byteLength(csvContent, "utf8") > MAX_TEXT_IMPORT_BYTES) {
        return {
            items: [],
            rejected: true,
            failures: [
                {
                    reason: `Spreadsheet exceeds the ${formatBytes(MAX_TEXT_IMPORT_BYTES)} payload limit.`,
                },
            ],
        };
    }

    const parsed = Papa.parse<Record<string, string>>(csvContent, {
        header: true,
        skipEmptyLines: "greedy",
    });

    if (!parsed.meta.fields?.includes("filename")) {
        return {
            items: [],
            rejected: true,
            failures: [{ reason: "Spreadsheet must have a 'filename' column." }],
        };
    }

    const knownFields = new Set(schema.fields.map((field) => field.name));
    const badColumns = (parsed.meta.fields ?? []).filter(
        (column) =>
            column !== "filename" &&
            (RESERVED_LABEL_KEYS.has(column) || !knownFields.has(column)),
    );
    if (badColumns.length > 0) {
        return {
            items: [],
            rejected: true,
            failures: [
                {
                    reason: `Unknown answer column(s): ${badColumns.join(", ")}. Use one column per pipeline field, plus 'filename'.`,
                },
            ],
        };
    }

    const dataRows = parsed.data;
    if (dataRows.length > MAX_IMPORT_ROWS) {
        return {
            items: [],
            rejected: true,
            failures: [{ reason: `Import is limited to ${MAX_IMPORT_ROWS} rows.` }],
        };
    }

    const fieldByName = new Map(schema.fields.map((field) => [field.name, field]));
    const fileSet = new Set(fileNames);
    const seenInCsv = new Set<string>();
    const matched = new Set<string>();
    const items: IPairedPlanItem[] = [];
    const failures: IImportFailure[] = parsed.errors.map((error) => ({
        row: error.row === undefined ? undefined : error.row + 2,
        reason: error.message,
    }));

    dataRows.forEach((row, index) => {
        const rowNumber = index + 2;
        const fileName = String(row.filename ?? "").trim();
        if (!fileName) {
            failures.push({ row: rowNumber, reason: "Missing filename." });
            return;
        }
        if (seenInCsv.has(fileName)) {
            failures.push({
                row: rowNumber,
                reason: `Duplicate filename "${fileName}".`,
            });
            return;
        }
        seenInCsv.add(fileName);
        if (!fileSet.has(fileName)) {
            failures.push({
                row: rowNumber,
                reason: `No uploaded image named "${fileName}".`,
            });
            return;
        }

        const label: LabelJson = {};
        for (const [key, value] of Object.entries(row)) {
            if (key === "filename" || RESERVED_LABEL_KEYS.has(key)) continue;
            const field = fieldByName.get(key);
            if (!field) continue;
            const trimmed = String(value ?? "").trim();
            if (trimmed === "") continue;
            label[key] =
                field.type === "number" && Number.isFinite(Number(trimmed))
                    ? Number(trimmed)
                    : trimmed;
        }

        const labelFailures = validateImportLabel(label, schema);
        if (labelFailures.length > 0) {
            failures.push({ row: rowNumber, reason: labelFailures.join("; ") });
            return;
        }

        items.push({ fileName, label });
        matched.add(fileName);
    });

    for (const fileName of fileNames) {
        if (!matched.has(fileName)) {
            failures.push({
                fileName,
                reason: "No spreadsheet row references this image.",
            });
        }
    }

    return { items, failures };
}

export async function importPairedItems(
    datasetId: string,
    files: IImageImportFile[],
    csvContent: string,
    schema: IParsedSchemaDescriptor,
): Promise<IImportSummary> {
    const partition = partitionImageImportFiles(files);
    if (partition.summary.rejected) return partition.summary;

    const plan = preparePairedImport(
        partition.uniqueValidNames,
        csvContent,
        schema,
    );
    if (plan.rejected) {
        return { importedCount: 0, failures: plan.failures, rejected: true };
    }

    const fileByName = new Map(files.map((file) => [file.name, file]));
    const failures = [...partition.summary.failures, ...plan.failures];
    let importedCount = 0;

    for (const item of plan.items) {
        const file = fileByName.get(item.fileName);
        if (!file) continue;
        try {
            const bytes = Buffer.from(await file.arrayBuffer());
            await addImageItem(
                datasetId,
                bytes,
                file.type,
                undefined,
                item.label,
                item.fileName,
            );
            importedCount++;
        } catch (err) {
            failures.push({
                fileName: item.fileName,
                reason: importFailureReason(err),
            });
        }
    }

    return { importedCount, failures };
}

export async function importFreeformImageAnswerItems(
    datasetId: string,
    files: IImageImportFile[],
    answersContent: string,
): Promise<IImportSummary> {
    const partition = partitionImageImportFiles(files);
    if (partition.summary.rejected) return partition.summary;

    const plan = prepareGoldenAnswersByKey(
        partition.uniqueValidNames,
        answersContent,
    );
    if (plan.rejected) {
        return { importedCount: 0, failures: plan.failures, rejected: true };
    }

    const fileByName = new Map(files.map((file) => [file.name, file]));
    const failures = [...partition.summary.failures, ...plan.failures];
    let importedCount = 0;

    for (const item of plan.pairs) {
        const file = fileByName.get(item.key);
        if (!file) continue;
        try {
            const bytes = Buffer.from(await file.arrayBuffer());
            await addImageItem(
                datasetId,
                bytes,
                file.type,
                undefined,
                item.label,
                item.key,
            );
            importedCount++;
        } catch (err) {
            failures.push({
                fileName: item.key,
                reason: importFailureReason(err),
            });
        }
    }

    return { importedCount, failures };
}
