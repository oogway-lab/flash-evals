import {
    LoadingRegion,
    PageHeaderSkeleton,
} from "@/components/layout/skeletons";
import { PromptWorkbenchSkeleton } from "@/components/prompts/prompt-workbench-skeleton";

export default function NewPromptLoading() {
    return (
        <LoadingRegion label="prompt workbench">
            <PageHeaderSkeleton breadcrumbs description />
            <PromptWorkbenchSkeleton />
        </LoadingRegion>
    );
}
