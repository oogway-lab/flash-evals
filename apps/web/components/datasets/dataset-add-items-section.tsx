import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PairedImport } from "@/components/datasets/paired-import";
import { TextBulkImport } from "@/components/datasets/text-bulk-import";
import {
    TextAddForm,
    TextInputField,
} from "@/components/datasets/text-add-form";
import { AudioAddForm } from "@/components/datasets/audio-add-form";
import { AudioDropzone } from "@/components/datasets/audio-dropzone";
import { ImageAddForm } from "@/components/datasets/image-add-form";
import { ImageAnswersImport } from "@/components/datasets/image-answers-import";
import { ImageDropzone } from "@/components/datasets/image-dropzone";
import { LabelForm } from "@/components/datasets/label-form";
import { HelpCallout } from "@/components/datasets/help-callout";
import { resolveDatasetAddStrategy } from "@/components/datasets/dataset-add-strategy";
import { singleMediaField } from "@/lib/uploads/upload-form-media";
import type { IActionState } from "@/app/actions";
import type { IDatasetDetailResponse } from "@mosaic/api-contract";

export function DatasetAddItemsSection({
    detail,
    addItemAction,
    importTextItemsAction,
    importPairedItemsAction,
    importImagesAction,
    importAudioAction,
    importImageAnswersAction,
}: {
    detail: IDatasetDetailResponse;
    addItemAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    importTextItemsAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    importPairedItemsAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    importImagesAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    importAudioAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    importImageAnswersAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
}) {
    const strategy = resolveDatasetAddStrategy(detail);
    const { answerSchema, itemCount } = detail;

    switch (strategy.kind) {
        case "evaluation-text":
            return (
                <TextAddForm
                    datasetId={detail.dataset.id}
                    action={addItemAction}
                />
            );

        case "evaluation-audio":
            return (
                <AudioAddForm
                    datasetId={detail.dataset.id}
                    action={importAudioAction}
                />
            );

        case "evaluation-images":
            return (
                <ImageAddForm
                    datasetId={detail.dataset.id}
                    action={importImagesAction}
                />
            );

        case "golden-text-structured":
            return (
                <AddExamplesChoice
                    bulkLabel="Upload many examples"
                    bulkDescription="Import text rows with their expected answer fields."
                    singleLabel="Add one complete example"
                    singleDescription="Create one text input and fill out its expected answer now."
                    bulkContent={
                        <TextBulkImport
                            datasetId={detail.dataset.id}
                            withAnswers
                            action={importTextItemsAction}
                        />
                    }
                    singleContent={
                        <SingleItemAdd
                            datasetId={detail.dataset.id}
                            answerSchema={answerSchema}
                            itemCount={itemCount}
                            freeformLabel={false}
                            isGolden
                            addItemAction={addItemAction}
                            inputField={<TextInputField />}
                        />
                    }
                />
            );

        case "golden-text-freeform":
            return (
                <AddExamplesChoice
                    bulkLabel="Upload many inputs"
                    bulkDescription="Import text inputs first, then add expected answers separately."
                    singleLabel="Add one complete example"
                    singleDescription="Create one text input and write its expected answer JSON now."
                    bulkContent={
                        <TextBulkImport
                            datasetId={detail.dataset.id}
                            withAnswers={false}
                            action={importTextItemsAction}
                        />
                    }
                    singleContent={
                        <SingleItemAdd
                            datasetId={detail.dataset.id}
                            answerSchema={answerSchema}
                            itemCount={itemCount}
                            freeformLabel
                            isGolden
                            addItemAction={addItemAction}
                            inputField={<TextInputField />}
                            answerHint={
                                <HelpCallout title="Expected answer format">
                                    Enter the golden answer as JSON. Example:{" "}
                                    <code>{`{"answer":"salad"}`}</code>
                                </HelpCallout>
                            }
                        />
                    }
                />
            );

        case "golden-audio-structured":
            return (
                <AddExamplesChoice
                    bulkLabel="Upload audio files"
                    bulkDescription="Add audio inputs first, then fill out expected answer fields."
                    singleLabel="Add one audio example"
                    singleDescription="Upload one audio file and fill out its expected answer now."
                    bulkContent={
                        <AudioAddForm
                            datasetId={detail.dataset.id}
                            action={importAudioAction}
                        />
                    }
                    singleContent={
                        <SingleItemAdd
                            datasetId={detail.dataset.id}
                            answerSchema={answerSchema}
                            itemCount={itemCount}
                            freeformLabel={false}
                            isGolden
                            addItemAction={addItemAction}
                            inputField={<AudioInputField />}
                            mediaField="audio"
                        />
                    }
                />
            );

        case "golden-audio-freeform":
            return (
                <AddExamplesChoice
                    bulkLabel="Upload audio files"
                    bulkDescription="Add audio first, then map and preview STT reference answers in the next step."
                    singleLabel="Add one audio with answer"
                    singleDescription="Upload one audio file and enter its expected answer JSON in the same step."
                    bulkContent={
                        <AudioAddForm
                            datasetId={detail.dataset.id}
                            action={importAudioAction}
                        />
                    }
                    singleContent={
                        <SingleItemAdd
                            datasetId={detail.dataset.id}
                            answerSchema={answerSchema}
                            itemCount={itemCount}
                            freeformLabel
                            isGolden
                            addItemAction={addItemAction}
                            inputField={<AudioInputField />}
                            mediaField="audio"
                            answerHint={
                                <HelpCallout title="Expected answer format">
                                    Enter the golden answer for this audio as
                                    JSON. Example:{" "}
                                    <code>{`{"answer":"hello"}`}</code>
                                </HelpCallout>
                            }
                        />
                    }
                />
            );

        case "golden-images-structured":
            return (
                <AddExamplesChoice
                    bulkLabel="Upload many examples"
                    bulkDescription="Import images and answer fields together from files."
                    singleLabel="Add one complete example"
                    singleDescription="Upload one image and fill out its expected answer now."
                    bulkContent={
                        <PairedImport
                            datasetId={detail.dataset.id}
                            schema={answerSchema}
                            readiness={{ hasSchema: true, itemCount }}
                            action={importPairedItemsAction}
                        />
                    }
                    singleContent={
                        <SingleItemAdd
                            datasetId={detail.dataset.id}
                            answerSchema={answerSchema}
                            itemCount={itemCount}
                            freeformLabel={false}
                            isGolden
                            addItemAction={addItemAction}
                            inputField={<ImageInputField />}
                            mediaField="image"
                        />
                    }
                />
            );

        case "golden-images-freeform":
            return (
                <AddExamplesChoice
                    bulkLabel="Upload images with answers"
                    bulkDescription="Import image files and their expected answers together, matched by filename."
                    singleLabel="Add one image with answer"
                    singleDescription="Upload one image and enter its expected answer JSON in the same step."
                    bulkContent={
                        <ImageAnswersImport
                            datasetId={detail.dataset.id}
                            action={importImageAnswersAction}
                        />
                    }
                    singleContent={
                        <SingleItemAdd
                            datasetId={detail.dataset.id}
                            answerSchema={answerSchema}
                            itemCount={itemCount}
                            freeformLabel
                            isGolden
                            addItemAction={addItemAction}
                            inputField={<ImageInputField />}
                            mediaField="image"
                            answerHint={
                                <HelpCallout title="Expected answer format">
                                    Enter the golden answer for this image as
                                    JSON. Example:{" "}
                                    <code>{`{"answer":"salad"}`}</code>
                                </HelpCallout>
                            }
                        />
                    }
                />
            );
    }
}

function ImageInputField() {
    return (
        <div className="flex flex-col gap-2">
            <Label>Image</Label>
            <ImageDropzone name="image" />
        </div>
    );
}

function AudioInputField() {
    return (
        <div className="flex flex-col gap-2">
            <Label>Audio</Label>
            <AudioDropzone name="audio" />
        </div>
    );
}

function AddExamplesChoice({
    bulkLabel,
    bulkDescription,
    singleLabel,
    singleDescription,
    bulkContent,
    singleContent,
}: {
    bulkLabel: string;
    bulkDescription: string;
    singleLabel: string;
    singleDescription: string;
    bulkContent: ReactNode;
    singleContent: ReactNode;
}) {
    return (
        <Tabs defaultValue="bulk">
            <TabsList className="grid h-auto w-full grid-cols-1 gap-2 p-1 sm:grid-cols-2">
                <TabsTrigger
                    value="bulk"
                    className="h-auto rounded-sm px-4 py-3"
                >
                    {bulkLabel}
                </TabsTrigger>
                <TabsTrigger
                    value="single"
                    className="h-auto rounded-sm px-4 py-3"
                >
                    {singleLabel}
                </TabsTrigger>
            </TabsList>
            <TabsContent value="bulk" className="flex flex-col gap-4">
                <ChoiceDescription>{bulkDescription}</ChoiceDescription>
                {bulkContent}
            </TabsContent>
            <TabsContent value="single" className="flex flex-col gap-4">
                <ChoiceDescription>{singleDescription}</ChoiceDescription>
                {singleContent}
            </TabsContent>
        </Tabs>
    );
}

function ChoiceDescription({ children }: { children: ReactNode }) {
    return <p className="text-copy-14 text-muted-foreground">{children}</p>;
}

function SingleItemAdd({
    datasetId,
    answerSchema,
    itemCount,
    freeformLabel,
    isGolden,
    addItemAction,
    inputField,
    mediaField,
    answerHint,
}: {
    datasetId: string;
    answerSchema: IDatasetDetailResponse["answerSchema"];
    itemCount: number;
    freeformLabel: boolean;
    isGolden: boolean;
    addItemAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    inputField: ReactNode;
    mediaField?: "image" | "audio";
    answerHint?: ReactNode;
}) {
    return (
        <div>
            {isGolden ? (
                <LabelForm
                    id="add-item-form"
                    datasetId={datasetId}
                    schema={answerSchema}
                    freeformLabel={freeformLabel}
                    readiness={{ hasSchema: Boolean(answerSchema), itemCount }}
                    action={addItemAction}
                    submitLabel="Add item"
                    resetOnSuccess
                    uploadFields={
                        mediaField ? [singleMediaField(mediaField)] : undefined
                    }
                >
                    {inputField}
                    {answerHint}
                </LabelForm>
            ) : (
                <TextAddForm datasetId={datasetId} action={addItemAction} />
            )}
        </div>
    );
}
