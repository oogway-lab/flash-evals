import { Skeleton } from "@/components/ui/skeleton";
import {
    LoadingRegion,
    PageHeaderSkeleton,
} from "@/components/layout/skeletons";

function OptionCardsSkeleton({ count }: { count: number }) {
    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-5 w-72 max-w-full" />
            </div>
            <div className="flex flex-col gap-3">
                {Array.from({ length: count }).map((_, i) => (
                    <div
                        key={i}
                        className="flex flex-col gap-2 rounded-sm border border-border p-4"
                    >
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-5 w-full" />
                    </div>
                ))}
            </div>
        </section>
    );
}

export default function NewDatasetLoading() {
    return (
        <LoadingRegion label="dataset form">
            <PageHeaderSkeleton breadcrumbs description />
            <div className="flex max-w-2xl flex-col gap-6">
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-5 w-32" />
                </div>
                <OptionCardsSkeleton count={2} />
                <OptionCardsSkeleton count={3} />
                <div className="flex justify-end">
                    <Skeleton className="h-10 w-36" />
                </div>
            </div>
        </LoadingRegion>
    );
}
