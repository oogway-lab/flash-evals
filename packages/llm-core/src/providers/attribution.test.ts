import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    gatewayAttributionHeaders,
    openRouterAttributionHeaders,
} from "./attribution.js";

const DEFAULT_HEADERS = {
    "http-referer": "https://flashevals.dev",
    "x-title": "Flash Evals",
};

beforeEach(() => {
    vi.stubEnv("MOSAIC_GATEWAY_HTTP_REFERER", "");
    vi.stubEnv("MOSAIC_GATEWAY_APP_TITLE", "");
    vi.stubEnv("MOSAIC_PROVIDER_ATTRIBUTION", "");
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("gatewayAttributionHeaders", () => {
    it("defaults to Flash Evals", () => {
        expect(gatewayAttributionHeaders()).toEqual(DEFAULT_HEADERS);
    });

    it("uses configured values", () => {
        vi.stubEnv("MOSAIC_GATEWAY_HTTP_REFERER", " https://evals.test ");
        vi.stubEnv("MOSAIC_GATEWAY_APP_TITLE", "Flash Evals staging");

        expect(gatewayAttributionHeaders()).toEqual({
            "http-referer": "https://evals.test",
            "x-title": "Flash Evals staging",
        });
    });

    it("sends nothing when attribution is turned off", () => {
        vi.stubEnv("MOSAIC_PROVIDER_ATTRIBUTION", "OFF");

        expect(gatewayAttributionHeaders()).toEqual({});
    });

    it("falls back with a warning instead of sending an unsendable value", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubEnv("MOSAIC_GATEWAY_APP_TITLE", "Flash Evals — staging");

        const headers = gatewayAttributionHeaders();

        expect(headers).toEqual(DEFAULT_HEADERS);
        expect(() => new Headers(headers)).not.toThrow();
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("MOSAIC_GATEWAY_APP_TITLE"),
        );
    });
});

describe("openRouterAttributionHeaders", () => {
    it("attributes requests to openrouter.ai", () => {
        expect(
            openRouterAttributionHeaders("https://openrouter.ai/api/v1"),
        ).toEqual(DEFAULT_HEADERS);
    });

    it.each([
        "https://or-proxy.example.com/api/v1",
        "https://openrouter.ai.example.com/api/v1",
        "not a url",
        undefined,
    ])("sends nothing to %s", (url) => {
        expect(openRouterAttributionHeaders(url)).toEqual({});
    });
});
