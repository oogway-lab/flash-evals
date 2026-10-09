import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TABLES = [
    "datasets",
    "pipelines",
    "prompts",
    "prompt_drafts",
    "prompt_validation_attempts",
    "prompt_optimization_attempts",
    "prompt_schema_generation_attempts",
    "judge_configs",
    "runs",
] as const;

describe("project backfill and enforcement migrations", () => {
    it("backfills exactly the nine team-scoped resource tables idempotently", async () => {
        const sql = await readFile(
            path.join(
                process.cwd(),
                "server/db/migrations/0038_backfill_projects.sql",
            ),
            "utf8",
        );

        expect(sql).toContain('INSERT INTO "projects"');
        expect(sql).toContain("WHERE NOT EXISTS");
        for (const table of TABLES) {
            expect(sql).toContain(`UPDATE "${table}" AS "resource"`);
        }
        expect(sql.match(/UPDATE "[^"]+" AS "resource"/g)).toHaveLength(9);
        expect(sql.match(/"project_id" IS NULL/g)).toHaveLength(9);
    });

    it("enforces project ownership on exactly the same nine tables", async () => {
        const sql = await readFile(
            path.join(
                process.cwd(),
                "server/db/migrations/0039_awesome_rumiko_fujikawa.sql",
            ),
            "utf8",
        );

        for (const table of TABLES) {
            expect(sql).toContain(
                `ALTER TABLE "${table}" ALTER COLUMN "project_id" SET NOT NULL`,
            );
        }
        expect(sql.match(/SET NOT NULL/g)).toHaveLength(9);
    });
});
