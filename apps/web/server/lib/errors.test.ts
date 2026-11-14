import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlashEvalsApiError } from "@flash-evals/api-contract";
import { DrizzleQueryError } from "drizzle-orm";
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
        const err = new FlashEvalsApiError("Dataset not found.", 404);

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

    it("leads a failed query with its reason and leaves the parameters out", () => {
        // How drizzle-orm wraps a failed query (DrizzleQueryError).
        const query =
            'select "transcript", "segments_json", "speakers_json", "provider_metadata", "warnings", "detected_language" from "audio_transcripts" where ("audio_transcripts"."dataset_item_id" = $1 and "audio_transcripts"."status" = $2) limit $3';
        const params = [
            "item-1",
            "completed",
            1,
            "एक लंबा प्रतिलेख ".repeat(500),
        ];
        const err = Object.assign(
            new Error(`Failed query: ${query}\nparams: ${params.join(",")}`),
            {
                query,
                params,
                cause: new Error("timeout exceeded when trying to connect"),
            },
        );

        const message = errorMessage(err);

        expect(message).toMatch(
            /^Database query failed: timeout exceeded when trying to connect \(query: select "transcript", "segments_json"/,
        );
        expect(message).not.toContain("params");
        expect(message).not.toContain("प्रतिलेख");
        expect(message.length).toBeLessThan(250);
    });

    it("reads drizzle-orm's own query error", () => {
        const err = new DrizzleQueryError(
            "select 1",
            ["एक"],
            new Error("Connection terminated unexpectedly"),
        );

        expect(errorMessage(err)).toBe(
            "Database query failed: Connection terminated unexpectedly (query: select 1)",
        );
    });

    it("names a database error code in a failed query's reason", () => {
        const err = Object.assign(
            new Error("Failed query: insert into x\nparams: "),
            {
                query: "insert into x",
                params: [],
                cause: pgError(),
            },
        );

        expect(errorMessage(err)).toBe(
            'Database query failed: 23505 duplicate key value violates unique constraint "runs_pkey" (query: insert into x)',
        );
    });

    it("says so when a failed query has no reason", () => {
        const err = Object.assign(
            new Error("Failed query: select 1\nparams: "),
            {
                query: "select 1",
                params: [],
            },
        );

        expect(errorMessage(err)).toBe(
            "Database query failed: no reason reported by the driver (query: select 1)",
        );
    });
});
