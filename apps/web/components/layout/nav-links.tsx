"use client";

import { useEffect, useId, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

const links: ReadonlyArray<{ href: Route; label: string }> = [
    { href: "/", label: "Dashboard" },
    { href: "/datasets", label: "Datasets" },
    { href: "/prompts", label: "Prompts" },
    // The product name is "Pipelines". The route, API and code identifiers
    // keep the old "multiworkflow" name; renaming the URL is a separate change.
    { href: "/multiworkflow", label: "Pipelines" },
    { href: "/runs", label: "Runs" },
    { href: "/settings", label: "Settings" },
];

/** The dashboard lives at `/`; `/dashboard` renders the same page. */
function isActiveLink(pathname: string, href: string) {
    if (href === "/") return pathname === "/" || pathname === "/dashboard";
    return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({
    showAuthControls = true,
}: {
    showAuthControls?: boolean;
}) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const menuId = useId();

    const isActive = (href: string) => isActiveLink(pathname, href);

    useEffect(() => {
        setOpen(false);
    }, [pathname]);

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [open]);

    return (
        <>
            <div className="hidden items-center gap-4 lg:flex">
                <nav className="flex items-center gap-1">
                    {links.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={cn(
                                "rounded-sm px-3 py-1.5 text-label-14 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                                isActive(link.href)
                                    ? "bg-muted text-on-surface"
                                    : "text-muted-foreground hover:bg-muted/60 hover:text-on-surface",
                            )}
                        >
                            {link.label}
                        </Link>
                    ))}
                </nav>
                {showAuthControls ? <AuthControls /> : null}
            </div>

            <div className="lg:hidden">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-expanded={open}
                    aria-controls={menuId}
                    aria-label={
                        open ? "Close navigation menu" : "Open navigation menu"
                    }
                    onClick={() => setOpen((prev) => !prev)}
                >
                    {open ? (
                        <X className="size-5" aria-hidden="true" />
                    ) : (
                        <Menu className="size-5" aria-hidden="true" />
                    )}
                </Button>

                {open ? (
                    <nav
                        id={menuId}
                        className="absolute left-0 right-0 top-16 z-40 border-b border-border bg-neutral px-4 py-3 sm:px-6"
                    >
                        <ul className="flex flex-col gap-1">
                            {links.map((link) => (
                                <li key={link.href}>
                                    <Link
                                        href={link.href}
                                        onClick={() => setOpen(false)}
                                        className={cn(
                                            "flex min-h-10 items-center rounded-sm px-3 py-2 text-label-14 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                                            isActive(link.href)
                                                ? "bg-muted text-on-surface"
                                                : "text-muted-foreground hover:bg-muted/60 hover:text-on-surface",
                                        )}
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                            {showAuthControls ? (
                                <li className="flex min-h-10 items-center pt-2">
                                    <AuthControls className="w-full" />
                                </li>
                            ) : null}
                        </ul>
                    </nav>
                ) : null}
            </div>
        </>
    );
}

function AuthControls({ className }: { className?: string }) {
    const { isLoaded, isSignedIn } = useUser();

    if (!isLoaded) return null;
    if (isSignedIn) return <UserButton />;

    return (
        <SignInButton mode="redirect">
            <Button
                type="button"
                variant="secondary"
                size="sm"
                className={className}
            >
                Sign in
            </Button>
        </SignInButton>
    );
}
