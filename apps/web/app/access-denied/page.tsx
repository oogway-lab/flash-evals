import { AccessDeniedSignOutButton } from "./sign-out-button";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { isDevAuthEnabled } from "@/server/auth/mode";
import { allowedEmailDomain, mosaicTenancyMode } from "@/server/auth/session";

export default function AccessDeniedPage() {
    const authEnabled = !isDevAuthEnabled();
    const isolated = mosaicTenancyMode() === "isolated";
    const domain = allowedEmailDomain();

    return (
        <Page>
            <PageHeader
                title="Access denied"
                description={
                    isolated
                        ? "Sign-in requires a verified email address. Sign out and verify your email to continue."
                        : domain
                          ? `This Flash Evals instance is available only to verified @${domain} accounts. Sign out and use an @${domain} email address to continue.`
                          : "Sign-in is disabled because this Flash Evals instance has no allowed email domain configured. Ask the operator to set MOSAIC_ALLOWED_EMAIL_DOMAIN."
                }
                action={authEnabled ? <AccessDeniedSignOutButton /> : undefined}
            />
        </Page>
    );
}
