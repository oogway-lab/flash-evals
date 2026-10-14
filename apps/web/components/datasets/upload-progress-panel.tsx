"use client";

import { Card } from "@/components/ui/card";
import { formatFileSize } from "@/components/ui/file-dropzone";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { plural } from "@/lib/format";
import type { IUploadProgress } from "@/lib/uploads/upload-progress";

/**
 * What a media import is doing right now: signing, sending bytes (with an
 * overall bar across every file), then adding the items. Per-file bars live on
 * the file rows; this is the at-a-glance total.
 */
export function UploadProgressPanel({
    progress,
}: {
    progress: IUploadProgress;
}) {
    if (progress.phase === "idle") return null;

    const files = Object.values(progress.files);
    const totalBytes = files.reduce((sum, file) => sum + file.total, 0);
    const loadedBytes = files.reduce(
        (sum, file) =>
            sum + (file.status === "done" ? file.total : file.loaded),
        0,
    );
    const uploaded = files.filter((file) => file.status === "done").length;
    const failed = files.filter((file) => file.status === "failed").length;

    let title: string;
    let detail: string | undefined;
    if (progress.phase === "preparing") {
        title = `Preparing ${plural(files.length, "file")} for upload…`;
    } else if (progress.phase === "uploading") {
        title = `Uploading ${uploaded} of ${plural(files.length, "file")}`;
        detail = `${formatFileSize(loadedBytes)} of ${formatFileSize(totalBytes)}`;
    } else {
        const imported = files.length - failed;
        title = `Adding ${plural(imported, "file")} to the dataset…`;
    }

    return (
        <Card
            variant="inset"
            role="status"
            aria-live="polite"
            className="flex flex-col gap-2 p-4"
        >
            <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-label-14 text-on-surface">
                    <Spinner size="sm" />
                    {title}
                </p>
                {detail && (
                    <span className="text-copy-13 tabular-nums text-muted-foreground">
                        {detail}
                    </span>
                )}
            </div>
            <Progress
                aria-label="Upload progress"
                value={progress.phase === "uploading" ? loadedBytes : undefined}
                max={totalBytes}
                indeterminate={progress.phase !== "uploading"}
            />
            {failed > 0 && (
                <p className="text-copy-13 text-error">
                    {plural(failed, "file")} could not be uploaded after
                    retrying. The rest will still be imported.
                </p>
            )}
        </Card>
    );
}
