import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";

function FieldSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn("flex flex-col gap-2", className)}>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-10 w-full" />
        </div>
    );
}

function EditorColumnSkeleton() {
    return (
        <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-24" />
            <div className="flex flex-wrap items-start justify-between gap-3">
                <Skeleton className="h-4 w-56 max-w-full" />
                <Skeleton className="h-8 w-36 shrink-0" />
            </div>
            <Skeleton className="h-80 w-full" />
        </div>
    );
}

/** Mirrors `PromptWorkbench`: field row, description, editor columns. */
export function PromptWorkbenchSkeleton() {
    return (
        <div className="flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-6">
                <FieldSkeleton className="sm:col-span-2" />
                <FieldSkeleton />
                <div className="grid gap-3 sm:col-span-3 md:grid-cols-[minmax(160px,0.8fr)_minmax(220px,1.2fr)]">
                    <FieldSkeleton />
                    <FieldSkeleton />
                </div>
            </div>
            <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-24 w-full" />
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <EditorColumnSkeleton />
                <EditorColumnSkeleton />
            </div>
        </div>
    );
}
