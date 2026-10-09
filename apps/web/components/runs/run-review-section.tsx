"use client";

import type {
    IRunSetupDatasetOption,
    IRunSetupSttModelOption,
} from "@mosaic/api-contract";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunSubmitButton } from "./run-submit-button";

export function RunReviewSection({
    selectedDataset,
    selectedSttModel,
    usesPromptEval,
    evaluationModelCount,
    canSubmit,
    formError,
}: {
    selectedDataset: IRunSetupDatasetOption | undefined;
    selectedSttModel: IRunSetupSttModelOption | undefined;
    usesPromptEval: boolean;
    evaluationModelCount: number;
    canSubmit: boolean;
    formError?: string;
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
                        {isAudio ? "4." : "5."}
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
                    </p>
                )}
                <p className="text-copy-14 text-on-surface">
                    <span className="text-label-14">{cellCount}</span> cells
                    will be evaluated ({selectedDataset?.itemCount ?? 0} items ×{" "}
                    {evaluationModelCount} {modelKind}).
                </p>
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
