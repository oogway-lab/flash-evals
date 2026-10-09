import { Skeleton } from "@/components/ui/skeleton";
import {
    LoadingRegion,
    PageHeaderSkeleton,
    TableSkeleton,
} from "@/components/layout/skeletons";

export default function DatasetsLoading() {
    return (
        <LoadingRegion label="datasets">
            <PageHeaderSkeleton description action />
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <Skeleton className="h-10 w-full sm:w-80" />
                    <Skeleton className="h-5 w-36" />
                </div>
                <TableSkeleton columns={6} card={false} action />
            </div>
        </LoadingRegion>
    );
}
