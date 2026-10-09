import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../db/client", () => ({ db: {} }));

import {
    DEFAULT_JUDGE_DECLARED_INPUTS,
    legacyJudgeSpec,
    normalizeJudgeDeclaredInputs,
} from "./service";

describe("judge prompt migration helpers", () => {
    it("uses the legacy judge model and all available legacy inputs", () => {
        expect(legacyJudgeSpec("gpt-4o-mini")).toEqual({
            modelId: "gpt-4o-mini",
            declaredInputs: DEFAULT_JUDGE_DECLARED_INPUTS,
        });
    });

    it("normalizes declared inputs and keeps candidate output as the fallback", () => {
        expect(
            normalizeJudgeDeclaredInputs([
                "reference",
                "reference",
                "candidate_output",
            ]),
        ).toEqual(["reference", "candidate_output"]);
        expect(normalizeJudgeDeclaredInputs([])).toEqual(["candidate_output"]);
    });

    it("backfills one judge prompt version from each existing judge config", () => {
        const migration = readFileSync(
            join(
                process.cwd(),
                "server/db/migrations/0017_backfill_legacy_judge_configs.sql",
            ),
            "utf8",
        );

        expect(migration).toContain('FROM "judge_configs"');
        expect(migration).toContain('INSERT INTO "prompts"');
        expect(migration).toContain("'judge'::\"prompt_kind\"");
        expect(migration).toContain('INSERT INTO "prompt_versions"');
        expect(migration).toContain('"rubric_prompt"');
        expect(migration).toContain('"model_id"');
        expect(migration).toContain("'candidate_output'");
    });
});
