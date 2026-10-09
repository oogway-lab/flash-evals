import { describe, expect, it } from "vitest";
import { ConfigError } from "../config.js";
import { ApiError } from "../errors.js";
import { errorPayload } from "./errors.js";

describe("errorPayload", () => {
    it("does not echo env-var names from configuration errors", () => {
        const { status, payload } = errorPayload(
            new ConfigError("Missing required API env: INTERNAL_API_TOKEN"),
        );

        expect(status).toBe(500);
        expect(payload.error).toBe("configuration_error");
        expect(payload.message).not.toContain("INTERNAL_API_TOKEN");
    });

    it("keeps API error messages, which are written for the caller", () => {
        const { status, payload } = errorPayload(
            new ApiError(404, "not_found", "Dataset not found."),
        );

        expect(status).toBe(404);
        expect(payload).toEqual({
            error: "not_found",
            message: "Dataset not found.",
        });
    });

    it("returns a generic message for unexpected errors", () => {
        const { payload } = errorPayload(
            new Error('relation "runs" does not exist'),
        );

        expect(payload.message).toBe("Internal server error");
    });
});
