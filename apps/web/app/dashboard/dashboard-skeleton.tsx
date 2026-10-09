import { Skeleton } from "@/components/ui/skeleton";
import {
    LoadingRegion,
    SectionHeadingSkeleton,
    TableSkeleton,
} from "@/components/layout/skeletons";

/** Suspense fallback for the dashboard body (the header renders immediately). */
export function DashboardSkeleton() {
    return (
        <LoadingRegion label="dashboard">
            <div className="grid divide-y divide-border border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div
                        key={i}
                        className="flex flex-col gap-1 py-4 sm:px-6 sm:first:pl-0"
                    >
                        <Skeleton className="h-5 w-16" />
                        <Skeleton className="h-7 w-12" />
                        <Skeleton className="h-5 w-24" />
                    </div>
                ))}
            </div>
            <section className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <SectionHeadingSkeleton />
                    <Skeleton className="h-5 w-16" />
                </div>
                <TableSkeleton columns={5} card={false} />
            </section>
        </LoadingRegion>
    );
}
