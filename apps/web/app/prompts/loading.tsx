import { Skeleton } from "@/components/ui/skeleton";
import {
    LoadingRegion,
    PageHeaderSkeleton,
    TableSkeleton,
} from "@/components/layout/skeletons";

export default function PromptsLoading() {
    return (
        <LoadingRegion label="prompts">
            <PageHeaderSkeleton description action />
            <div className="flex flex-col gap-4">
                <Skeleton className="h-10 w-full sm:w-80" />
                <TableSkeleton columns={6} card={false} action />
            </div>
        </LoadingRegion>
    );
}
