import { isRecord } from "@/lib/objects";
import type { IMatrixCellScore } from "@mosaic/api-contract";
import type { IActionState } from "@/app/actions/types";
import type {
    FieldDiffDetails,
    FieldResult,
    IGenerativeFieldResult,
    IJudgeCriterion,
    IJudgeDetails,
    OutputJson,
} from "@/server/db/jsonTypes";

/** Saves a reviewer verdict/comment; failures come back as `formError`. */
export type SaveCellAnnotationAction = (
    formData: FormData,
) => Promise<IActionState>;

export interface ModelCol {
    id: string;
    modelId: string;
    isReference: boolean;
}

export interface ItemRow {
    id: string;
    type: string;
    inputText: string | null;
    storageKey: string | null;
    mimeType: string | null;
}

export interface CellData {
    id: string;
    datasetItemId: string;
    runModelId: string;
    status: "pending" | "running" | "succeeded" | "failed" | "cached";
    outputJson: OutputJson | null;
    latencyMs: number | null;
    costUsd: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
    annotation?: CellAnnotation;
    error: string | null;
}

export type ReviewVerdict =
    "unreviewed" | "approved" | "needs_review" | "issue";

export interface CellAnnotation {
    verdict: ReviewVerdict;
    comment: string;
    updatedAt: string | Date;
    updatedBy: string | null;
}

export interface DrawerPayload {
    cell: CellData;
    model: ModelCol;
    item: ItemRow;
    scores: IMatrixCellScore[];
}

function isFieldResult(v: unknown): v is FieldResult {
    if (!isRecord(v)) return false;
    return (
        typeof v.field === "string" &&
        typeof v.matcher === "string" &&
        typeof v.score === "number"
    );
}

function isGenerativeFieldResult(v: unknown): v is IGenerativeFieldResult {
    if (!isRecord(v)) return false;
    return (
        typeof v.field === "string" &&
        (v.score === null || typeof v.score === "number") &&
        typeof v.rationale === "string"
    );
}

export function toFieldDiffDetails(v: unknown): FieldDiffDetails | undefined {
    if (!isRecord(v) || !Array.isArray(v.fields)) return undefined;
    if (!v.fields.every(isFieldResult)) return undefined;
    return { fields: v.fields };
}

export function toJudgeDetails(v: unknown): IJudgeDetails | undefined {
    if (!isRecord(v) || !Array.isArray(v.fields)) return undefined;
    if (typeof v.errorCount !== "number") return undefined;
    if (!v.fields.every(isGenerativeFieldResult)) return undefined;
    return { fields: v.fields, errorCount: v.errorCount };
}

function isJudgeCriterion(v: unknown): v is IJudgeCriterion {
    return (
        isRecord(v) &&
        typeof v.name === "string" &&
        typeof v.score === "number" &&
        typeof v.reasoning === "string"
    );
}

export function toJudgeCriteria(v: unknown): IJudgeCriterion[] | undefined {
    if (!isRecord(v) || !Array.isArray(v.criteria)) return undefined;
    if (!v.criteria.every(isJudgeCriterion)) return undefined;
    return v.criteria.length > 0 ? v.criteria : undefined;
}

export interface TranscriptMetricDetails {
    metricKind?: "mechanical_stt";
    layer?: "stt";
    transcriptVariant?: "raw" | "latin";
    sttModelId?: string;
    providerId?: string;
    routeId?: string;
    configHash?: string;
    referenceField?: string;
    referenceKind?: string;
    wer: number;
    cer: number;
    fillerStrippedWer?: number;
    wordCounts: {
        substitutions: number;
        deletions: number;
        insertions: number;
        referenceLength: number;
    };
    characterCounts?: {
        substitutions: number;
        deletions: number;
        insertions: number;
        referenceLength: number;
    };
    domainTermRecall?: {
        matched: number;
        expected: number;
        recall: number;
        missed: string[];
    };
    numericAccuracy?: {
        matched: number;
        expected: number;
        accuracy: number;
        missed: number[];
    };
    hardFailures?: string[];
    diarization?: {
        speakerCountDelta: number;
        coverageRatio: number | null;
        der: number | null;
        falseAlarmRate?: number | null;
        missedDetectionRate?: number | null;
        speakerConfusionRate?: number | null;
        cpWer: number | null;
        perSpeakerWer?: Record<string, number> | null;
        /** Speaker-agnostic concatenated WER (not true ORC-WER). */
        concatenatedWer: number | null;
        config?: {
            derCollarMs?: number;
            derSkipOverlap?: boolean;
            sampleStepMs?: number;
        };
    };
}

export function toTranscriptMetricDetails(
    v: unknown,
): TranscriptMetricDetails | undefined {
    if (!isTranscriptMetricBase(v)) return undefined;
    return {
        metricKind:
            v.metricKind === "mechanical_stt" ? "mechanical_stt" : undefined,
        layer: v.layer === "stt" ? "stt" : undefined,
        transcriptVariant:
            v.transcriptVariant === "raw" || v.transcriptVariant === "latin"
                ? v.transcriptVariant
                : undefined,
        sttModelId: typeof v.sttModelId === "string" ? v.sttModelId : undefined,
        providerId: typeof v.providerId === "string" ? v.providerId : undefined,
        routeId: typeof v.routeId === "string" ? v.routeId : undefined,
        configHash: typeof v.configHash === "string" ? v.configHash : undefined,
        referenceField:
            typeof v.referenceField === "string" ? v.referenceField : undefined,
        referenceKind:
            typeof v.referenceKind === "string" ? v.referenceKind : undefined,
        wer: v.wer,
        cer: v.cer,
        fillerStrippedWer:
            typeof v.fillerStrippedWer === "number"
                ? v.fillerStrippedWer
                : undefined,
        wordCounts: v.wordCounts,
        characterCounts: isEditCounts(v.characterCounts)
            ? v.characterCounts
            : undefined,
        domainTermRecall: isDomainTermRecall(v.domainTermRecall)
            ? v.domainTermRecall
            : undefined,
        numericAccuracy: isNumericAccuracy(v.numericAccuracy)
            ? v.numericAccuracy
            : undefined,
        hardFailures: stringArray(v.hardFailures),
        diarization: parseDiarizationDetails(v.diarization),
    };
}

function isTranscriptMetricBase(
    value: unknown,
): value is Record<string, unknown> &
    Pick<TranscriptMetricDetails, "wer" | "cer" | "wordCounts"> {
    return (
        isRecord(value) &&
        typeof value.wer === "number" &&
        typeof value.cer === "number" &&
        isEditCounts(value.wordCounts)
    );
}

function parseDiarizationDetails(
    value: unknown,
): NonNullable<TranscriptMetricDetails["diarization"]> | undefined {
    if (!isDiarizationDetails(value)) return undefined;
    const concatenatedWer =
        value.concatenatedWer === null ||
        typeof value.concatenatedWer === "number"
            ? value.concatenatedWer
            : value.orcWer === null || typeof value.orcWer === "number"
              ? value.orcWer
              : null;
    return {
        speakerCountDelta: value.speakerCountDelta,
        coverageRatio: value.coverageRatio,
        der: value.der,
        ...(value.falseAlarmRate === null ||
        typeof value.falseAlarmRate === "number"
            ? { falseAlarmRate: value.falseAlarmRate }
            : {}),
        ...(value.missedDetectionRate === null ||
        typeof value.missedDetectionRate === "number"
            ? { missedDetectionRate: value.missedDetectionRate }
            : {}),
        ...(value.speakerConfusionRate === null ||
        typeof value.speakerConfusionRate === "number"
            ? { speakerConfusionRate: value.speakerConfusionRate }
            : {}),
        cpWer: value.cpWer,
        ...(optionalNumberRecord(value.perSpeakerWer)
            ? { perSpeakerWer: value.perSpeakerWer }
            : {}),
        concatenatedWer,
        ...(isRecord(value.config) ? { config: value.config } : {}),
    };
}

export interface TranscriptJudgeMetricDetails {
    metricKind?: "llm_judge";
    modelId: string;
    rubricPrompt: string;
    referenceKind?: string;
    criteria?: Array<{
        name: string;
        reasoning: string;
        score: number;
    }>;
    error?: string;
}

export function toTranscriptJudgeMetricDetails(
    value: unknown,
): TranscriptJudgeMetricDetails | undefined {
    if (
        !isRecord(value) ||
        (value.metricKind !== undefined && value.metricKind !== "llm_judge") ||
        typeof value.modelId !== "string" ||
        typeof value.rubricPrompt !== "string"
    ) {
        return undefined;
    }
    return {
        metricKind: value.metricKind === "llm_judge" ? "llm_judge" : undefined,
        modelId: value.modelId,
        rubricPrompt: value.rubricPrompt,
        referenceKind:
            typeof value.referenceKind === "string"
                ? value.referenceKind
                : undefined,
        criteria:
            Array.isArray(value.criteria) &&
            value.criteria.every(isJudgeCriterion)
                ? value.criteria
                : undefined,
        error: typeof value.error === "string" ? value.error : undefined,
    };
}

export function formatTranscriptReferenceKind(
    kind: string | undefined,
): string {
    if (kind === "human_gold") return "Human gold reference";
    if (kind === "silver") return "Agreement with silver reference";
    if (kind === "prod_reference") return "Agreement with production reference";
    return kind ?? "not provided";
}

function isEditCounts(
    value: unknown,
): value is TranscriptMetricDetails["wordCounts"] {
    return (
        isRecord(value) &&
        typeof value.substitutions === "number" &&
        typeof value.deletions === "number" &&
        typeof value.insertions === "number" &&
        typeof value.referenceLength === "number"
    );
}

function isDomainTermRecall(
    value: unknown,
): value is NonNullable<TranscriptMetricDetails["domainTermRecall"]> {
    return (
        isRecord(value) &&
        typeof value.matched === "number" &&
        typeof value.expected === "number" &&
        typeof value.recall === "number" &&
        Array.isArray(value.missed) &&
        value.missed.every((item) => typeof item === "string")
    );
}

function isNumericAccuracy(
    value: unknown,
): value is NonNullable<TranscriptMetricDetails["numericAccuracy"]> {
    return (
        isRecord(value) &&
        typeof value.matched === "number" &&
        typeof value.expected === "number" &&
        typeof value.accuracy === "number" &&
        Array.isArray(value.missed) &&
        value.missed.every((item) => typeof item === "number")
    );
}

function stringArray(value: unknown): string[] | undefined {
    return Array.isArray(value) &&
        value.every((item) => typeof item === "string")
        ? value
        : undefined;
}

interface IRawDiarizationDetails {
    speakerCountDelta: number;
    coverageRatio: number | null;
    der: number | null;
    falseAlarmRate?: number | null;
    missedDetectionRate?: number | null;
    speakerConfusionRate?: number | null;
    cpWer: number | null;
    perSpeakerWer?: Record<string, number> | null;
    concatenatedWer?: number | null;
    /** @deprecated legacy field name; mapped to concatenatedWer */
    orcWer?: number | null;
    config?: NonNullable<TranscriptMetricDetails["diarization"]>["config"];
}

function isDiarizationDetails(value: unknown): value is IRawDiarizationDetails {
    return (
        isRecord(value) &&
        typeof value.speakerCountDelta === "number" &&
        (value.coverageRatio === null ||
            typeof value.coverageRatio === "number") &&
        (value.der === null || typeof value.der === "number") &&
        optionalNullableNumber(value.falseAlarmRate) &&
        optionalNullableNumber(value.missedDetectionRate) &&
        optionalNullableNumber(value.speakerConfusionRate) &&
        (value.cpWer === null || typeof value.cpWer === "number") &&
        optionalNumberRecord(value.perSpeakerWer) &&
        // Accept legacy `orcWer` from stored metrics while preferring the
        // accurately named `concatenatedWer` field.
        (value.concatenatedWer === null ||
            typeof value.concatenatedWer === "number" ||
            value.orcWer === null ||
            typeof value.orcWer === "number") &&
        optionalDiarizationConfig(value.config)
    );
}

function optionalDiarizationConfig(value: unknown): boolean {
    return (
        value === undefined ||
        (isRecord(value) &&
            (value.derCollarMs === undefined ||
                typeof value.derCollarMs === "number") &&
            (value.derSkipOverlap === undefined ||
                typeof value.derSkipOverlap === "boolean") &&
            (value.sampleStepMs === undefined ||
                typeof value.sampleStepMs === "number"))
    );
}

function optionalNullableNumber(value: unknown): boolean {
    return value === undefined || value === null || typeof value === "number";
}

function optionalNumberRecord(value: unknown): boolean {
    return (
        value === undefined ||
        value === null ||
        (isRecord(value) &&
            Object.values(value).every((item) => typeof item === "number"))
    );
}
