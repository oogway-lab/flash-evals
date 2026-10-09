-- Ensure every workspace, including Legacy shared workspaces with no remaining
-- member, has one canonical Default project. created_by is nullable for those
-- ownerless workspaces by design.
INSERT INTO "projects" ("team_id", "name", "created_by")
SELECT
    "teams"."id",
    'Default',
    COALESCE(
        "teams"."owner_user_id",
        (
            SELECT "users"."id"
            FROM "users"
            WHERE "users"."team_id" = "teams"."id"
            ORDER BY "users"."created_at", "users"."id"
            LIMIT 1
        )
    )
FROM "teams"
WHERE NOT EXISTS (
    SELECT 1 FROM "projects"
    WHERE "projects"."team_id" = "teams"."id"
      AND "projects"."name" = 'Default'
);
--> statement-breakpoint

WITH "default_projects" AS (
    SELECT DISTINCT ON ("team_id") "id", "team_id"
    FROM "projects"
    WHERE "name" = 'Default'
    ORDER BY "team_id", "created_at", "id"
)
UPDATE "datasets" AS "resource"
SET "project_id" = "default_projects"."id"
FROM "default_projects"
WHERE "resource"."team_id" = "default_projects"."team_id"
  AND "resource"."project_id" IS NULL;
--> statement-breakpoint

WITH "default_projects" AS (
    SELECT DISTINCT ON ("team_id") "id", "team_id" FROM "projects"
    WHERE "name" = 'Default' ORDER BY "team_id", "created_at", "id"
)
UPDATE "pipelines" AS "resource" SET "project_id" = "default_projects"."id"
FROM "default_projects" WHERE "resource"."team_id" = "default_projects"."team_id" AND "resource"."project_id" IS NULL;
--> statement-breakpoint

WITH "default_projects" AS (
    SELECT DISTINCT ON ("team_id") "id", "team_id" FROM "projects"
    WHERE "name" = 'Default' ORDER BY "team_id", "created_at", "id"
)
UPDATE "prompts" AS "resource" SET "project_id" = "default_projects"."id"
FROM "default_projects" WHERE "resource"."team_id" = "default_projects"."team_id" AND "resource"."project_id" IS NULL;
--> statement-breakpoint

WITH "default_projects" AS (
    SELECT DISTINCT ON ("team_id") "id", "team_id" FROM "projects"
    WHERE "name" = 'Default' ORDER BY "team_id", "created_at", "id"
)
UPDATE "prompt_drafts" AS "resource" SET "project_id" = "default_projects"."id"
FROM "default_projects" WHERE "resource"."team_id" = "default_projects"."team_id" AND "resource"."project_id" IS NULL;
--> statement-breakpoint

WITH "default_projects" AS (
    SELECT DISTINCT ON ("team_id") "id", "team_id" FROM "projects"
    WHERE "name" = 'Default' ORDER BY "team_id", "created_at", "id"
)
UPDATE "prompt_validation_attempts" AS "resource" SET "project_id" = "default_projects"."id"
FROM "default_projects" WHERE "resource"."team_id" = "default_projects"."team_id" AND "resource"."project_id" IS NULL;
--> statement-breakpoint

WITH "default_projects" AS (
    SELECT DISTINCT ON ("team_id") "id", "team_id" FROM "projects"
    WHERE "name" = 'Default' ORDER BY "team_id", "created_at", "id"
)
UPDATE "prompt_optimization_attempts" AS "resource" SET "project_id" = "default_projects"."id"
FROM "default_projects" WHERE "resource"."team_id" = "default_projects"."team_id" AND "resource"."project_id" IS NULL;
--> statement-breakpoint

WITH "default_projects" AS (
    SELECT DISTINCT ON ("team_id") "id", "team_id" FROM "projects"
    WHERE "name" = 'Default' ORDER BY "team_id", "created_at", "id"
)
UPDATE "prompt_schema_generation_attempts" AS "resource" SET "project_id" = "default_projects"."id"
FROM "default_projects" WHERE "resource"."team_id" = "default_projects"."team_id" AND "resource"."project_id" IS NULL;
--> statement-breakpoint

WITH "default_projects" AS (
    SELECT DISTINCT ON ("team_id") "id", "team_id" FROM "projects"
    WHERE "name" = 'Default' ORDER BY "team_id", "created_at", "id"
)
UPDATE "judge_configs" AS "resource" SET "project_id" = "default_projects"."id"
FROM "default_projects" WHERE "resource"."team_id" = "default_projects"."team_id" AND "resource"."project_id" IS NULL;
--> statement-breakpoint

WITH "default_projects" AS (
    SELECT DISTINCT ON ("team_id") "id", "team_id" FROM "projects"
    WHERE "name" = 'Default' ORDER BY "team_id", "created_at", "id"
)
UPDATE "runs" AS "resource" SET "project_id" = "default_projects"."id"
FROM "default_projects" WHERE "resource"."team_id" = "default_projects"."team_id" AND "resource"."project_id" IS NULL;
