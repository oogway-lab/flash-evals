"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function AccessDeniedSignOutButton() {
    const { signOut } = useClerk();
    const [pending, setPending] = useState(false);
    return (
        <Button
            type="button"
            loading={pending}
            loadingText="Signing out…"
            onClick={async () => {
                setPending(true);
                try {
                    await signOut({ redirectUrl: "/sign-in" });
                } catch {
                    setPending(false);
                }
            }}
        >
            Sign out
        </Button>
    );
}
