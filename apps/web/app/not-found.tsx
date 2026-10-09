import Link from "next/link";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
    return (
        <Page>
            <PageHeader
                title="Page not found"
                description="The resource you are looking for does not exist or may have been removed."
                action={
                    <Link href="/" className={buttonVariants()}>
                        Go to dashboard
                    </Link>
                }
            />
        </Page>
    );
}
