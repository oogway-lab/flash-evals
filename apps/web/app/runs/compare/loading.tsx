import { Skeleton } from "@/components/ui/skeleton";
import {
    LoadingRegion,
    PageHeaderSkeleton,
} from "@/components/layout/skeletons";

export default function CompareRunLoading() {
    return (
        <LoadingRegion label="comparison setup">
            <PageHeaderSkeleton description action />
            <div className="flex flex-col gap-4">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
            </div>
        </LoadingRegion>
    );
}
