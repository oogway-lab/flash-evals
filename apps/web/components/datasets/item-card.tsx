"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { IdLabel } from "@/components/ui/id-label";
import { LazyImage } from "@/components/ui/lazy-image";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
    ConfirmActionDialog,
    RowActionsMenu,
} from "@/components/ui/row-actions-menu";
import { Label } from "@/components/ui/label";
import { ImageDropzone } from "@/components/datasets/image-dropzone";
import { AudioDropzone } from "@/components/datasets/audio-dropzone";
import { LabelForm } from "@/components/datasets/label-form";
import { singleMediaField } from "@/lib/uploads/upload-form-media";
import { JsonBlock } from "@/components/ui/json-block";
import type { IParsedSchemaDescriptor, LabelJson } from "@mosaic/api-contract";
import type { IActionState } from "@/app/actions";
import type { IGoldCoverage } from "./gold-coverage";
import { shortId } from "@/lib/format";
import { ITEM_TYPE_LABELS, labelFor } from "@/lib/labels";

const EDIT_EVENT = "mosaic:item-edit";

export function ItemCard({
    id,
    datasetId,
    type,
    storageKey,
    mimeType,
    inputText,
    label,
    goldCoverage,
    schema,
    freeformLabel = false,
    isGolden = true,
    readOnly = false,
    variant = "grid",
    editAction,
    deleteAction,
}: {
    id: string;
    datasetId: string;
    type: string;
    storageKey: string | null;
    mimeType: string | null;
    inputText: string | null;
    label: LabelJson | undefined;
    goldCoverage?: IGoldCoverage;
    schema: IParsedSchemaDescriptor | undefined;
    freeformLabel?: boolean;
    isGolden?: boolean;
    readOnly?: boolean;
    variant?: "grid" | "list";
    editAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    deleteAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
}) {
    const [editing, setEditing] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const labelFields = label ? Object.keys(label).length : 0;
    const truncatedInput = inputText
        ? inputText.length > 96
            ? `${inputText.slice(0, 96)}…`
            : inputText
        : "Untitled item";

    useEffect(() => {
        function onEdit(event: Event) {
            const detail = (event as CustomEvent<string>).detail;
            setEditing(detail === id);
        }
        window.addEventListener(EDIT_EVENT, onEdit);
        return () => window.removeEventListener(EDIT_EVENT, onEdit);
    }, [id]);

    function openEdit() {
        window.dispatchEvent(new CustomEvent(EDIT_EVENT, { detail: id }));
        setEditing(true);
    }

    const itemMeta = (
        <div className="flex flex-wrap items-center gap-2">
            <span className="text-label-12 text-muted-foreground">
                {labelFor(ITEM_TYPE_LABELS, type)}
            </span>
            <IdLabel id={id} noun="item ID" />
            {labelFields > 0 && (
                <span className="text-label-12 text-muted-foreground">
                    {labelFields} label field
                    {labelFields !== 1 ? "s" : ""}
                </span>
            )}
            {goldCoverage && (
                <>
                    <span
                        className={cn(
                            "text-label-12",
                            goldCoverage.transcript
                                ? "text-muted-foreground"
                                : "text-eval-warning",
                        )}
                    >
                        Transcript{" "}
                        {goldCoverage.transcript ? "present" : "missing"}
                    </span>
                    <span className="text-label-12 text-muted-foreground">
                        Latin {goldCoverage.latin ? "present" : "missing"}
                    </span>
                    <span className="text-label-12 text-muted-foreground">
                        Speakers{" "}
                        {goldCoverage.speakerTurns ? "present" : "missing"}
                    </span>
                </>
            )}
        </div>
    );

    const editLabel = isGolden
        ? "Edit"
        : labelFields > 0
          ? "Edit output"
          : "Add output";

    const itemActions = !readOnly && (
        <div className="flex flex-wrap gap-2">
            <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={openEdit}
            >
                {editLabel}
            </Button>
            <RowActionsMenu name={`item ${shortId(id)}`}>
                <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteOpen(true)}
                >
                    Delete
                </DropdownMenuItem>
            </RowActionsMenu>
            <ConfirmActionDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                title="Delete item?"
                description="This cannot be undone."
                confirmLabel="Delete item"
                pendingLabel="Deleting…"
                action={deleteAction}
                fields={{ itemId: id }}
            >
                <Card
                    variant="inset"
                    className="p-3 text-copy-14 text-muted-foreground"
                >
                    {truncatedInput}
                </Card>
            </ConfirmActionDialog>
        </div>
    );

    const labelContent = label && (
        <JsonBlock data={label} collapsible defaultOpen={false} />
    );

    const isAudio = type === "audio" || mimeType?.startsWith("audio/") === true;
    const media = storageKey && (
        <div
            className={
                variant === "list"
                    ? "min-h-28 w-full shrink-0 overflow-hidden rounded-sm bg-muted sm:w-44"
                    : "aspect-video w-full overflow-hidden bg-muted"
            }
        >
            {isAudio ? (
                <div className="flex h-full w-full flex-col justify-center gap-2 p-3">
                    <p className="text-label-12 text-muted-foreground">
                        Audio item
                    </p>
                    <audio
                        controls
                        preload="none"
                        src={`/api/images/${storageKey}`}
                        className="w-full"
                    />
                </div>
            ) : (
                <LazyImage
                    src={`/api/images/${storageKey}`}
                    alt={inputText ?? "Dataset item"}
                />
            )}
        </div>
    );

    return (
        <Card className="overflow-hidden bg-neutral">
            {variant === "grid" && media}
            <div className="flex flex-col gap-3 p-3">
                {editing ? (
                    <LabelForm
                        id={`edit-item-${id}`}
                        datasetId={datasetId}
                        schema={schema}
                        freeformLabel={freeformLabel}
                        readiness={{ hasSchema: Boolean(schema), itemCount: 1 }}
                        initialLabel={label}
                        action={editAction}
                        submitLabel="Save item"
                        freeformLabelText={
                            isGolden
                                ? "Golden answer (JSON)"
                                : "Expected output (JSON)"
                        }
                        hiddenFields={{
                            itemId: id,
                            inputText: inputText ?? "",
                        }}
                        uploadFields={[
                            singleMediaField(isAudio ? "audio" : "image"),
                        ]}
                        onSuccess={() => setEditing(false)}
                        secondaryAction={
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setEditing(false)}
                            >
                                Cancel
                            </Button>
                        }
                    >
                        <div className="flex flex-col gap-2">
                            <Label>
                                Replace {isAudio ? "audio" : "image"} (optional)
                            </Label>
                            {isAudio ? (
                                <AudioDropzone name="audio" />
                            ) : (
                                <ImageDropzone name="image" />
                            )}
                        </div>
                    </LabelForm>
                ) : variant === "list" ? (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                        {media}
                        <div className="flex min-w-0 flex-1 flex-col gap-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                {itemMeta}
                                {itemActions}
                            </div>
                            {inputText && (
                                <p className="line-clamp-2 text-copy-14 text-on-surface">
                                    {inputText}
                                </p>
                            )}
                            {labelContent}
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            {itemMeta}
                            {itemActions}
                        </div>
                        {inputText && (
                            <p className="line-clamp-2 text-copy-14 text-on-surface">
                                {inputText}
                            </p>
                        )}
                        {labelContent}
                    </>
                )}
            </div>
        </Card>
    );
}
