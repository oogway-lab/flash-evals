"use client";

import type {
    AudioRunMode,
    IPipelineFieldConfig,
    IReasoningConfig,
    IRunBenchmarkConfig,
    ITemperatureAssignment,
    ITransportAssignment,
} from "@flash-evals/api-contract";

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
    temperatureAssignments = [],
    transportAssignments,
    models,
    sourceRunId,
    benchmark,
}: {
    fieldConfigs: IPipelineFieldConfig[];
    audioRunMode: AudioRunMode;
    promptAssignments: IPromptAssignment[];
    reasoningConfigs: IReasoningAssignment[];
    /** Models not listed run at the provider's default temperature. */
    temperatureAssignments?: ITemperatureAssignment[];
    transportAssignments: ITransportAssignment[];
    models: string[];
    sourceRunId?: string;
    /** Benchmark settings; absent when the run is not compared with one. */
    benchmark?: IRunBenchmarkConfig;
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
            {temperatureAssignments.length > 0 && (
                <input
                    type="hidden"
                    name="temperatureAssignments"
                    value={JSON.stringify(temperatureAssignments)}
                />
            )}
            <input
                type="hidden"
                name="transportAssignments"
                value={JSON.stringify(transportAssignments)}
            />
            <input type="hidden" name="models" value={models.join("\n")} />
            {benchmark && (
                <input
                    type="hidden"
                    name="benchmark"
                    value={JSON.stringify(benchmark)}
                />
            )}
            {sourceRunId && (
                <input type="hidden" name="sourceRunId" value={sourceRunId} />
            )}
        </>
    );
}
