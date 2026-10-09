import { describe, expect, it, vi } from "vitest";
import {
    DELETE_ITEM_BLOCKED_MESSAGE,
    DeleteItemBlockedError,
    isForeignKeyViolation,
    isUniqueViolation,
    validateDatasetSchemaInput,
} from "./service";
import type { FieldRule, JsonSchemaObject } from "../db/jsonTypes";

vi.mock("../db/client", () => ({ db: {} }));

const schema: JsonSchemaObject = {
    type: "object",
    additionalProperties: false,
    required: ["answer"],
    properties: {
        answer: { type: "string" },
    },
};

describe("validateDatasetSchemaInput", () => {
    it("accepts a renderable schema whose field rules reference schema fields", () => {
        const result = validateDatasetSchemaInput(schema, [
            { field: "answer", matcher: "exact" },
        ]);

        expect(result).toEqual({ ok: true });
    });

    it("rejects unrenderable schemas before persistence", () => {
        const invalid: JsonSchemaObject = {
            type: "object",
            properties: {
                answer: { type: "string", enum: ["yes"] },
            },
        };

        expect(validateDatasetSchemaInput(invalid, [])).toMatchObject({
            ok: false,
            field: "jsonSchema",
            error: expect.stringContaining("unsupported"),
        });
    });

    it("rejects field rules that reference fields absent from the schema", () => {
        const rules: FieldRule[] = [{ field: "missing", matcher: "exact" }];

        expect(validateDatasetSchemaInput(schema, rules)).toMatchObject({
            ok: false,
            field: "fieldRules",
            error: expect.stringContaining("missing"),
        });
    });
});

describe("delete item helpers", () => {
    it("recognizes Postgres foreign-key violations for delete-race fallback", () => {
        expect(isForeignKeyViolation({ code: "23503" })).toBe(true);
        expect(isForeignKeyViolation({ code: "22001" })).toBe(false);
        expect(isForeignKeyViolation(new Error("boom"))).toBe(false);
    });

    it("uses a stable blocked-delete message", () => {
        expect(new DeleteItemBlockedError().message).toBe(
            DELETE_ITEM_BLOCKED_MESSAGE,
        );
    });

    it("only recognizes the dataset source-name unique index for duplicate filenames", () => {
        expect(
            isUniqueViolation({
                code: "23505",
                constraint: "dataset_items_dataset_source_name_idx",
            }),
        ).toBe(true);
        expect(
            isUniqueViolation({
                code: "23505",
                constraint: "users_email_unique",
            }),
        ).toBe(false);
        expect(isUniqueViolation({ code: "22001" })).toBe(false);
    });
});
