import {
    CardSkeleton,
    FormSkeleton,
    LoadingRegion,
    PageHeaderSkeleton,
    SectionHeadingSkeleton,
} from "@/components/layout/skeletons";

export default function SettingsLoading() {
    return (
        <LoadingRegion label="settings">
            <PageHeaderSkeleton description />
            <div className="flex max-w-3xl flex-col gap-10">
                <section className="flex flex-col gap-4">
                    <SectionHeadingSkeleton description />
                    <FormSkeleton fields={1} className="gap-4" />
                </section>
                <section className="flex flex-col gap-4">
                    <SectionHeadingSkeleton description />
                    <CardSkeleton>
                        <FormSkeleton fields={2} className="gap-4" />
                    </CardSkeleton>
                </section>
                <section className="flex flex-col gap-4">
                    <SectionHeadingSkeleton description />
                    <CardSkeleton lines={3} />
                    <CardSkeleton lines={2} />
                </section>
            </div>
        </LoadingRegion>
    );
}
