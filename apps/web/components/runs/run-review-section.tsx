"use client";

import type {
    IRunSetupDatasetOption,
    IRunSetupSttModelOption,
} from "@flash-evals/api-contract";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunSubmitButton } from "./run-submit-button";
import { SpendLimitField } from "./spend-limit-field";
import { VOLUME_LEVELLED_LABEL } from "./stt-variant-display";

export function RunReviewSection({
    selectedDataset,
    selectedSttModel,
    sttVolumeLevelled = false,
    usesPromptEval,
    evaluationModelCount,
    canSubmit,
    formError,
    fieldErrors,
}: {
    selectedDataset: IRunSetupDatasetOption | undefined;
    selectedSttModel: IRunSetupSttModelOption | undefined;
    /** The single STT model under test (prompt eval) levels volume first. */
    sttVolumeLevelled?: boolean;
    usesPromptEval: boolean;
    evaluationModelCount: number;
    canSubmit: boolean;
    formError?: string;
    fieldErrors?: Record<string, string[] | undefined>;
}) {
    const isAudio = selectedDataset?.modality === "audio";
    const cellCount =
        (selectedDataset?.itemCount ?? 0) * Math.max(evaluationModelCount, 0);
    const modelKind = !isAudio
        ? "models"
        : usesPromptEval
          ? "transcript consumer models"
          : "STT model";

    return (
        <Card>
            <CardHeader>
                <CardTitle as="h2">
                    <span className="text-muted-foreground">
                        {isAudio ? "4." : "6."}
                    </span>{" "}
                    Review
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {isAudio && selectedSttModel && (
                    <p className="text-copy-14 text-on-surface">
                        STT model under test:{" "}
                        <span className="text-label-14">
                            {selectedSttModel.label}
                        </span>
                        {usesPromptEval && sttVolumeLevelled && (
                            <span className="text-muted-foreground">
                                {" "}
                                · {VOLUME_LEVELLED_LABEL}
                            </span>
                        )}
                    </p>
                )}
                <p className="text-copy-14 text-on-surface">
                    <span className="text-label-14">{cellCount}</span> cells
                    will be evaluated ({selectedDataset?.itemCount ?? 0} items ×{" "}
                    {evaluationModelCount} {modelKind}).
                </p>
                <SpendLimitField error={fieldErrors?.maxCostUsd?.[0]} />
                <p className="text-copy-14 text-muted-foreground">
                    Runs in the background. You&apos;ll be redirected to live
                    progress on the run page.
                </p>
                {formError && (
                    <Alert variant="destructive">
                        <AlertDescription>{formError}</AlertDescription>
                    </Alert>
                )}
                <RunSubmitButton disabled={!canSubmit} />
            </CardContent>
        </Card>
    );
}
