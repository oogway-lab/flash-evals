"use client";

import type {
    AudioRunMode,
    IPipelineFieldConfig,
    IReasoningConfig,
    ITransportAssignment,
} from "@mosaic/api-contract";

interface IPromptAssignment {
    modelId: string;
    promptVersionId: string;
}

interface IReasoningAssignment {
    modelId: string;
    reasoningConfig: IReasoningConfig | undefined;
}

export function RunFormHiddenInputs({
    fieldConfigs,
    audioRunMode,
    promptAssignments,
    reasoningConfigs,
    transportAssignments,
    models,
    sourceRunId,
}: {
    fieldConfigs: IPipelineFieldConfig[];
    audioRunMode: AudioRunMode;
    promptAssignments: IPromptAssignment[];
    reasoningConfigs: IReasoningAssignment[];
    transportAssignments: ITransportAssignment[];
    models: string[];
    sourceRunId?: string;
}) {
    return (
        <>
            <input
                type="hidden"
                name="fieldConfigs"
                value={JSON.stringify(fieldConfigs)}
            />
            <input type="hidden" name="audioRunMode" value={audioRunMode} />
            <input
                type="hidden"
                name="promptAssignments"
                value={JSON.stringify(promptAssignments)}
            />
            <input
                type="hidden"
                name="reasoningConfigs"
                value={JSON.stringify(reasoningConfigs)}
            />
            <input
                type="hidden"
                name="transportAssignments"
                value={JSON.stringify(transportAssignments)}
            />
            <input type="hidden" name="models" value={models.join("\n")} />
            {sourceRunId && (
                <input type="hidden" name="sourceRunId" value={sourceRunId} />
            )}
        </>
    );
}
