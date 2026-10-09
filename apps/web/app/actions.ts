"use server";

import * as datasetActions from "./actions/datasets";
import * as promptActions from "./actions/prompts";
import * as runActions from "./actions/runs";
import * as workflowActions from "./actions/workflows";
import * as sttEvalActions from "./actions/stt-evals";
import { createWorkflowLlmRouteForNode as createWorkflowLlmRoute } from "./actions/settings";
import { loadWorkflowLlmRouteCandidatesAction } from "./actions/settings";
import { actionErrorState } from "./actions/shared";
import { revalidatePath } from "next/cache";
import { requireActiveProject } from "@/server/projects/activeProject";
import type { ReviewVerdict } from "@mosaic/api-contract";
import { serverApiClient } from "@/server/api/client";
import type {
    IActionState,
    IGenerateSchemaActionState,
    IPromptJudgeTestActionState,
    IPromptTestRunActionState,
    IPromptWorkbenchState,
} from "./actions/types";

export type {
    IActionState,
    IPromptWorkbenchState,
    IPromptTestRunActionState,
    IGenerateSchemaActionState,
    IPromptJudgeTestActionState,
} from "./actions/types";

export async function deleteWorkflowAction(
    formData: FormData,
): Promise<IActionState> {
    return workflowActions.deleteWorkflowAction(formData);
}

export const createSttEvalAction = sttEvalActions.createSttEvalAction;
export const saveSttEvalAction = sttEvalActions.saveSttEvalAction;
export const createSttEvalRunAction = sttEvalActions.createSttEvalRunAction;
export async function createWorkflowLlmRouteForNode(
    input: Parameters<typeof createWorkflowLlmRoute>[0],
): Promise<Awaited<ReturnType<typeof createWorkflowLlmRoute>>> {
    return createWorkflowLlmRoute(input);
}

export async function loadWorkflowLlmModelsForNode(
    transport: "openai" | "gateway" | "openrouter" | "bifrost",
) {
    const principal = await requireActiveProject();
    const result = await loadWorkflowLlmRouteCandidatesAction(
        principal.projectId,
        transport,
    );
    return {
        candidates: result.result?.candidates,
        error: result.error,
    };
}

export async function createDatasetAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.createDatasetAction(prevState, formData);
}

export async function createDatasetForInputAction(formData: FormData) {
    return datasetActions.createDatasetForInputAction(formData);
}

export async function addItemAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.addItemAction(prevState, formData);
}

export async function editItemAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.editItemAction(prevState, formData);
}

export async function deleteItemAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.deleteItemAction(prevState, formData);
}

export async function archiveDatasetAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.archiveDatasetAction(prevState, formData);
}

export async function restoreDatasetAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.restoreDatasetAction(prevState, formData);
}

export async function duplicateDatasetAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.duplicateDatasetAction(prevState, formData);
}

export async function deleteDatasetAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.deleteDatasetAction(prevState, formData);
}

export async function updateDatasetDescriptionAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.updateDatasetDescriptionAction(prevState, formData);
}

export async function updateDatasetNameAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.updateDatasetNameAction(prevState, formData);
}

export async function deleteLabelAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.deleteLabelAction(prevState, formData);
}

export async function importImagesAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.importImagesAction(prevState, formData);
}

export async function importAudioAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.importAudioAction(prevState, formData);
}

export async function importImageAnswersAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.importImageAnswersAction(prevState, formData);
}

export async function importAudioAnswersAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.importAudioAnswersAction(prevState, formData);
}

export async function importTextItemsAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.importTextItemsAction(prevState, formData);
}

export async function importGoldenAnswersAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.importGoldenAnswersAction(prevState, formData);
}

export async function previewGoldenAnswersAction(formData: FormData) {
    return datasetActions.previewGoldenAnswersAction(formData);
}

export async function commitGoldenAnswersAction(formData: FormData) {
    return datasetActions.commitGoldenAnswersAction(formData);
}

export async function importPairedItemsAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return datasetActions.importPairedItemsAction(prevState, formData);
}

export async function createPromptAction(formData: FormData) {
    return promptActions.createPromptAction(formData);
}

export async function addPromptVersionAction(formData: FormData) {
    return promptActions.addPromptVersionAction(formData);
}

export async function optimizePromptAction(
    prevState: IPromptWorkbenchState,
    formData: FormData,
): Promise<IPromptWorkbenchState> {
    return promptActions.optimizePromptAction(prevState, formData);
}

export async function testPromptDraftAction(
    formData: FormData,
): Promise<IPromptTestRunActionState> {
    return promptActions.testPromptDraftAction(formData);
}

export async function generateSchemaFromPromptAction(
    formData: FormData,
): Promise<IGenerateSchemaActionState> {
    return promptActions.generateSchemaFromPromptAction(formData);
}

export async function testJudgeDraftAction(
    formData: FormData,
): Promise<IPromptJudgeTestActionState> {
    return promptActions.testJudgeDraftAction(formData);
}

export async function saveRunnablePromptAction(
    prevState: IPromptWorkbenchState,
    formData: FormData,
): Promise<IPromptWorkbenchState> {
    return promptActions.saveRunnablePromptAction(prevState, formData);
}

export async function duplicatePromptVersionAction(formData: FormData) {
    return promptActions.duplicatePromptVersionAction(formData);
}

export async function deletePromptAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return promptActions.deletePromptAction(prevState, formData);
}

export async function createJudgeAction(formData: FormData) {
    return promptActions.createJudgeAction(formData);
}

export async function createRunAction(
    stateOrFormData: IActionState | FormData,
    submittedFormData?: FormData,
): Promise<IActionState> {
    return runActions.createRunAction(stateOrFormData, submittedFormData);
}

export async function retryRunAction(
    prevState: IActionState,
    formData: FormData,
) {
    return runActions.retryRunAction(prevState, formData);
}

export async function deleteRunAction(
    prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    return runActions.deleteRunAction(prevState, formData);
}

export async function generateJudgeForRunAction(
    promptVersionId: string,
    datasetId: string,
) {
    return runActions.generateJudgeForRunAction(promptVersionId, datasetId);
}

const REVIEW_VERDICTS = new Set<string>([
    "unreviewed",
    "approved",
    "needs_review",
    "issue",
]);

function isReviewVerdict(value: string): value is ReviewVerdict {
    return REVIEW_VERDICTS.has(value);
}

export async function saveRunNoteAction(
    _prevState: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const p = await requireActiveProject();
    const runId = String(formData.get("runId") || "");
    const body = String(formData.get("body") || "").trim();
    try {
        await serverApiClient().saveRunNote({
            teamId: p.teamId,
            projectId: p.projectId,
            runId,
            body,
            updatedBy: p.userId,
        });
    } catch (err) {
        return actionErrorState(err);
    }
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
}

/**
 * Called directly (quick review, "Save and next") as well as from forms, so it
 * takes FormData only and reports failure in the result instead of throwing.
 */
export async function saveCellAnnotationAction(
    formData: FormData,
): Promise<IActionState> {
    const p = await requireActiveProject();
    const runCellId = String(formData.get("runCellId") || "");
    const verdict = String(formData.get("verdict") || "unreviewed");
    const comment = String(formData.get("comment") || "").trim();
    if (!isReviewVerdict(verdict)) {
        return { formError: "Choose a valid review status." };
    }
    let runId: string;
    try {
        const row = await serverApiClient().saveCellAnnotation({
            teamId: p.teamId,
            projectId: p.projectId,
            runCellId,
            verdict,
            comment,
            updatedBy: p.userId,
        });
        runId = row.runId;
    } catch (err) {
        return actionErrorState(err);
    }
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
}
