"use client";

import type { AudioRunMode } from "@mosaic/api-contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";

interface IAudioRunModeSelectorProps {
    audioRunMode: AudioRunMode;
    onAudioRunModeChange: (mode: AudioRunMode) => void;
    step: string;
    sttMetricsDescription: string;
    promptEvalDescription: string;
}

export function AudioRunModeSelector({
    audioRunMode,
    onAudioRunModeChange,
    step,
    sttMetricsDescription,
    promptEvalDescription,
}: IAudioRunModeSelectorProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle as="h2">
                    <span className="text-muted-foreground">{step}</span>{" "}
                    Evaluation mode
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                <RadioGroup
                    aria-label="Evaluation mode"
                    value={audioRunMode}
                    onValueChange={(value) =>
                        onAudioRunModeChange(value as AudioRunMode)
                    }
                    className="gap-2 sm:grid-cols-2"
                >
                    <RadioCard
                        value="stt_metrics"
                        title="STT metrics only"
                        description={sttMetricsDescription}
                        className="p-3"
                    />
                    <RadioCard
                        value="prompt_eval"
                        title="STT + prompt eval"
                        description={promptEvalDescription}
                        className="p-3"
                    />
                </RadioGroup>
            </CardContent>
        </Card>
    );
}
