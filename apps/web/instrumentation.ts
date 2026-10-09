import { devAuthBanner } from "@/server/auth/mode";

// Runs once when the Next.js server starts.
export function register(): void {
    const banner = devAuthBanner();
    if (!banner) return;
    const rule = "=".repeat(78);
    console.warn(`\n${rule}\n${banner}\n${rule}\n`);
}
