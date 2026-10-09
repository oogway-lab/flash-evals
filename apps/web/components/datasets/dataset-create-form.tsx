"use client";

import { PendingFieldset } from "@/components/ui/pending-fieldset";
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IActionState } from "@/app/actions";
import { SectionTitle } from "@/components/layout/section-title";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";

type Purpose = "golden" | "evaluation";
type Modality = "audio" | "image" | "text";

function validModality(value: string | undefined): Modality {
    return value === "audio" || value === "text" ? value : "image";
}

interface IOption<T extends string> {
    value: T;
    title: string;
    explanation: string;
}

const PURPOSE_OPTIONS: IOption<Purpose>[] = [
    {
        value: "golden",
        title: "Golden (with answers)",
        explanation:
            "You already know the expected output for each example, so runs can be scored automatically.",
    },
    {
        value: "evaluation",
        title: "Evaluation (inputs only)",
        explanation:
            "Just the inputs you want to try. Model outputs are generated when you run, and you can add expected outputs later.",
    },
];

const MODALITY_OPTIONS: IOption<Modality>[] = [
    {
        value: "audio",
        title: "Audio",
        explanation:
            "Each example is an audio file that can be transcribed for evals.",
    },
    {
        value: "image",
        title: "Images",
        explanation:
            "Each example is an image (optionally with a text caption).",
    },
    {
        value: "text",
        title: "Text",
        explanation: "Each example is a piece of text.",
    },
];

function CreateButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" loading={pending} loadingText="Creating…">
            Create dataset
        </Button>
    );
}

export function DatasetCreateForm({
    createDatasetAction,
    initialModality,
}: {
    createDatasetAction: (
        state: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    initialModality?: string;
}) {
    const [purpose, setPurpose] = useState<Purpose>("golden");
    const [modality, setModality] = useState<Modality>(() =>
        validModality(initialModality),
    );
    const [name, setName] = useState("");
    const [nameError, setNameError] = useState<string | undefined>(undefined);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const [state, formAction] = useActionState(createDatasetAction, {});

    function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        if (name.trim() === "") {
            event.preventDefault();
            setNameError("Enter a name for your dataset.");
            nameInputRef.current?.focus();
        }
    }

    return (
        <form action={formAction} onSubmit={handleSubmit} className="max-w-2xl">
            <PendingFieldset className="flex flex-col gap-6">
                <input type="hidden" name="purpose" value={purpose} />
                <input type="hidden" name="modality" value={modality} />

                <div className="flex flex-col gap-2">
                    <Label htmlFor="name">Dataset name</Label>
                    <Input
                        ref={nameInputRef}
                        id="name"
                        name="name"
                        placeholder="Food plates v1"
                        value={name}
                        invalid={Boolean(nameError)}
                        onChange={(event) => {
                            setName(event.target.value);
                            if (nameError) setNameError(undefined);
                        }}
                    />
                    {nameError ? (
                        <p role="alert" className="text-copy-14 text-error">
                            {nameError}
                        </p>
                    ) : (
                        <p className="text-copy-14 text-muted-foreground">
                            You can rename it later.
                        </p>
                    )}
                </div>

                <section className="flex flex-col gap-3">
                    <SectionTitle
                        id="dataset-purpose-heading"
                        description="This decides whether examples carry expected answers."
                    >
                        What is this dataset for?
                    </SectionTitle>
                    <RadioGroup
                        aria-labelledby="dataset-purpose-heading"
                        value={purpose}
                        onValueChange={(value) =>
                            setPurpose(value as typeof purpose)
                        }
                    >
                        {PURPOSE_OPTIONS.map((option) => (
                            <RadioCard
                                key={option.value}
                                value={option.value}
                                title={option.title}
                                description={option.explanation}
                            />
                        ))}
                    </RadioGroup>
                </section>

                <section className="flex flex-col gap-3">
                    <SectionTitle
                        id="dataset-modality-heading"
                        description="Pick the modality of the inputs you will add."
                    >
                        What kind of examples?
                    </SectionTitle>
                    <RadioGroup
                        aria-labelledby="dataset-modality-heading"
                        value={modality}
                        onValueChange={(value) =>
                            setModality(value as typeof modality)
                        }
                    >
                        {MODALITY_OPTIONS.map((option) => (
                            <RadioCard
                                key={option.value}
                                value={option.value}
                                title={option.title}
                                description={option.explanation}
                            />
                        ))}
                    </RadioGroup>
                </section>

                <div className="flex flex-col items-end gap-2">
                    {state.formError && (
                        <p role="alert" className="text-copy-14 text-error">
                            {state.formError}
                        </p>
                    )}
                    <CreateButton />
                </div>
            </PendingFieldset>
        </form>
    );
}
