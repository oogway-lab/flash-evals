import { describe, expect, it } from "vitest";
import {
    ApiUnauthorizedError,
    assertInternalToken,
    hasValidInternalToken,
    secretsEqual,
} from "./auth.js";

describe("assertInternalToken", () => {
    it("accepts a matching internal API token", () => {
        const request = new Request("https://api.example.com", {
            headers: { "x-mosaic-internal-token": "token" },
        });

        expect(() =>
            assertInternalToken(request, { internalApiToken: "token" }),
        ).not.toThrow();
    });

    it("rejects missing runtime token configuration", () => {
        const request = new Request("https://api.example.com");

        expect(() => assertInternalToken(request, {})).toThrowError(
            new ApiUnauthorizedError("Internal API token is not configured"),
        );
    });

    it("rejects mismatched request tokens", () => {
        const request = new Request("https://api.example.com", {
            headers: { "x-mosaic-internal-token": "wrong" },
        });

        expect(() =>
            assertInternalToken(request, { internalApiToken: "token" }),
        ).toThrowError(new ApiUnauthorizedError());
    });

    it("rejects tokens of a different length without throwing a RangeError", () => {
        const request = new Request("https://api.example.com", {
            headers: { "x-mosaic-internal-token": "token-but-longer" },
        });

        expect(() =>
            assertInternalToken(request, { internalApiToken: "token" }),
        ).toThrowError(new ApiUnauthorizedError());
    });

    it("rejects a missing request token", () => {
        const request = new Request("https://api.example.com");

        expect(() =>
            assertInternalToken(request, { internalApiToken: "token" }),
        ).toThrowError(new ApiUnauthorizedError());
    });
});

describe("hasValidInternalToken", () => {
    it("is true only for the configured token", () => {
        const withToken = (value: string) =>
            new Request("https://api.example.com", {
                headers: { "x-mosaic-internal-token": value },
            });

        expect(
            hasValidInternalToken(withToken("token"), {
                internalApiToken: "token",
            }),
        ).toBe(true);
        expect(
            hasValidInternalToken(withToken("toke"), {
                internalApiToken: "token",
            }),
        ).toBe(false);
        expect(hasValidInternalToken(withToken("token"), {})).toBe(false);
    });
});

describe("secretsEqual", () => {
    it("compares by value regardless of length", () => {
        expect(secretsEqual("abc", "abc")).toBe(true);
        expect(secretsEqual("abc", "abd")).toBe(false);
        expect(secretsEqual("", "abc")).toBe(false);
        expect(secretsEqual("abcd", "abc")).toBe(false);
    });
});
