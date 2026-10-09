// This file stays `middleware.ts` (not Next 16's `proxy.ts`): `proxy.ts` only
// runs on the Node.js runtime, and the OpenNext Cloudflare adapter does not
// support Node.js middleware. Next prints a deprecation warning for the
// `middleware` convention; it is expected until the adapter supports `proxy`.
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isDevAuthEnabled } from "@/server/auth/mode";

const isPublicRoute = createRouteMatcher([
    "/api/health",
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/access-denied",
]);
const isApiRoute = createRouteMatcher(["/api(.*)", "/trpc(.*)"]);

const protectedMiddleware = clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req) && !isApiRoute(req)) {
        const authState = await auth();
        if (!authState.userId) {
            return NextResponse.redirect(new URL("/sign-in", req.url));
        }
    }
});

export default function middleware(req: NextRequest, event: NextFetchEvent) {
    if (isDevAuthEnabled()) {
        return NextResponse.next();
    }
    return protectedMiddleware(req, event);
}

export const config = {
    matcher: [
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|webp|ico|woff2?|ttf|map)).*)",
        "/(api|trpc)(.*)",
    ],
};
