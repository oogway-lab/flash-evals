-- Backfill authored judge prompts from the legacy standalone judge_configs.
-- Historical runs keep runs.judge_config_id so they continue to re-score through
-- the legacy path; new runs select the prompt version created here.
CREATE TEMP TABLE "_legacy_judge_prompt_backfill" ON COMMIT DROP AS
SELECT
    "id" AS "judge_config_id",
    "team_id",
    "name",
    "model_id",
    "rubric_prompt",
    "created_at",
    gen_random_uuid() AS "prompt_id",
    gen_random_uuid() AS "prompt_version_id"
FROM "judge_configs";
--> statement-breakpoint
INSERT INTO "prompts" (
    "id",
    "team_id",
    "name",
    "scope",
    "kind",
    "target_model_id",
    "created_at"
)
SELECT
    "prompt_id",
    "team_id",
    "name",
    'shared'::"prompt_scope",
    'judge'::"prompt_kind",
    "model_id",
    "created_at"
FROM "_legacy_judge_prompt_backfill";
--> statement-breakpoint
INSERT INTO "prompt_versions" (
    "id",
    "prompt_id",
    "version",
    "content",
    "status",
    "judge_spec",
    "created_at"
)
SELECT
    "prompt_version_id",
    "prompt_id",
    1,
    "rubric_prompt",
    'runnable'::"prompt_version_status",
    jsonb_build_object(
        'modelId',
        "model_id",
        'declaredInputs',
        jsonb_build_array('task_input', 'candidate_output', 'reference')
    ),
    "created_at"
FROM "_legacy_judge_prompt_backfill";
