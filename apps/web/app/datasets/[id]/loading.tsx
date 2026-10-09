import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    LoadingRegion,
    PageHeaderSkeleton,
} from "@/components/layout/skeletons";

export default function DatasetDetailLoading() {
    return (
        <LoadingRegion label="dataset">
            <PageHeaderSkeleton breadcrumbs action />
            <div className="flex flex-col gap-4">
                {/* description link, then the dataset type guidance */}
                <Skeleton className="h-5 w-32" />
                <div className="flex flex-col gap-1">
                    <Skeleton className="h-5 w-full max-w-3xl" />
                    <Skeleton className="h-5 w-3/4 sm:hidden" />
                </div>
            </div>
            {/* add-items step: title, description, dropzone, action */}
            <div className="max-w-2xl">
                <Card variant="inset" className="flex flex-col gap-4 p-6">
                    <div className="flex flex-col gap-1">
                        <Skeleton className="h-7 w-40" />
                        <Skeleton className="h-5 w-80 max-w-full" />
                    </div>
                    <Skeleton className="h-36 w-full" />
                    <Skeleton className="h-10 w-32" />
                </Card>
            </div>
            {/* items grid */}
            <section className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-col gap-1">
                        <Skeleton className="h-7 w-28" />
                        <Skeleton className="h-5 w-80 max-w-full" />
                    </div>
                    <Skeleton className="h-8 w-full sm:w-36" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Card key={i} className="overflow-hidden">
                            <Skeleton className="aspect-video w-full rounded-none" />
                            <div className="flex flex-col gap-3 p-3">
                                <Skeleton className="h-5 w-3/4" />
                                <Skeleton className="h-5 w-1/2" />
                            </div>
                        </Card>
                    ))}
                </div>
            </section>
        </LoadingRegion>
    );
}
