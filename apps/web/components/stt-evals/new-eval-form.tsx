"use client";

import { useActionState, useMemo, useState } from "react";
import type { IActionState } from "@/app/actions/types";
import type {
    IRunSetupDatasetOption,
    IRunSetupSttModelOption,
} from "@mosaic/api-contract";
import { KeepFieldsOnReset } from "@/components/ui/keep-fields-on-reset";
import { SubmitButton } from "@/components/ui/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

type InputModality = "audio" | "image" | "text";

const MODALITY_LABELS: Record<InputModality, string> = {
    audio: "Audio",
    image: "Image",
    text: "Text",
};

export function NewEvalForm({
    datasets,
    sttModels,
    action,
}: {
    datasets: IRunSetupDatasetOption[];
    sttModels: IRunSetupSttModelOption[];
    action: (state: IActionState, formData: FormData) => Promise<IActionState>;
}) {
    const [state, formAction] = useActionState(action, {});
    const [modality, setModality] = useState<InputModality>("audio");
    const [datasetId, setDatasetId] = useState("");
    const [modelId, setModelId] = useState(sttModels[0]?.id ?? "");

    const available = useMemo(
        () =>
            datasets.filter(
                (dataset) =>
                    dataset.modality === modality && dataset.itemCount > 0,
            ),
        [datasets, modality],
    );
    // Audio is the only modality that needs a transcription step before the
    // first prompt, so it is the only one that requires an STT model here.
    const needsSttModel = modality === "audio";
    const modelBlocked = available.length > 0 && needsSttModel && !modelId;
    const blocked = !available.length || (needsSttModel && !modelId);

    function selectModality(next: InputModality) {
        setModality(next);
        setDatasetId("");
    }

    return (
        <form action={formAction} className="flex flex-col gap-4">
            <KeepFieldsOnReset />
            <input type="hidden" name="modality" value={modality} />
            <input type="hidden" name="datasetId" value={datasetId} />
            <input type="hidden" name="modelId" value={modelId} />
            <NameField error={state.fieldErrors?.name?.[0]} />
            <div className="flex flex-col gap-2">
                <Label htmlFor="eval-modality">Input modality</Label>
                <Select
                    value={modality}
                    onValueChange={(next) =>
                        selectModality(next as InputModality)
                    }
                >
                    <SelectTrigger id="eval-modality">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {(
                                Object.keys(MODALITY_LABELS) as InputModality[]
                            ).map((value) => (
                                <SelectItem key={value} value={value}>
                                    {MODALITY_LABELS[value]}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor="eval-dataset">Dataset</Label>
                <Select value={datasetId} onValueChange={setDatasetId}>
                    <SelectTrigger
                        id="eval-dataset"
                        aria-describedby={
                            !available.length
                                ? "eval-dataset-blocked"
                                : undefined
                        }
                    >
                        <SelectValue placeholder="Select dataset" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {available.map((dataset) => (
                                <SelectItem key={dataset.id} value={dataset.id}>
                                    {dataset.name} ({dataset.itemCount})
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>
            {needsSttModel ? (
                <div className="flex flex-col gap-2">
                    <Label htmlFor="eval-model">Initial STT model</Label>
                    <Select value={modelId} onValueChange={setModelId}>
                        <SelectTrigger
                            id="eval-model"
                            aria-describedby={
                                modelBlocked ? "eval-model-blocked" : undefined
                            }
                        >
                            <SelectValue placeholder="Select STT model" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {sttModels.map((model) => (
                                    <SelectItem key={model.id} value={model.id}>
                                        {model.label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>
            ) : null}
            {state.formError ? (
                <p role="alert" className="text-copy-14 text-error">
                    {state.formError}
                </p>
            ) : null}
            {!available.length ? (
                <p
                    id="eval-dataset-blocked"
                    role="alert"
                    className="text-copy-14 text-error"
                >
                    No {MODALITY_LABELS[modality].toLowerCase()} dataset with
                    items is available in this project.
                </p>
            ) : null}
            {modelBlocked ? (
                <p
                    id="eval-model-blocked"
                    role="alert"
                    className="text-copy-14 text-error"
                >
                    An available STT model is required for audio inputs.
                </p>
            ) : null}
            <SubmitButton disabled={blocked} loadingText="Creating canvas…">
                Create canvas
            </SubmitButton>
        </form>
    );
}

function NameField({ error }: { error?: string }) {
    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor="eval-name">Name</Label>
            <Input
                id="eval-name"
                name="name"
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "eval-name-error" : undefined}
            />
            {error ? (
                <p id="eval-name-error" className="text-copy-14 text-error">
                    {error}
                </p>
            ) : null}
        </div>
    );
}
