import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { isDevAuthEnabled } from "@/server/auth/mode";
import { AuthCardSkeleton, AuthPanel } from "@/components/layout/auth-panel";

export default function SignUpPage() {
    if (isDevAuthEnabled()) {
        redirect("/dashboard");
    }

    return (
        <AuthPanel>
            <SignUp
                forceRedirectUrl="/dashboard"
                fallback={<AuthCardSkeleton />}
            />
        </AuthPanel>
    );
}
