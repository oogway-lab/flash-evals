import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { devAuthBanner, devAuthState, isDevAuthEnabled } from "./mode";

describe("dev auth mode", () => {
    beforeEach(() => {
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("AUTH_DEV", "");
        vi.stubEnv("AUTH_DEV_ALLOW_INSECURE", "");
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("is off by default", () => {
        expect(devAuthState()).toBe("off");
        expect(isDevAuthEnabled()).toBe(false);
        expect(devAuthBanner()).toBeUndefined();
    });

    it("stays off when AUTH_DEV is set without the insecure opt-in", () => {
        vi.stubEnv("AUTH_DEV", "true");

        expect(devAuthState()).toBe("missing_opt_in");
        expect(isDevAuthEnabled()).toBe(false);
        expect(devAuthBanner()).toContain(
            "AUTH_DEV=true is ignored without AUTH_DEV_ALLOW_INSECURE=1",
        );
    });

    it("turns on only with both AUTH_DEV and AUTH_DEV_ALLOW_INSECURE", () => {
        vi.stubEnv("AUTH_DEV", "true");
        vi.stubEnv("AUTH_DEV_ALLOW_INSECURE", "1");

        expect(devAuthState()).toBe("on");
        expect(isDevAuthEnabled()).toBe(true);
        expect(devAuthBanner()).toContain("AUTHENTICATION IS DISABLED");
    });

    it("ignores other opt-in spellings", () => {
        vi.stubEnv("AUTH_DEV", "true");
        vi.stubEnv("AUTH_DEV_ALLOW_INSECURE", "yes");

        expect(isDevAuthEnabled()).toBe(false);
    });

    it("never turns on in production", () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("AUTH_DEV", "true");
        vi.stubEnv("AUTH_DEV_ALLOW_INSECURE", "1");

        expect(devAuthState()).toBe("blocked_in_production");
        expect(isDevAuthEnabled()).toBe(false);
        expect(devAuthBanner()).toContain(
            "ignored because NODE_ENV=production",
        );
    });
});
