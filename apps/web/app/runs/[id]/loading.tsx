import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    CardSkeleton,
    LoadingRegion,
    PageHeaderSkeleton,
    TableSkeleton,
} from "@/components/layout/skeletons";

export default function RunDetailLoading() {
    return (
        <LoadingRegion label="run">
            <PageHeaderSkeleton
                breadcrumbs
                action
                actionClassName="h-10 w-full sm:w-24"
            />
            {/* progress */}
            <Card>
                <CardContent className="flex flex-col gap-3">
                    <Skeleton className="h-5.5 w-24" />
                    <Skeleton className="h-2 w-full rounded-full" />
                    <Skeleton className="h-5 w-48" />
                </CardContent>
            </Card>
            {/* notes */}
            <Card>
                <CardHeader className="pb-3">
                    <Skeleton className="h-6 w-24" />
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-20 w-full" />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <Skeleton className="h-5 w-56" />
                        <Skeleton className="h-8 w-24" />
                    </div>
                </CardContent>
            </Card>
            {/* tabs + leaderboard */}
            <Skeleton className="h-10 w-48" />
            <TableSkeleton columns={6} rows={4} className="p-4" />
            <CardSkeleton description={false} lines={1} />
        </LoadingRegion>
    );
}
