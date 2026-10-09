"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
    createDatasetForInputAction,
    importAudioAction,
    importImagesAction,
    importTextItemsAction,
    type IActionState,
} from "@/app/actions";
import { AudioAddForm } from "@/components/datasets/audio-add-form";
import { ImageAddForm } from "@/components/datasets/image-add-form";
import { TextBulkImport } from "@/components/datasets/text-bulk-import";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NewTabIcon } from "@/components/ui/external-link";

type Modality = "audio" | "image" | "text";
type ImportAction = (
    previousState: IActionState,
    formData: FormData,
) => Promise<IActionState>;

interface ICreatedDataset {
    id: string;
    name: string;
}

export function InputDatasetUpload({
    modality,
    onBind,
}: {
    modality: Modality;
    onBind: (datasetId: string) => void;
}) {
    const [name, setName] = useState("");
    const [created, setCreated] = useState<ICreatedDataset>();
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string>();
    const [addedCount, setAddedCount] = useState(0);

    async function createDataset(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
            setCreateError("Enter a dataset name.");
            return;
        }
        setCreating(true);
        setCreateError(undefined);
        const formData = new FormData();
        formData.set("name", trimmedName);
        formData.set("modality", modality);
        try {
            const { id } = await createDatasetForInputAction(formData);
            setCreated({ id, name: trimmedName });
            onBind(id);
        } catch (error) {
            setCreateError(
                error instanceof Error
                    ? error.message
                    : "Dataset creation failed. Try again.",
            );
        } finally {
            setCreating(false);
        }
    }

    function trackImport(action: ImportAction): ImportAction {
        return async (previousState, formData) => {
            const state = await action(previousState, formData);
            if (state.ok && state.importedCount !== undefined && created) {
                setAddedCount((count) => count + state.importedCount!);
                onBind(created.id);
            }
            return state;
        };
    }

    if (!created) {
        return (
            <form onSubmit={createDataset} className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                    <Label htmlFor="input-new-dataset-name">
                        New dataset name
                    </Label>
                    <Input
                        id="input-new-dataset-name"
                        value={name}
                        onChange={(event) => {
                            setName(event.target.value);
                            setCreateError(undefined);
                        }}
                        placeholder={`${modality} inputs`}
                        aria-invalid={Boolean(createError)}
                    />
                </div>
                {createError ? (
                    <p role="alert" className="text-copy-14 text-error">
                        {createError}
                    </p>
                ) : null}
                <Button
                    type="submit"
                    variant="secondary"
                    loading={creating}
                    loadingText="Creating…"
                >
                    Create dataset
                </Button>
            </form>
        );
    }

    const importAction =
        modality === "audio"
            ? trackImport(importAudioAction)
            : modality === "image"
              ? trackImport(importImagesAction)
              : trackImport(importTextItemsAction);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <p className="text-label-14 text-on-surface">
                    {created.name} is created and bound.
                </p>
                <p className="text-copy-14 text-muted-foreground">
                    {addedCount} items added in this panel.
                </p>
            </div>
            {modality === "audio" ? (
                <AudioAddForm datasetId={created.id} action={importAction} />
            ) : modality === "image" ? (
                <ImageAddForm datasetId={created.id} action={importAction} />
            ) : (
                <TextBulkImport
                    datasetId={created.id}
                    withAnswers={false}
                    action={importAction}
                />
            )}
            <Link
                href={`/datasets/${created.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "link", size: "sm" })}
            >
                Manage answers and structured imports in Datasets
                <NewTabIcon />
            </Link>
        </div>
    );
}
