"use client";

import * as React from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** The in-app link a click would follow, or undefined to let it through. */
function guardedHref(event: MouseEvent): Route | undefined {
    if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    ) {
        return undefined;
    }
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return undefined;
    if (anchor.target && anchor.target !== "_self") return undefined;
    if (anchor.hasAttribute("download")) return undefined;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return undefined;
    // Same page (e.g. a hash link): nothing is lost.
    if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
    ) {
        return undefined;
    }
    // The href comes from the DOM, so it cannot be checked against the route table.
    return `${url.pathname}${url.search}${url.hash}` as Route;
}

/**
 * While `when` is true, leaving the page asks first: the browser's own prompt
 * for reloads, closing the tab and external navigation, and a confirmation
 * dialog for in-app links (sidebar, breadcrumbs, any `<Link>`).
 */
export function UnsavedChangesGuard({ when }: { when: boolean }) {
    const router = useRouter();
    const [pendingHref, setPendingHref] = React.useState<Route>();

    React.useEffect(() => {
        if (!when) return;
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
        };
        // Capture phase on the document runs before Next's <Link> handler.
        const onClick = (event: MouseEvent) => {
            const href = guardedHref(event);
            if (!href) return;
            event.preventDefault();
            event.stopPropagation();
            setPendingHref(href);
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        document.addEventListener("click", onClick, true);
        return () => {
            window.removeEventListener("beforeunload", onBeforeUnload);
            document.removeEventListener("click", onClick, true);
        };
    }, [when]);

    return (
        <ConfirmDialog
            open={pendingHref !== undefined}
            onOpenChange={(open) => {
                if (!open) setPendingHref(undefined);
            }}
            title="Leave without saving?"
            description="You have unsaved changes on this page. They’ll be lost if you leave now."
            confirmLabel="Leave page"
            onConfirm={() => {
                const href = pendingHref;
                setPendingHref(undefined);
                if (href) router.push(href);
            }}
        />
    );
}
