import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { isDevAuthEnabled } from "@/server/auth/mode";
import { AuthCardSkeleton, AuthPanel } from "@/components/layout/auth-panel";

export default function SignUpPage() {
    if (isDevAuthEnabled()) {
        redirect("/");
    }

    return (
        <AuthPanel>
            <SignUp fallback={<AuthCardSkeleton />} />
        </AuthPanel>
    );
}
