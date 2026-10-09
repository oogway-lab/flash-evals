import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    LoadingRegion,
    PageHeaderSkeleton,
    TableSkeleton,
} from "@/components/layout/skeletons";

export default function RunsLoading() {
    return (
        <LoadingRegion label="runs">
            <PageHeaderSkeleton description action />
            <Card className="p-4">
                <div className="flex flex-col gap-4">
                    <Skeleton className="h-10 w-80 max-w-full" />
                    <TableSkeleton columns={7} card={false} action />
                </div>
            </Card>
        </LoadingRegion>
    );
}
