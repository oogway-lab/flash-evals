import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

// Clerk's card is ~400px wide and ~30rem tall. Reserve that box so the page
// doesn't jump when Clerk's JS arrives, and show a card-shaped placeholder
// until then (passed to <SignIn fallback>).
const CARD_BOX = "w-full max-w-[25rem] min-h-[30rem]";

export function AuthPanel({ children }: { children: ReactNode }) {
    return (
        <div className="flex justify-center py-12">
            <div data-slot="auth-panel" className={CARD_BOX}>
                {children}
            </div>
        </div>
    );
}

export function AuthCardSkeleton() {
    return (
        <div
            role="status"
            aria-label="Loading sign-in"
            className={`${CARD_BOX} flex flex-col gap-4 rounded-sm border border-border p-8`}
        >
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="mt-auto h-4 w-48 self-center" />
        </div>
    );
}
