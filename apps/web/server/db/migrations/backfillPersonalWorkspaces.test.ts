import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = path.join(
    process.cwd(),
    "server/db/migrations/0037_backfill_personal_workspaces.sql",
);

describe("personal workspace reset migration", () => {
    it("explicitly resets only the team-rooted application graph", async () => {
        const sql = await readFile(MIGRATION_PATH, "utf8");
        const statements = sql
            .split("\n")
            .filter((line) => !line.trimStart().startsWith("--"))
            .join("\n")
            .trim();

        expect(statements).toBe('TRUNCATE TABLE "teams" CASCADE;');
        expect(sql).toContain("no production users or");
        expect(sql).toContain("personal-workspace + Default-project flow");
        expect(sql).not.toMatch(/DROP\s+(?:TABLE|SCHEMA|DATABASE)/i);
        expect(sql).not.toMatch(/TRUNCATE\s+TABLE\s+(?:users|projects|datasets)/i);
    });
});
