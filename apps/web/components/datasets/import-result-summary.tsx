import { Card } from "@/components/ui/card";
import type { IImportFailure } from "@/server/datasets/import";

export function ImportResultSummary({
    importedCount,
    failures,
}: {
    importedCount?: number;
    failures?: IImportFailure[];
}) {
    if (importedCount === undefined && !(failures && failures.length)) {
        return null;
    }

    return (
        <Card variant="inset" className="flex flex-col gap-2 p-4">
            <p className="text-label-14 text-on-surface">Import summary</p>
            <div className="flex flex-col">
                <p className="text-copy-14 text-eval-success">
                    Imported: {importedCount ?? 0}
                </p>
                <p className="text-copy-14 text-eval-danger">
                    Failed: {failures?.length ?? 0}
                </p>
            </div>
            {failures && failures.length > 0 && (
                <ul className="flex flex-col gap-3">
                    {failures.map((failure, index) => (
                        <li
                            key={`${failure.row ?? failure.fileName ?? index}-${index}`}
                            className="border-t border-border pt-3 first:border-t-0 first:pt-0 text-copy-14 text-on-surface"
                        >
                            <span className="text-label-12 text-eval-danger">
                                {failure.row
                                    ? `Row ${failure.row}`
                                    : (failure.fileName ?? "Import")}
                            </span>
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
