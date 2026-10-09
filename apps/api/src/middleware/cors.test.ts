import { describe, expect, it } from "vitest";
import { corsHeaders, isOriginAllowed, preflightResponse } from "./cors.js";

const config = {
    corsOrigins: ["https://web.example.com"],
};

describe("CORS middleware", () => {
    it("allows configured Cloudflare origin", () => {
        expect(isOriginAllowed("https://web.example.com", config)).toBe(true);
        expect(corsHeaders("https://web.example.com", config)).toMatchObject({
            "Access-Control-Allow-Origin": "https://web.example.com",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Expose-Headers": "X-Request-Id",
        });
    });

    it("rejects unconfigured origins", () => {
        expect(isOriginAllowed("https://evil.example.com", config)).toBe(false);
        expect(corsHeaders("https://evil.example.com", config)).toEqual({});
    });

    it("returns 403 for disallowed preflight requests", () => {
        const response = preflightResponse(
            new Request("https://api.example.com/health", {
                method: "OPTIONS",
                headers: { origin: "https://evil.example.com" },
            }),
            config,
        );

        expect(response.status).toBe(403);
    });
});
