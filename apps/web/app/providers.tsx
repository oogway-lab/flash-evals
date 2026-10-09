"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { trackProductEvent } from "@/lib/analytics";

export function AppProviders({ children }: { children: ReactNode }) {
    const pathname = usePathname();

    useEffect(() => {
        trackProductEvent("page_view", { path: pathname });
    }, [pathname]);

    return children;
}
