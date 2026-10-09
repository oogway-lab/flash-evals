import {
    CardSkeleton,
    FormSkeleton,
    LoadingRegion,
    PageHeaderSkeleton,
} from "@/components/layout/skeletons";

export default function NewRunLoading() {
    return (
        <LoadingRegion label="run setup">
            <PageHeaderSkeleton breadcrumbs description />
            <div className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                    <CardSkeleton description={false}>
                        <FormSkeleton fields={1} submit={false} />
                    </CardSkeleton>
                    <CardSkeleton description={false}>
                        <FormSkeleton fields={1} submit={false} />
                    </CardSkeleton>
                </div>
                <CardSkeleton description={false}>
                    <FormSkeleton fields={3} submit={false} />
                </CardSkeleton>
                <CardSkeleton description={false}>
                    <FormSkeleton fields={1} />
                </CardSkeleton>
            </div>
        </LoadingRegion>
    );
}
