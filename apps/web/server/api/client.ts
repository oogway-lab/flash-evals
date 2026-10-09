import { MosaicApiClient } from "@mosaic/api-contract";

export class WebApiConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WebApiConfigError";
    }
}

export function serverApiClient(): MosaicApiClient {
    const { baseUrl, internalToken } = serverApiConfig();
    return new MosaicApiClient({
        baseUrl,
        internalToken,
    });
}

export function serverApiConfig(): { baseUrl: string; internalToken?: string } {
    const baseUrl =
        process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
    if (!baseUrl) {
        throw new WebApiConfigError(
            "Missing API_BASE_URL or NEXT_PUBLIC_API_BASE_URL for Flash Evals API calls",
        );
    }
    if (
        process.env.NODE_ENV === "production" &&
        !process.env.INTERNAL_API_TOKEN
    ) {
        throw new WebApiConfigError(
            "Missing INTERNAL_API_TOKEN for Flash Evals API calls",
        );
    }

    return {
        baseUrl,
        internalToken: process.env.INTERNAL_API_TOKEN,
    };
}
