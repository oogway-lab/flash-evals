import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { ClerkProvider } from "@clerk/nextjs";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ActiveProjectNav } from "@/components/layout/active-project-nav";
import { NavLinks } from "@/components/layout/nav-links";
import { AppToaster } from "@/components/layout/toaster";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isDevAuthEnabled } from "@/server/auth/mode";
import { clerkAppearance } from "@/lib/auth/clerk-appearance";
import { AppProviders } from "./providers";
import "./globals.css";

export const metadata = {
    title: { default: "Flash Evals", template: "%s | Flash Evals" },
    description:
        "Compare LLM models on image/text datasets with cost, latency, and scoring.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
    const authEnabled = !isDevAuthEnabled();

    const content = (
        <html
            lang="en"
            className={`${GeistSans.variable} ${GeistMono.variable}`}
        >
            {/* `isolate`: Base UI portals (dialogs, selects, menus) stack above the page. */}
            <body className="isolate">
                <TooltipProvider>
                    <a
                        href="#main-content"
                        className="sr-only rounded-sm bg-surface px-4 py-2 text-label-14 text-on-surface focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:outline-2 focus:outline-offset-2 focus:outline-ring"
                    >
                        Skip to main content
                    </a>
                    <header className="sticky top-0 z-40 border-b border-border bg-neutral">
                        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
                            <Link
                                href="/"
                                className="text-heading-16 text-on-surface hover:no-underline"
                            >
                                Flash Evals
                            </Link>
                            <Suspense
                                fallback={
                                    <Skeleton className="h-8 w-24 sm:w-40" />
                                }
                            >
                                <ActiveProjectNav />
                            </Suspense>
                            <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-3">
                                <NavLinks showAuthControls={authEnabled} />
                            </div>
                        </div>
                    </header>
                    <main
                        id="main-content"
                        className="mx-auto max-w-7xl px-4 py-10 sm:px-6"
                    >
                        <AppProviders>{children}</AppProviders>
                    </main>
                    <AppToaster />
                </TooltipProvider>
            </body>
        </html>
    );

    if (!authEnabled) return content;

    return (
        <ClerkProvider appearance={clerkAppearance}>{content}</ClerkProvider>
    );
}
