import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.join(
    process.cwd(),
    "server/db/migrations/0049_unify_prompt_workflows.sql",
);

describe("prompt workflow unification migration", () => {
    it("seeds an input from the latest run and connects every current root", async () => {
        const sql = await readFile(MIGRATION_PATH, "utf8");

        expect(sql).toContain('"workflow"."kind" = \'prompt\'');
        expect(sql).toContain(
            'ORDER BY "run"."created_at" DESC, "run"."id" DESC',
        );
        expect(sql).toContain('\'datasetId\', "target"."dataset_id"');
        expect(sql).toContain('"dataset"."modality"');
        expect(sql).toContain('"edge"."to_node_id" = "node"."id"');
        expect(sql).toContain("SET \"kind\" = 'multi'");
    });

    it("does not rewrite historical workflow runs or cells", async () => {
        const sql = await readFile(MIGRATION_PATH, "utf8");

        expect(sql).not.toMatch(/UPDATE\s+"workflow_runs"/i);
        expect(sql).not.toMatch(
            /(?:UPDATE|DELETE FROM)\s+"workflow_run_cells"/i,
        );
        expect(sql).not.toContain('"workflow_snapshot" =');
    });
});
