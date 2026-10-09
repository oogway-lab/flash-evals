import {
    LoadingRegion,
    PageHeaderSkeleton,
    TableSkeleton,
} from "@/components/layout/skeletons";

export default function WorkspaceLoading() {
    return (
        <LoadingRegion label="workspace">
            <PageHeaderSkeleton breadcrumbs description action />
            <TableSkeleton columns={2} rows={3} card={false} action />
        </LoadingRegion>
    );
}
