"use client";

import { useEffect } from "react";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { captureClientException } from "@/lib/analytics";

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error(error);
        captureClientException(error, { digest: error.digest });
    }, [error]);

    return (
        <Page>
            <PageHeader
                title="Something went wrong"
                description={error.message || "An unexpected error occurred."}
                action={<Button onClick={reset}>Try again</Button>}
            />
        </Page>
    );
}
