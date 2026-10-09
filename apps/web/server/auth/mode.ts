// AUTH_DEV skips Clerk and signs every request in as MOSAIC_DEFAULT_USER_ID.
// It needs two explicit opt-ins so a copied env file on a reachable host
// cannot turn it on by accident, and it never runs with NODE_ENV=production.
// Env vars are read by literal name so they also resolve in edge middleware.
export type DevAuthState =
    "off" | "on" | "missing_opt_in" | "blocked_in_production";

export function devAuthState(): DevAuthState {
    if (process.env.AUTH_DEV !== "true") return "off";
    if (process.env.NODE_ENV === "production") return "blocked_in_production";
    if (process.env.AUTH_DEV_ALLOW_INSECURE !== "1") return "missing_opt_in";
    return "on";
}

export function isDevAuthEnabled(): boolean {
    return devAuthState() === "on";
}

export function devAuthBanner(): string | undefined {
    switch (devAuthState()) {
        case "on":
            return [
                "!!! AUTHENTICATION IS DISABLED (AUTH_DEV=true, AUTH_DEV_ALLOW_INSECURE=1) !!!",
                "Every request is signed in as MOSAIC_DEFAULT_USER_ID without Clerk.",
                "Use this only on localhost. Never expose this server to a network.",
            ].join("\n");
        case "missing_opt_in":
            return "AUTH_DEV=true is ignored without AUTH_DEV_ALLOW_INSECURE=1; Clerk sign-in is required.";
        case "blocked_in_production":
            return "AUTH_DEV=true is ignored because NODE_ENV=production; Clerk sign-in is required.";
        default:
            return undefined;
    }
}
