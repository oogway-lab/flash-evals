import {
    LoadingRegion,
    PageHeaderSkeleton,
    SectionHeadingSkeleton,
    TableSkeleton,
} from "@/components/layout/skeletons";

export default function MultiworkflowLoading() {
    return (
        <LoadingRegion label="pipelines">
            <PageHeaderSkeleton description action />
            <TableSkeleton columns={5} rows={3} card={false} action />
            <section className="flex flex-col gap-4">
                <SectionHeadingSkeleton />
                <TableSkeleton columns={4} rows={3} card={false} />
            </section>
        </LoadingRegion>
    );
}
