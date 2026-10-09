import type {
    AnswerImportInterpretation,
    AnswerImportTargetField,
    IAnswerImportFile,
    IAnswerImportMapping,
    IAnswerImportPreview,
    LabelJson,
} from "@mosaic/api-contract";
import {
    isSpeakerTurnTranscript,
    normalizeSpeakerTurns,
    transcriptFromTurns,
    valueShape,
} from "./speakerTurnMapping.js";

export interface IAnswerImportItem {
    itemId: string;
    inputText: string | null;
    sourceName: string | null;
    hasLabel?: boolean;
}

interface IParsedAnswerRow {
    row: number;
    value: Record<string, unknown>;
    fileName?: string;
    interpretation?: AnswerImportInterpretation;
    interpretationAmbiguous?: boolean;
    requestedItemId?: string;
    allowOverwrite?: boolean;
}
interface IParsedAnswerError {
    row: number;
    message: string;
    fileName?: string;
}

const MAX_ANSWER_IMPORT_ROWS = 1_000;
const DERIVED_TRANSCRIPT_FIELD = "__derivedExpectedTranscript";

type ObservedAnswerField = IAnswerImportPreview["fields"][number];

const TARGET_ALIASES: Record<
    Exclude<AnswerImportTargetField, "ignore">,
    string[]
> = {
    expectedTranscript: [
        "expectedtranscript",
        "transcript",
        "gt",
        "groundtruth",
        "reference",
        "text",
    ],
    expectedTranscriptLatin: [
        "expectedtranscriptlatin",
        "latin",
        "latintranscript",
        "transliteration",
    ],
    expectedLanguage: ["expectedlanguage", "language", "lang"],
    expectedSpeakerTurns: [
        "expectedspeakerturns",
        "speakers",
        "turns",
        "segments",
    ],
    domainTerms: ["domainterms", "terms", "keywords"],
    expectedNumbers: ["expectednumbers", "numbers"],
    referenceKind: ["referencekind", "kind"],
    latencySlaMs: ["latencyslams", "latencysla"],
    costOutlierUsd: ["costoutlierusd", "costoutlier"],
};

const ANSWER_TARGETS = new Set<AnswerImportTargetField>([
    ...(Object.keys(TARGET_ALIASES) as Array<
        Exclude<AnswerImportTargetField, "ignore">
    >),
    "ignore",
]);

const KEY_ALIASES = [
    "key",
    "itemid",
    "item_id",
    "filename",
    "file",
    "name",
    "id",
];

const SINGLE_RECORD_ALIASES = new Set([
    ...Object.values(TARGET_ALIASES).flat(),
    "userid",
    "memoryid",
    "title",
    "mom",
    "label",
]);

export function previewAnswerImport(
    content: string,
    items: IAnswerImportItem[],
    requestedMapping?: IAnswerImportMapping,
): IAnswerImportPreview {
    return previewAnswerFiles(
        [{ fileName: "answers.json", content }],
        items,
        requestedMapping,
    );
}

export function previewAnswerFiles(
    answerFiles: IAnswerImportFile[],
    items: IAnswerImportItem[],
    requestedMapping?: IAnswerImportMapping,
): IAnswerImportPreview {
    const parsed = answerFiles.reduce<{
        rows: IParsedAnswerRow[];
        errors: IParsedAnswerError[];
    }>(
        (batch, file) => {
            if (
                batch.rows.length + batch.errors.length >=
                MAX_ANSWER_IMPORT_ROWS
            ) {
                batch.errors.push({
                    row: 1,
                    fileName: file.fileName,
                    message: `Answer import is limited to ${MAX_ANSWER_IMPORT_ROWS} rows across all files.`,
                });
                return batch;
            }
            const next = parseAnswerRows(file.content, {
                file,
                items,
            });
            batch.rows.push(...next.rows);
            batch.errors.push(
                ...next.errors.map((error) => ({
                    ...error,
                    fileName: file.fileName,
                    message: `${file.fileName}: ${error.message}`,
                })),
            );
            return batch;
        },
        { rows: [], errors: [] },
    );
    if (parsed.rows.length + parsed.errors.length > MAX_ANSWER_IMPORT_ROWS) {
        return {
            fields: [],
            proposedMapping: {},
            rows: [
                {
                    row: 1,
                    status: "failing",
                    messages: [
                        `Answer import is limited to ${MAX_ANSWER_IMPORT_ROWS} rows across all files.`,
                    ],
                },
            ],
            importableCount: 0,
            warningCount: 0,
            failingCount: 1,
            itemOptions: answerItemOptions(items),
        };
    }
    const fields = observedFields(parsed.rows);
    const proposedMapping = proposeAnswerMapping(fields);
    const mapping = requestedMapping ?? proposedMapping;
    const mappingErrors = validateMapping(mapping, fields);
    const itemIndex = itemKeyIndex(items);
    const matchedItems = new Set<string>();
    const seenKeys = new Set<string>();
    const rows = parsed.rows.map((parsedRow) =>
        previewMappedRow({
            ...parsedRow,
            fields,
            mapping,
            mappingErrors,
            items,
            itemIndex,
            matchedItems,
            seenKeys,
        }),
    );
    rows.push(
        ...parsed.errors.map(({ row, message, fileName }) => ({
            row,
            ...(fileName ? { fileName } : {}),
            status: "failing" as const,
            messages: [message],
        })),
    );
    return {
        fields,
        proposedMapping,
        rows,
        importableCount: rows.filter((row) => row.status === "importable")
            .length,
        warningCount: rows.filter((row) => row.status === "warning").length,
        failingCount: rows.filter((row) => row.status === "failing").length,
        itemOptions: answerItemOptions(items),
    };
}

function answerItemOptions(items: IAnswerImportItem[]) {
    return items.map((item) => ({
        itemId: item.itemId,
        sourceName: item.sourceName ?? item.inputText ?? item.itemId,
    }));
}

function previewMappedRow(input: {
    row: number;
    value: Record<string, unknown>;
    mapping: IAnswerImportMapping;
    fields: ObservedAnswerField[];
    mappingErrors: string[];
    items: IAnswerImportItem[];
    itemIndex: ReturnType<typeof itemKeyIndex>;
    matchedItems: Set<string>;
    seenKeys: Set<string>;
    fileName?: string;
    interpretation?: AnswerImportInterpretation;
    interpretationAmbiguous?: boolean;
    requestedItemId?: string;
    allowOverwrite?: boolean;
}): IAnswerImportPreview["rows"][number] {
    const {
        key,
        item,
        messages,
        matchReason,
        requiresItemSelection,
        requiresOverwriteConfirmation,
    } = matchAnswerRow(input);
    const label = applyAnswerMapping(
        input.value,
        input.mapping,
        input.interpretation === "single_record",
        input.fields,
    );
    messages.push(...validateMappedLabel(label, input.row));
    if (item && messages.length === 0) input.matchedItems.add(item.itemId);
    const warnings =
        messages.length === 0 && !label.expectedTranscript
            ? ["No gold transcript; transcript scoring will be skipped."]
            : [];
    const status =
        messages.length > 0
            ? "failing"
            : warnings.length > 0
              ? "warning"
              : "importable";
    return {
        row: input.row,
        ...(input.fileName ? { fileName: input.fileName } : {}),
        ...(key ? { key } : {}),
        status,
        messages: [...messages, ...warnings],
        ...(item ? { itemId: item.itemId } : {}),
        ...(item?.sourceName ? { itemSourceName: item.sourceName } : {}),
        ...(input.interpretation
            ? { interpretation: input.interpretation }
            : {}),
        ...(input.interpretationAmbiguous
            ? { interpretationAmbiguous: true }
            : {}),
        ...(requiresItemSelection ? { requiresItemSelection: true } : {}),
        ...(requiresOverwriteConfirmation
            ? { requiresOverwriteConfirmation: true }
            : {}),
        ...(matchReason ? { matchReason } : {}),
        ...(messages.length === 0 ? { label } : {}),
    };
}

function matchAnswerRow(input: Parameters<typeof previewMappedRow>[0]): {
    key?: string;
    item?: IAnswerImportItem;
    messages: string[];
    matchReason?: "filename_stem" | "only_unlabeled" | "selected";
    requiresItemSelection?: boolean;
    requiresOverwriteConfirmation?: boolean;
} {
    const messages = [...input.mappingErrors];
    const interpretation = input.interpretation;
    if (input.interpretationAmbiguous) {
        messages.push(
            "This object can be read as one item's answer or as item-name keys. Choose an interpretation.",
        );
    }
    if (interpretation === "single_record") {
        return matchSingleRecord(input, messages);
    }
    const key = answerRowKey(input.value);
    if (!key) messages.push("Missing item key or filename.");
    if (key && input.seenKeys.has(key))
        messages.push(`Duplicate key "${key}".`);
    if (key) input.seenKeys.add(key);
    if (key && input.itemIndex.ambiguous.has(key)) {
        messages.push(`Item key "${key}" is ambiguous.`);
    }
    const item = key ? input.itemIndex.items.get(key) : undefined;
    if (key && !item) {
        const suggestion = closestItemName(key, input.items);
        messages.push(
            `No audio item named ${key}${suggestion ? ` — closest match: ${suggestion}` : ""}.`,
        );
    }
    if (item && input.matchedItems.has(item.itemId)) {
        messages.push("This item was already matched by an earlier row.");
    }
    return { key, item, messages };
}

function matchSingleRecord(
    input: Parameters<typeof previewMappedRow>[0],
    messages: string[],
) {
    const fileName = input.fileName ?? "answer file";
    const requestedItemId = input.requestedItemId;
    const selected =
        typeof requestedItemId === "string"
            ? input.items.find((item) => item.itemId === requestedItemId)
            : undefined;
    if (requestedItemId && !selected) {
        messages.push("The selected audio item is no longer available.");
        return {
            key: fileName,
            item: undefined,
            messages,
            requiresItemSelection: true,
        };
    }
    if (selected) {
        const duplicate = rejectDuplicateItem(input, selected, messages);
        const overwrite = rejectImplicitOverwrite(input, selected, messages);
        return {
            key: fileName,
            item: selected,
            messages,
            matchReason: "selected" as const,
            requiresItemSelection: duplicate,
            requiresOverwriteConfirmation: overwrite,
        };
    }
    const stemMatches = input.items.filter(
        (item) =>
            item.sourceName && fileStem(item.sourceName) === fileStem(fileName),
    );
    if (stemMatches.length === 1) {
        const duplicate = rejectDuplicateItem(input, stemMatches[0]!, messages);
        const overwrite = rejectImplicitOverwrite(
            input,
            stemMatches[0]!,
            messages,
        );
        return {
            key: fileName,
            item: stemMatches[0],
            messages,
            matchReason: "filename_stem" as const,
            requiresItemSelection: duplicate,
            requiresOverwriteConfirmation: overwrite,
        };
    }
    const unlabeled = input.items.filter((item) => !item.hasLabel);
    if (unlabeled.length === 1) {
        const duplicate = rejectDuplicateItem(input, unlabeled[0]!, messages);
        return {
            key: fileName,
            item: unlabeled[0],
            messages,
            matchReason: "only_unlabeled" as const,
            requiresItemSelection: duplicate,
        };
    }
    messages.push(`Choose the audio item for ${fileName}.`);
    return {
        key: fileName,
        item: undefined,
        messages,
        requiresItemSelection: true,
    };
}

function rejectImplicitOverwrite(
    input: Parameters<typeof previewMappedRow>[0],
    item: IAnswerImportItem,
    messages: string[],
): boolean {
    if (item.hasLabel && !input.allowOverwrite) {
        messages.push(
            `${item.sourceName ?? "This audio item"} already has a golden answer. Confirm replacement to continue.`,
        );
        return true;
    }
    return false;
}

function rejectDuplicateItem(
    input: Parameters<typeof previewMappedRow>[0],
    item: IAnswerImportItem,
    messages: string[],
): boolean {
    if (input.matchedItems.has(item.itemId)) {
        messages.push("This item was already matched by an earlier row.");
        return true;
    }
    return false;
}

export function proposeAnswerMapping(
    fields: ObservedAnswerField[],
): IAnswerImportMapping {
    let hasSpeakerTurns = false;
    return Object.fromEntries(
        fields.map((field) => {
            if (field.derivedFrom) {
                return [field.name, "expectedTranscript"];
            }
            if (field.shape === "speaker_turn_transcript") {
                if (hasSpeakerTurns) return [field.name, "ignore"];
                hasSpeakerTurns = true;
                return [field.name, "expectedSpeakerTurns"];
            }
            const normalized = normalizeFieldName(field.name);
            const target = Object.entries(TARGET_ALIASES).find(([, aliases]) =>
                aliases.includes(normalized),
            )?.[0] as AnswerImportTargetField | undefined;
            return [field.name, target ?? "ignore"];
        }),
    );
}

export function applyAnswerMapping(
    row: Record<string, unknown>,
    mapping: IAnswerImportMapping,
    preserveKeyFields = false,
    fields: ObservedAnswerField[] = [],
): LabelJson {
    const label: LabelJson = {};
    for (const [source, target] of Object.entries(mapping)) {
        if (target === "ignore") continue;
        const derivedFrom = fields.find(
            (field) => field.name === source,
        )?.derivedFrom;
        if (derivedFrom) {
            const transcript = transcriptFromTurns(row[derivedFrom]);
            if (transcript) label[target] = transcript;
            continue;
        }
        const value = row[source];
        if (value === undefined) continue;
        if (target === "expectedSpeakerTurns") {
            label[target] = normalizeSpeakerTurns(value) ?? value;
        } else if (target === "expectedTranscript") {
            label[target] = transcriptFromTurns(value) ?? value;
        } else {
            label[target] = value;
        }
    }
    const preservedMetadata = Object.fromEntries(
        Object.entries(row).filter(([source]) => {
            const target = mapping[source];
            return (
                (target === "ignore" || target === undefined) &&
                (preserveKeyFields ||
                    !KEY_ALIASES.includes(normalizeFieldName(source))) &&
                normalizeFieldName(source) !== "sourcemetadata"
            );
        }),
    );
    const sourceMetadata = isRecord(row.sourceMetadata)
        ? { ...row.sourceMetadata, ...preservedMetadata }
        : preservedMetadata;
    return Object.keys(sourceMetadata).length > 0
        ? { ...label, sourceMetadata }
        : label;
}

function parseAnswerRows(
    content: string,
    options: {
        file: IAnswerImportFile;
        items: IAnswerImportItem[];
    },
): {
    rows: IParsedAnswerRow[];
    errors: IParsedAnswerError[];
} {
    const trimmed = content.trim();
    if (!trimmed) {
        return {
            rows: [],
            errors: [{ row: 1, message: "Answers file is empty." }],
        };
    }
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        try {
            const parsed = JSON.parse(trimmed) as unknown;
            if (Array.isArray(parsed)) {
                return withFileMetadata(
                    normalizeRowsWithLimit(parsed),
                    options.file.fileName,
                    "keyed_map",
                );
            }
            if (!isRecord(parsed)) {
                return {
                    rows: [],
                    errors: [
                        {
                            row: 1,
                            message:
                                "Top-level JSON must be an array or object.",
                        },
                    ],
                };
            }
            const interpretation =
                options.file.interpretation ??
                classifyTopLevelObject(parsed, options.items);
            if (interpretation !== "keyed_map") {
                return normalizeSingleRecord(
                    parsed,
                    options.file,
                    interpretation === "ambiguous",
                );
            }
            const rows = Object.entries(parsed).map(([key, value]) =>
                isRecord(value) ? { key, ...value } : { key, value },
            );
            return withFileMetadata(
                normalizeRowsWithLimit(rows),
                options.file.fileName,
                "keyed_map",
            );
        } catch (error) {
            if (/\r?\n/.test(trimmed)) {
                return withFileMetadata(
                    parseJsonLines(trimmed),
                    options.file.fileName,
                    "keyed_map",
                );
            }
            return {
                rows: [],
                errors: [
                    {
                        row: 1,
                        message: `Invalid JSON: ${error instanceof Error ? error.message : "parse failed"}`,
                    },
                ],
            };
        }
    }
    return withFileMetadata(
        parseJsonLines(trimmed),
        options.file.fileName,
        "keyed_map",
    );
}

function withFileMetadata(
    parsed: { rows: IParsedAnswerRow[]; errors: IParsedAnswerError[] },
    fileName: string,
    interpretation: AnswerImportInterpretation,
) {
    return {
        ...parsed,
        rows: parsed.rows.map((row) => ({
            ...row,
            fileName,
            interpretation,
        })),
    };
}

function normalizeSingleRecord(
    value: Record<string, unknown>,
    file: IAnswerImportFile,
    interpretationAmbiguous: boolean,
): { rows: IParsedAnswerRow[]; errors: IParsedAnswerError[] } {
    return {
        rows: [
            {
                row: 1,
                value: normalizedRowValue(value),
                fileName: file.fileName,
                interpretation: "single_record",
                interpretationAmbiguous,
                ...(file.itemId ? { requestedItemId: file.itemId } : {}),
                ...(file.allowOverwrite ? { allowOverwrite: true } : {}),
            },
        ],
        errors: [],
    };
}

function classifyTopLevelObject(
    value: Record<string, unknown>,
    items: IAnswerImportItem[],
): AnswerImportInterpretation | "ambiguous" {
    const entries = Object.entries(value);
    const knownAnswerFields = entries.filter(([key]) =>
        SINGLE_RECORD_ALIASES.has(normalizeFieldName(key)),
    ).length;
    const itemKeys = itemKeyIndex(items);
    const itemStems = new Set(
        items.flatMap((item) =>
            item.sourceName ? [fileStem(item.sourceName)] : [],
        ),
    );
    const keysMatchingItems = entries.filter(
        ([key]) => itemKeys.items.has(key) || itemStems.has(fileStem(key)),
    ).length;
    const recordValues = entries.filter(([, item]) => isRecord(item)).length;
    const scalarValues = entries.length - recordValues;
    if (knownAnswerFields > 0 && keysMatchingItems === 0) {
        return "single_record";
    }
    if (recordValues === entries.length || keysMatchingItems > 0) {
        return "keyed_map";
    }
    if (scalarValues >= recordValues && keysMatchingItems === 0) {
        return "single_record";
    }
    return "ambiguous";
}

function parseJsonLines(trimmed: string): {
    rows: IParsedAnswerRow[];
    errors: IParsedAnswerError[];
} {
    const lines = trimmed.split(/\r?\n/);
    if (lines.length > MAX_ANSWER_IMPORT_ROWS) {
        return {
            rows: [],
            errors: [
                {
                    row: 1,
                    message: `Answer import is limited to ${MAX_ANSWER_IMPORT_ROWS} rows.`,
                },
            ],
        };
    }
    const rows: IParsedAnswerRow[] = [];
    const errors: IParsedAnswerError[] = [];
    lines.forEach((line, index) => {
        try {
            const parsed = JSON.parse(line) as unknown;
            if (!isRecord(parsed)) {
                errors.push({
                    row: index + 1,
                    message: `row ${index + 1}: must be a JSON object.`,
                });
            } else {
                rows.push({
                    row: index + 1,
                    value: normalizedRowValue(parsed),
                });
            }
        } catch (error) {
            errors.push({
                row: index + 1,
                message: `row ${index + 1}: invalid JSON: ${error instanceof Error ? error.message : "parse failed"}`,
            });
        }
    });
    return { rows, errors };
}

function normalizeRowsWithLimit(values: unknown[]) {
    return values.length > MAX_ANSWER_IMPORT_ROWS
        ? {
              rows: [],
              errors: [
                  {
                      row: 1,
                      message: `Answer import is limited to ${MAX_ANSWER_IMPORT_ROWS} rows.`,
                  },
              ],
          }
        : normalizeRows(values);
}

function normalizeRows(values: unknown[]): {
    rows: IParsedAnswerRow[];
    errors: IParsedAnswerError[];
} {
    const rows: IParsedAnswerRow[] = [];
    const errors: IParsedAnswerError[] = [];
    values.forEach((value, index) => {
        if (isRecord(value)) {
            rows.push({
                row: index + 1,
                value: normalizedRowValue(value),
            });
        } else {
            errors.push({
                row: index + 1,
                message: `row ${index + 1}: must be a JSON object.`,
            });
        }
    });
    return { rows, errors };
}

function normalizedRowValue(
    value: Record<string, unknown>,
): Record<string, unknown> {
    const { label, ...outer } = value;
    return isRecord(label) ? { ...outer, ...label } : value;
}

function observedFields(rows: IParsedAnswerRow[]): ObservedAnswerField[] {
    const samples = new Map<string, unknown[]>();
    for (const { value } of rows) {
        for (const [key, sample] of Object.entries(value)) {
            if (KEY_ALIASES.includes(normalizeFieldName(key))) continue;
            const values = samples.get(key) ?? [];
            values.push(sample);
            samples.set(key, values);
        }
    }
    const fields: ObservedAnswerField[] = [...samples].map(([name, values]) => {
        const hasTurns = values.some(isSpeakerTurnTranscript);
        const hasStrings = values.some((value) => typeof value === "string");
        return {
            name,
            sample: values[0],
            ...(values.every(isSpeakerTurnTranscript)
                ? { shape: "speaker_turn_transcript" as const }
                : hasTurns && hasStrings
                  ? { shape: "mixed_transcript" as const }
                  : {}),
        };
    });
    const turnsField = fields.find(
        (field) => field.shape === "speaker_turn_transcript",
    );
    return turnsField
        ? [
              ...fields,
              {
                  name: uniqueDerivedFieldName(fields),
                  sample: transcriptFromTurns(turnsField.sample),
                  derivedFrom: turnsField.name,
              },
          ]
        : fields;
}

function uniqueDerivedFieldName(fields: ObservedAnswerField[]): string {
    const names = new Set(fields.map((field) => field.name));
    let name = DERIVED_TRANSCRIPT_FIELD;
    while (names.has(name)) name = `_${name}`;
    return name;
}

function answerRowKey(row: Record<string, unknown>): string | undefined {
    for (const [field, value] of Object.entries(row)) {
        if (
            KEY_ALIASES.includes(normalizeFieldName(field)) &&
            typeof value === "string" &&
            value.trim()
        ) {
            return value.trim();
        }
    }
    return undefined;
}

function itemKeyIndex(items: IAnswerImportItem[]) {
    const index = new Map<
        string,
        { item: IAnswerImportItem; priority: number }
    >();
    const ambiguous = new Set<string>();
    for (const item of items) {
        [item.itemId, item.inputText, item.sourceName].forEach(
            (key, position) => {
                if (!key?.trim()) return;
                const normalized = key.trim();
                const priority = 3 - position;
                const existing = index.get(normalized);
                if (!existing || priority > existing.priority) {
                    index.set(normalized, { item, priority });
                    ambiguous.delete(normalized);
                } else if (
                    priority === existing.priority &&
                    existing.item.itemId !== item.itemId
                ) {
                    ambiguous.add(normalized);
                    index.delete(normalized);
                }
            },
        );
    }
    return {
        items: new Map([...index].map(([key, value]) => [key, value.item])),
        ambiguous,
    };
}

function validateMapping(
    mapping: IAnswerImportMapping,
    fields: ObservedAnswerField[],
): string[] {
    const errors: string[] = [];
    const knownFields = new Set(fields.map((field) => field.name));
    const claimedTargets = new Set<AnswerImportTargetField>();
    for (const [source, target] of Object.entries(mapping)) {
        if (!knownFields.has(source)) {
            errors.push(`Mapped source field "${source}" was not found.`);
        }
        if (
            fields.find((field) => field.name === source)?.shape ===
            "mixed_transcript"
        ) {
            errors.push(
                `Field "${source}" contains mixed string and speaker-turn array values; accepted batches use one transcript shape per field. Split the batch before importing.`,
            );
        }
        if (!ANSWER_TARGETS.has(target)) {
            errors.push(`Mapped target "${String(target)}" is not supported.`);
            continue;
        }
        if (target !== "ignore" && claimedTargets.has(target)) {
            errors.push(`Multiple source fields map to "${target}".`);
        }
        claimedTargets.add(target);
    }
    if ([...claimedTargets].every((target) => target === "ignore")) {
        errors.push("Map at least one answer field before importing.");
    }
    return errors;
}

function validateMappedLabel(label: LabelJson, row: number): string[] {
    return [
        ...validateStringFields(label, row),
        ...validateReferenceKind(label.referenceKind, row),
        ...validateSpeakerTurns(label.expectedSpeakerTurns, row),
        ...validateReferenceArrays(label, row),
        ...validateReferenceNumbers(label, row),
    ];
}

function validateStringFields(label: LabelJson, row: number): string[] {
    const messages: string[] = [];
    for (const field of [
        "expectedTranscript",
        "expectedTranscriptLatin",
        "expectedLanguage",
    ] as const) {
        if (label[field] !== undefined && typeof label[field] !== "string") {
            const acceptedShape =
                field === "expectedTranscript"
                    ? "a string or a speaker-turn transcript array"
                    : "a string";
            messages.push(
                `row ${row}: ${field} must be ${acceptedShape}; found ${valueShape(label[field])}; accepted shapes are ${acceptedShape}.`,
            );
        }
    }
    return messages;
}

function validateReferenceKind(value: unknown, row: number): string[] {
    if (value === undefined) return [];
    const allowed = ["human_gold", "silver", "prod_reference"];
    return typeof value === "string" && allowed.includes(value)
        ? []
        : [
              `row ${row}: referenceKind must be one of human_gold, silver, or prod_reference.`,
          ];
}

function validateReferenceArrays(label: LabelJson, row: number): string[] {
    const messages: string[] = [];
    if (
        label.domainTerms !== undefined &&
        (!Array.isArray(label.domainTerms) ||
            label.domainTerms.length === 0 ||
            label.domainTerms.some(
                (term) => typeof term !== "string" || !term.trim(),
            ))
    ) {
        messages.push(
            `row ${row}: domainTerms must be an array of non-empty strings.`,
        );
    }
    if (
        label.expectedNumbers !== undefined &&
        (!Array.isArray(label.expectedNumbers) ||
            label.expectedNumbers.length === 0 ||
            label.expectedNumbers.some(
                (number) =>
                    typeof number !== "number" || !Number.isFinite(number),
            ))
    ) {
        messages.push(`row ${row}: expectedNumbers must be finite numbers.`);
    }
    return messages;
}

function validateReferenceNumbers(label: LabelJson, row: number): string[] {
    const messages: string[] = [];
    for (const field of ["latencySlaMs", "costOutlierUsd"] as const) {
        const value = label[field];
        if (
            value !== undefined &&
            (typeof value !== "number" || !Number.isFinite(value))
        ) {
            messages.push(`row ${row}: ${field} must be a finite number.`);
        }
    }
    return messages;
}

function validateSpeakerTurns(value: unknown, row: number): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        return [
            `row ${row}: expectedSpeakerTurns found ${valueShape(value)}; accepted shape is an array of speaker turns with text/content and optional speaker/timing fields.`,
        ];
    }
    if (value.length === 0) {
        return [
            `row ${row}: expectedSpeakerTurns found an empty array; accepted shape is a non-empty array of speaker turns with text/content and optional speaker/timing fields.`,
        ];
    }
    const errors: string[] = [];
    value.forEach((turn, index) => {
        if (!isRecord(turn)) {
            errors.push(
                `row ${row}: expectedSpeakerTurns[${index}] found ${valueShape(turn)}; accepted shape is an object with text/content and optional speaker/timing fields.`,
            );
            return;
        }
        for (const field of ["speaker", "text"] as const) {
            if (typeof turn[field] !== "string" || !turn[field].trim()) {
                errors.push(
                    `row ${row}: expectedSpeakerTurns[${index}].${field} found ${valueShape(turn[field])}; accepted shape is a non-empty string.`,
                );
            }
        }
        for (const field of ["startMs", "endMs"] as const) {
            const item = turn[field];
            if (
                item !== undefined &&
                (typeof item !== "number" || !Number.isFinite(item))
            ) {
                errors.push(
                    `row ${row}: expectedSpeakerTurns[${index}].${field} found ${valueShape(item)}; accepted shape is a finite number.`,
                );
            }
        }
    });
    return errors;
}

function closestItemName(
    key: string,
    items: IAnswerImportItem[],
): string | undefined {
    const stem = fileStem(key);
    return items
        .map((item) => item.sourceName)
        .find((name): name is string =>
            Boolean(name && fileStem(name) === stem),
        );
}

function fileStem(value: string): string {
    return value.toLowerCase().replace(/\.[^.]+$/, "");
}

function normalizeFieldName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
