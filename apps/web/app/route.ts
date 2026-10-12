import marketing from "@/generated/marketing.json";

// A Route Handler serves the complete Astro document without the React app shell.
// Never cache the entry point: middleware chooses it or /dashboard per session.
export const dynamic = "force-dynamic";

export function GET() {
    return new Response(marketing.html, {
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "private, no-store",
        },
    });
}
