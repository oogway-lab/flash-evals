import { Skeleton } from "@/components/ui/skeleton";
import {
    LoadingRegion,
    PageHeaderSkeleton,
    TableSkeleton,
} from "@/components/layout/skeletons";

export default function ModelsLoading() {
    return (
        <LoadingRegion label="models and prices">
            <PageHeaderSkeleton description />
            <div className="flex flex-col gap-4">
                <Skeleton className="h-10 w-80 max-w-full" />
                <TableSkeleton columns={4} card={false} />
            </div>
        </LoadingRegion>
    );
}
