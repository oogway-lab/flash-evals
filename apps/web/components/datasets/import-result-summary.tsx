import { CircleAlert, CircleCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import type { IImportFailure } from "@/server/datasets/import";

function nextStep(
    importedCount: number,
    failures: IImportFailure[],
    rejected: boolean | undefined,
): string | undefined {
    if (failures.length === 0) return undefined;
    if (rejected || importedCount === 0) {
        return "Nothing was imported. Your files are still selected: fix the problem above and submit again.";
    }
    if (
        failures.some((failure) => failure.reason.startsWith("Upload failed"))
    ) {
        return "Files that failed to upload are still selected. Submit again to retry just those.";
    }
    return "The rest were imported. Fix the items above and import them again.";
}

export function ImportResultSummary({
    importedCount,
    failures,
    rejected,
}: {
    importedCount?: number;
    failures?: IImportFailure[];
    rejected?: boolean;
}) {
    if (importedCount === undefined && !(failures && failures.length)) {
        return null;
    }

    const imported = importedCount ?? 0;
    const failed = failures ?? [];
    const step = nextStep(imported, failed, rejected);
    const allGood = failed.length === 0;
    const nothingImported = imported === 0 && !allGood;

    return (
        <Card
            variant="inset"
            className={cn(
                "flex flex-col gap-3 p-4",
                nothingImported &&
                    "border border-error/30 bg-eval-danger-muted",
            )}
        >
            <div className="flex items-start gap-2">
                {allGood ? (
                    <CircleCheck
                        className="mt-0.5 size-4 shrink-0 text-eval-success"
                        aria-hidden="true"
                    />
                ) : (
                    <CircleAlert
                        className={cn(
                            "mt-0.5 size-4 shrink-0",
                            nothingImported
                                ? "text-error"
                                : "text-eval-warning",
                        )}
                        aria-hidden="true"
                    />
                )}
                <div className="flex flex-col gap-0.5">
                    <p className="text-label-14 text-on-surface">
                        Import summary
                    </p>
                    <p className="text-copy-14">
                        <span className="text-eval-success">
                            Imported: {imported}
                        </span>
                        <span className="text-muted-foreground"> · </span>
                        <span
                            className={
                                allGood
                                    ? "text-muted-foreground"
                                    : "text-eval-danger"
                            }
                        >
                            Failed: {failed.length}
                        </span>
                    </p>
                    {step && (
                        <p className="text-copy-13 text-muted-foreground">
                            {step}
                        </p>
                    )}
                </div>
            </div>
            {failed.length > 0 && (
                <ul
                    aria-label={plural(failed.length, "problem")}
                    className="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1"
                >
                    {failed.map((failure, index) => (
                        <li
                            key={`${failure.row ?? failure.fileName ?? index}-${index}`}
                            className="border-t border-border pt-3 first:border-t-0 first:pt-0 text-copy-14 text-on-surface"
                        >
                            {(failure.row || failure.fileName) && (
                                <span className="block truncate text-label-12 text-eval-danger">
                                    {failure.row
                                        ? `Row ${failure.row}`
                                        : failure.fileName}
                                </span>
                            )}
                            <span className="block text-muted-foreground">
                                {failure.reason}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}
