import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    CardSkeleton,
    LoadingRegion,
    PageHeaderSkeleton,
    SectionHeadingSkeleton,
    TableSkeleton,
} from "@/components/layout/skeletons";

export default function MultiworkflowCanvasLoading() {
    return (
        <LoadingRegion label="multiworkflow canvas">
            <PageHeaderSkeleton breadcrumbs description />
            {/* launch */}
            <CardSkeleton description={false}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex flex-1 flex-col gap-2">
                        <Skeleton className="h-5 w-20" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                    <Skeleton className="h-10 w-28" />
                </div>
            </CardSkeleton>
            {/* canvas */}
            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-2">
                    <Skeleton className="h-10 w-28" />
                    <Skeleton className="h-10 w-28" />
                    <Skeleton className="h-10 w-24" />
                </div>
                <Card className="h-[65vh] min-h-[480px] overflow-hidden">
                    <Skeleton className="size-full rounded-none opacity-60" />
                </Card>
            </div>
            {/* history */}
            <section className="flex flex-col gap-4">
                <SectionHeadingSkeleton />
                <TableSkeleton columns={4} rows={3} card={false} />
            </section>
        </LoadingRegion>
    );
}
