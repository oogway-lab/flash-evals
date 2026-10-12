import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { isDevAuthEnabled } from "@/server/auth/mode";
import { AuthCardSkeleton, AuthPanel } from "@/components/layout/auth-panel";

export default function SignInPage() {
    if (isDevAuthEnabled()) {
        redirect("/dashboard");
    }

    return (
        <AuthPanel>
            <SignIn
                forceRedirectUrl="/dashboard"
                fallback={<AuthCardSkeleton />}
            />
        </AuthPanel>
    );
}
