import { Skeleton } from "@/components/ui/skeleton";
import {
    LoadingRegion,
    PageHeaderSkeleton,
    SectionHeadingSkeleton,
    TableSkeleton,
} from "@/components/layout/skeletons";

export default function PromptLoading() {
    return (
        <LoadingRegion label="prompt">
            <PageHeaderSkeleton breadcrumbs action />
            <section className="flex flex-col gap-4">
                <SectionHeadingSkeleton description />
                <Skeleton className="h-60 w-full" />
            </section>
            <section className="flex flex-col gap-4">
                <SectionHeadingSkeleton />
                <Skeleton className="h-60 w-full" />
            </section>
            <section className="flex flex-col gap-4">
                <SectionHeadingSkeleton />
                <TableSkeleton columns={3} rows={3} card={false} />
            </section>
        </LoadingRegion>
    );
}
