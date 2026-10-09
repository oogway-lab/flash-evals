import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    CardSkeleton,
    LoadingRegion,
    PageHeaderSkeleton,
    SectionHeadingSkeleton,
    TableSkeleton,
} from "@/components/layout/skeletons";

export default function MultiworkflowRunLoading() {
    return (
        <LoadingRegion label="multiworkflow run">
            <PageHeaderSkeleton breadcrumbs description />
            <Card>
                <CardContent className="flex flex-col gap-3">
                    <Skeleton className="h-5.5 w-24" />
                    <Skeleton className="h-2 w-full rounded-full" />
                    <Skeleton className="h-5 w-48" />
                </CardContent>
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
                <CardSkeleton lines={3} />
                <CardSkeleton lines={3} />
            </div>
            <section className="flex flex-col gap-4">
                <SectionHeadingSkeleton description />
                <TableSkeleton columns={4} card={false} />
            </section>
        </LoadingRegion>
    );
}
