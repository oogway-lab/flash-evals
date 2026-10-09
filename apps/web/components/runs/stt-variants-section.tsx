"use client";

import {
    sttModelSupportsLanguage,
    type ISttRunEvaluation,
} from "@mosaic/api-contract";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/layout/section-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    SttModelPicker,
    TranscriptJudgeSettings,
    TransliterationSettings,
    sttRunConfig,
} from "./audio-transcription-section";
import { SttConfigFields } from "./stt-config-fields";
import type { useAudioTranscriptionController } from "./use-audio-transcription-controller";
import type { useSttVariantsController } from "./use-stt-variants-controller";

type VariantsController = ReturnType<typeof useSttVariantsController>;
type AudioController = ReturnType<
    typeof useAudioTranscriptionController
>["audioTranscriptionProps"];

export function SttVariantsSection({
    controller,
    evaluation,
    fieldErrors,
}: {
    controller: VariantsController;
    evaluation: AudioController;
    fieldErrors?: Record<string, string[]>;
}) {
    const serializedVariants = controller.variants.flatMap((variant) => {
        const model = evaluation.sttModels.find(
            (candidate) => candidate.id === variant.modelId,
        );
        const config = sttRunConfig({
            model,
            modelId: variant.modelId,
            language: sttModelSupportsLanguage(variant.modelId)
                ? variant.language
                : "",
            config: variant.config,
            transliteration: {
                enabled: false,
                modelId: "",
                targetLanguage: "",
                prompt: "",
                temperature: "",
            },
            evaluator: {
                enabled: false,
                modelId: "",
                rubricPrompt: "",
                reasoningEffort: "default",
            },
        });
        return config
            ? [{ variantKey: variant.variantKey, label: variant.label, config }]
            : [];
    });
    const sttEvaluation = sharedEvaluationConfig(evaluation);

    return (
        <section
            className="flex flex-col gap-4"
            aria-labelledby="stt-variants-title"
        >
            <input
                type="hidden"
                name="sttVariants"
                value={JSON.stringify(serializedVariants)}
            />
            <input
                type="hidden"
                name="sttEvaluation"
                value={JSON.stringify(sttEvaluation)}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                {/* Step 3 in STT-only mode (2. is the run mode); Review is 4. */}
                <SectionTitle
                    id="stt-variants-title"
                    description="Compare up to six model configurations in one run."
                >
                    <span className="text-muted-foreground">3.</span> STT config
                    variants
                </SectionTitle>
                <Button
                    type="button"
                    variant="secondary"
                    onClick={controller.add}
                    disabled={!controller.canAdd}
                >
                    Add variant
                </Button>
            </div>
            {controller.variants.map((variant, index) => {
                const selectedModel = evaluation.sttModels.find(
                    (model) => model.id === variant.modelId,
                );
                const idPrefix = `stt-${variant.variantKey}`;
                return (
                    <Card key={variant.variantKey}>
                        <CardHeader className="flex-row items-start justify-between gap-3">
                            <div className="min-w-0">
                                <CardTitle>Variant {index + 1}</CardTitle>
                                <p className="text-copy-14 text-muted-foreground">
                                    {selectedModel?.label ?? "Choose a model"}
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    onClick={() =>
                                        controller.duplicate(variant.variantKey)
                                    }
                                    disabled={!controller.canAdd}
                                >
                                    Duplicate
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                        controller.remove(variant.variantKey)
                                    }
                                    disabled={controller.variants.length === 1}
                                >
                                    Remove
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                            <div className="flex flex-col gap-2">
                                <Label htmlFor={`${idPrefix}-label`}>
                                    Variant label
                                </Label>
                                <Input
                                    id={`${idPrefix}-label`}
                                    value={variant.label}
                                    onChange={(event) =>
                                        controller.updateLabel(
                                            variant.variantKey,
                                            event.target.value,
                                        )
                                    }
                                />
                            </div>
                            <SttModelPicker
                                models={evaluation.sttModels}
                                selectedModel={selectedModel}
                                value={variant.modelId}
                                onChange={(modelId) =>
                                    controller.updateModel(
                                        variant.variantKey,
                                        modelId,
                                    )
                                }
                                id={`${idPrefix}-model`}
                                error={
                                    fieldErrors?.[`${idPrefix}-model`]?.[0] ??
                                    (index === 0
                                        ? fieldErrors?.sttModelId?.[0]
                                        : undefined)
                                }
                            />
                            <SttConfigFields
                                idPrefix={idPrefix}
                                model={selectedModel}
                                language={variant.language}
                                config={variant.config}
                                onLanguageChange={(language) =>
                                    controller.updateLanguage(
                                        variant.variantKey,
                                        language,
                                    )
                                }
                                onConfigChange={(config) =>
                                    controller.updateConfig(
                                        variant.variantKey,
                                        config,
                                    )
                                }
                            />
                        </CardContent>
                    </Card>
                );
            })}
            <Card>
                <CardHeader>
                    <CardTitle as="h2">Shared evaluation</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <TransliterationSettings
                        enabled={evaluation.transliterationEnabled}
                        setEnabled={evaluation.setTransliterationEnabled}
                        modelId={evaluation.transliterationModelId}
                        setModelId={evaluation.setTransliterationModelId}
                        targetLanguage={
                            evaluation.transliterationTargetLanguage
                        }
                        setTargetLanguage={
                            evaluation.setTransliterationTargetLanguage
                        }
                        prompt={evaluation.transliterationPrompt}
                        setPrompt={evaluation.setTransliterationPrompt}
                        temperature={evaluation.transliterationTemperature}
                        setTemperature={
                            evaluation.setTransliterationTemperature
                        }
                    />
                    <TranscriptJudgeSettings
                        enabled={evaluation.evaluatorEnabled}
                        setEnabled={evaluation.setEvaluatorEnabled}
                        modelId={evaluation.evaluatorModelId}
                        setModelId={evaluation.setEvaluatorModelId}
                        rubric={evaluation.evaluatorRubric}
                        setRubric={evaluation.setEvaluatorRubric}
                        reasoningEffort={evaluation.evaluatorReasoningEffort}
                        setReasoningEffort={
                            evaluation.setEvaluatorReasoningEffort
                        }
                    />
                </CardContent>
            </Card>
        </section>
    );
}

function sharedEvaluationConfig(input: AudioController): ISttRunEvaluation {
    const config = sttRunConfig({
        model: undefined,
        modelId: "shared-evaluation",
        language: "",
        config: {},
        transliteration: {
            enabled: input.transliterationEnabled,
            modelId: input.transliterationModelId,
            targetLanguage: input.transliterationTargetLanguage,
            prompt: input.transliterationPrompt,
            temperature: input.transliterationTemperature,
        },
        evaluator: {
            enabled: input.evaluatorEnabled,
            modelId: input.evaluatorModelId,
            rubricPrompt: input.evaluatorRubric,
            reasoningEffort: input.evaluatorReasoningEffort,
        },
    });
    return {
        transcriptVariant: config?.transcriptVariant,
        transliteration: config?.transliteration,
        evaluator: config?.evaluator,
    };
}
