import {
    LoadingRegion,
    PageHeaderSkeleton,
    TableSkeleton,
} from "@/components/layout/skeletons";

export default function WorkspacesLoading() {
    return (
        <LoadingRegion label="workspaces">
            <PageHeaderSkeleton description action />
            <TableSkeleton columns={3} rows={3} card={false} action />
        </LoadingRegion>
    );
}
