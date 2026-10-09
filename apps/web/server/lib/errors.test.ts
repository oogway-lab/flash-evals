import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MosaicApiError } from "@mosaic/api-contract";
import {
    clientErrorMessage,
    errorMessage,
    GENERIC_CLIENT_ERROR_MESSAGE,
    UserFacingError,
} from "./errors";

function pgError(): Error {
    const err = new Error(
        'duplicate key value violates unique constraint "runs_pkey"',
    );
    Object.assign(err, {
        code: "23505",
        detail: "Key (id)=(44b3b840) already exists.",
        table: "runs",
    });
    return err;
}

describe("clientErrorMessage", () => {
    let consoleError: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleError.mockRestore();
    });

    it("passes through API errors", () => {
        const err = new MosaicApiError("Dataset not found.", 404);

        expect(clientErrorMessage(err)).toBe("Dataset not found.");
        expect(consoleError).not.toHaveBeenCalled();
    });

    it("passes through errors written for the user", () => {
        expect(
            clientErrorMessage(new UserFacingError("Name is required.")),
        ).toBe("Name is required.");
    });

    it("passes through auth and dataset domain errors by name", () => {
        const forbidden = new Error("You do not have access to this team.");
        forbidden.name = "ForbiddenError";

        expect(clientErrorMessage(forbidden)).toBe(
            "You do not have access to this team.",
        );
    });

    it("replaces a database error and logs it", () => {
        const err = pgError();

        const message = clientErrorMessage(err);

        expect(message).toBe(GENERIC_CLIENT_ERROR_MESSAGE);
        expect(message).not.toContain("runs_pkey");
        expect(consoleError).toHaveBeenCalledWith(
            "Unhandled server action error:",
            err,
        );
    });

    it("does not surface a cause chain", () => {
        const err = Object.assign(new Error("Failed to save"), {
            cause: pgError(),
        });

        expect(clientErrorMessage(err)).toBe(GENERIC_CLIENT_ERROR_MESSAGE);
    });

    it("replaces configuration errors that name env vars", () => {
        const err = new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
        err.name = "ObjectStorageConfigError";

        expect(clientErrorMessage(err)).toBe(GENERIC_CLIENT_ERROR_MESSAGE);
    });

    it("replaces non-Error values", () => {
        expect(clientErrorMessage("connection refused 10.0.0.4:5432")).toBe(
            GENERIC_CLIENT_ERROR_MESSAGE,
        );
    });
});

describe("errorMessage", () => {
    it("keeps the cause chain for logs and persisted failures", () => {
        const err = Object.assign(new Error("Failed to save"), {
            cause: pgError(),
        });

        expect(errorMessage(err)).toContain("runs_pkey");
    });
});
