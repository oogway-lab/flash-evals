"use client";

import type {
    IRunSetupJudgePromptOption,
    IRunSetupModelOption,
    ReasoningEffort,
} from "@mosaic/api-contract";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { transportLabel } from "@/lib/transport";
import type { usePromptEvalRunController } from "./use-prompt-eval-run-controller";
import { REASONING_EFFORT_LABELS } from "@/lib/labels";

type PromptEvalController = ReturnType<typeof usePromptEvalRunController>;

export function RunJudgeSection({
    controller,
    judgePrompts,
    availableModels,
    fieldError,
}: {
    controller: PromptEvalController;
    judgePrompts: IRunSetupJudgePromptOption[];
    availableModels: IRunSetupModelOption[];
    fieldError?: string;
}) {
    const selectSavedJudge = (value: string) => {
        controller.setJudgePromptVersionId(value);
        if (value === "none") return;
        controller.setJudgeRubric("");
        controller.setJudgeError(undefined);
    };
    const judgeModels = availableModels.filter(
        (model) =>
            model.available && model.judgeSuitable && model.structuredOutput,
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle as="h2">
                    <span className="text-muted-foreground">4.</span> Judge
                    (optional)
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <p className="text-copy-14 text-muted-foreground">
                    Optional. Pick a judge you already saved, or generate an
                    LLM-as-judge rubric from the selected dataset and prompt.
                    Leave both empty to run without a judge.
                </p>
                <input
                    type="hidden"
                    name="judgePromptVersionId"
                    value={controller.judgePromptVersionId}
                />
                {judgePrompts.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="savedJudge">Use a saved judge</Label>
                        <Select
                            value={controller.judgePromptVersionId}
                            onValueChange={selectSavedJudge}
                        >
                            <SelectTrigger id="savedJudge">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {judgePrompts.map((judge) => (
                                    <SelectItem
                                        key={judge.promptVersionId}
                                        value={judge.promptVersionId}
                                    >
                                        {judge.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-label-12 text-muted-foreground">
                            Reuses a judge prompt saved under Prompts, or
                            generate a new one below.
                        </p>
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={controller.handleGenerateJudge}
                        loading={controller.judgeGenerating}
                        loadingText="Generating judge…"
                        disabled={
                            !controller.canGenerateJudge ||
                            controller.usingSavedJudge
                        }
                    >
                        Generate judge with AI
                    </Button>
                    {!controller.canGenerateJudge && (
                        <span className="text-copy-14 text-muted-foreground">
                            Select a dataset and a prompt version first.
                        </span>
                    )}
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="judgeModelId">Judge model</Label>
                    <Select
                        name="judgeModelId"
                        value={controller.judgeModelId}
                        onValueChange={controller.setJudgeModelId}
                        disabled={controller.usingSavedJudge}
                    >
                        <SelectTrigger id="judgeModelId">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {judgeModels.map((model) => (
                                <SelectItem key={model.id} value={model.id}>
                                    {model.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <input
                    type="hidden"
                    name="judgeTransport"
                    value={controller.judgeTransport ?? ""}
                />
                {(judgeModels.find(
                    (model) => model.id === controller.judgeModelId,
                )?.transports.length ?? 0) > 1 && (
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="judgeTransport">Judge transport</Label>
                        <Select
                            value={controller.judgeTransport}
                            onValueChange={(value) =>
                                controller.setJudgeTransport(
                                    value as typeof controller.judgeTransport,
                                )
                            }
                            disabled={controller.usingSavedJudge}
                        >
                            <SelectTrigger id="judgeTransport">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {judgeModels
                                    .find(
                                        (model) =>
                                            model.id ===
                                            controller.judgeModelId,
                                    )
                                    ?.transports.map((transport) => (
                                        <SelectItem
                                            key={transport}
                                            value={transport}
                                        >
                                            {transportLabel(transport)}
                                        </SelectItem>
                                    ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
                <input
                    type="hidden"
                    name="judgeReasoningEffort"
                    value={controller.effectiveJudgeEffort ?? ""}
                />
                {controller.judgeEffortCapability && (
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="judgeReasoningEffort">
                            Judge reasoning effort
                        </Label>
                        <Select
                            value={controller.effectiveJudgeEffort}
                            onValueChange={(value) =>
                                controller.setJudgeReasoningEffort(
                                    value as ReasoningEffort,
                                )
                            }
                            disabled={controller.usingSavedJudge}
                        >
                            <SelectTrigger id="judgeReasoningEffort">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {controller.judgeEffortCapability.supportedLevels.map(
                                    (level) => (
                                        <SelectItem key={level} value={level}>
                                            {REASONING_EFFORT_LABELS[level]}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                )}
                <div className="flex flex-col gap-2">
                    <Label htmlFor="judgeRubric">Judge rubric</Label>
                    <Textarea
                        id="judgeRubric"
                        name="judgeRubric"
                        rows={8}
                        disabled={controller.usingSavedJudge}
                        className="text-mono-13"
                        placeholder={
                            controller.usingSavedJudge
                                ? "Using a saved judge. Set the dropdown above to None to write a rubric instead."
                                : "Generate a rubric above, or write one here. Leave empty for no judge."
                        }
                        value={controller.judgeRubric}
                        onChange={(event) =>
                            controller.setJudgeRubric(event.target.value)
                        }
                    />
                </div>
                {controller.judgeError && (
                    <p role="alert" className="text-copy-14 text-error">
                        {controller.judgeError}
                    </p>
                )}
                {fieldError && (
                    <p role="alert" className="text-copy-14 text-error">
                        {fieldError}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
