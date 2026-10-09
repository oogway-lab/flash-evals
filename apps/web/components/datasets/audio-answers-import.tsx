"use client";

import { FileDropzone } from "@/components/ui/file-dropzone";
import { Label } from "@/components/ui/label";
import { BulkAudioDropzone } from "@/components/datasets/bulk-audio-dropzone";
import { HelpCallout } from "@/components/datasets/help-callout";
import { ImportFormShell } from "./import-form-shell";
import { bulkMediaField } from "@/lib/uploads/upload-form-media";
import type { IActionState } from "@/app/actions";

export function AudioAnswersImport({
    datasetId,
    action,
}: {
    datasetId: string;
    action: (prev: IActionState, formData: FormData) => Promise<IActionState>;
}) {
    return (
        <ImportFormShell
            datasetId={datasetId}
            action={action}
            submitLabel="Import audio with answers"
            pendingLabel="Importing…"
            resultNoun="audio files imported"
            uploadFields={[bulkMediaField("audio", "audioUploads", "audio")]}
            textSizeGuards={[{ field: "answers", label: "Answer file" }]}
        >
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <Label>Audio files</Label>
                    <BulkAudioDropzone name="audio" />
                </div>

                <div className="flex flex-col gap-2">
                    <Label htmlFor="audio-answers">
                        Answers keyed by audio filename
                    </Label>
                    <FileDropzone
                        id="audio-answers"
                        name="answers"
                        accept=".json,.jsonl,application/json"
                        required
                        size="sm"
                        title="Drop a JSON or JSONL file or click to browse"
                        hint="A JSON array, or one JSON object per line"
                    />
                    <HelpCallout title="Answer file format">
                        Upload JSONL or a JSON array. Each row needs{" "}
                        <code>filename</code> plus transcript fields or a{" "}
                        <code>label</code> object. Example:{" "}
                        <code>
                            {`{"filename":"call.webm","label":{"referenceKind":"human_gold","expectedTranscript":"namaste","expectedTranscriptLatin":"namaste","expectedSpeakerTurns":[{"speaker":"A","text":"namaste","startMs":0,"endMs":800}],"latencySlaMs":2500}}`}
                        </code>
                    </HelpCallout>
                </div>
            </div>
        </ImportFormShell>
    );
}
