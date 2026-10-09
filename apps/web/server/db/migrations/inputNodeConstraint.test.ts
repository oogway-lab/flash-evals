import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.join(
    process.cwd(),
    "server/db/migrations/0048_allow_input_nodes_without_models.sql",
);

describe("input workflow node model constraint migration", () => {
    it("replaces only the model constraint and exempts input nodes", async () => {
        const sql = await readFile(MIGRATION_PATH, "utf8");

        expect(sql).toContain(
            'DROP CONSTRAINT "workflow_nodes_model_id_check"',
        );
        expect(sql).toContain('ADD CONSTRAINT "workflow_nodes_model_id_check"');
        expect(sql).toContain("in ('metric_compare', 'input')");
        expect(sql).not.toMatch(/(?:CREATE|DROP) TABLE/i);
    });
});
