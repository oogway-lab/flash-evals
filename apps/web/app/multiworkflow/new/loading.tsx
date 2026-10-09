import {
    FormSkeleton,
    LoadingRegion,
    PageHeaderSkeleton,
} from "@/components/layout/skeletons";

export default function NewMultiworkflowLoading() {
    return (
        <LoadingRegion label="multiworkflow form">
            <PageHeaderSkeleton breadcrumbs description />
            <FormSkeleton fields={4} className="max-w-2xl" />
        </LoadingRegion>
    );
}
