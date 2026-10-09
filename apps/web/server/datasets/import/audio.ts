import { addAudioItem } from "../service";
import { validateAudioReferenceLabel } from "../../audio/reference";
import {
    MAX_AUDIO_IMPORT_BYTES,
    audioFileFailure,
    importFailureReason,
    partitionMediaImportFiles,
    type IAudioImportFile,
    type IImportSummary,
} from "./shared";
import { prepareGoldenAnswersByKey } from "./goldenAnswers";

export interface IAudioImportPartition {
    summary: IImportSummary;
    uniqueValidNames: string[];
    duplicateNames: Set<string>;
}

export function partitionAudioImportFiles(
    files: IAudioImportFile[],
): IAudioImportPartition {
    return partitionMediaImportFiles(files, {
        mediaLabel: "Audio",
        maxTotalBytes: MAX_AUDIO_IMPORT_BYTES,
        fileFailure: audioFileFailure,
    });
}

export function validateAudioImportFiles(
    files: IAudioImportFile[],
): IImportSummary {
    return partitionAudioImportFiles(files).summary;
}

export async function importAudioItems(
    datasetId: string,
    files: IAudioImportFile[],
): Promise<IImportSummary> {
    const validation = validateAudioImportFiles(files);
    if (validation.rejected) return validation;

    let importedCount = 0;
    const failures = [...validation.failures];
    const seenValidNames = new Set<string>();
    for (const file of files) {
        if (audioFileFailure(file)) continue;
        if (seenValidNames.has(file.name)) continue;
        seenValidNames.add(file.name);
        try {
            const bytes = Buffer.from(await file.arrayBuffer());
            await addAudioItem(datasetId, bytes, file.type, undefined, undefined, file.name);
            importedCount++;
        } catch (err) {
            failures.push({
                fileName: file.name,
                reason: importFailureReason(err),
            });
        }
    }

    return { importedCount, failures };
}

export async function importFreeformAudioAnswerItems(
    datasetId: string,
    files: IAudioImportFile[],
    answersContent: string,
): Promise<IImportSummary> {
    const partition = partitionAudioImportFiles(files);
    if (partition.summary.rejected) return partition.summary;

    const plan = prepareGoldenAnswersByKey(
        partition.uniqueValidNames,
        answersContent,
        "filename",
        "audio",
    );
    if (plan.rejected) {
        return { importedCount: 0, failures: plan.failures, rejected: true };
    }

    const fileByName = new Map(files.map((file) => [file.name, file]));
    const failures = [...partition.summary.failures, ...plan.failures];
    let importedCount = 0;

    for (const item of plan.pairs) {
        const labelFailures = validateAudioReferenceLabel(item.label);
        if (labelFailures.length > 0) {
            failures.push({
                fileName: item.key,
                reason: labelFailures.join("; "),
            });
            continue;
        }
        const file = fileByName.get(item.key);
        if (!file) continue;
        try {
            const bytes = Buffer.from(await file.arrayBuffer());
            await addAudioItem(
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
