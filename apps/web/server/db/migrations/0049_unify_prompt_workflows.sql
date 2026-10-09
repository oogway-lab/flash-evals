WITH "prompt_targets" AS MATERIALIZED (
    SELECT
        "workflow"."id" AS "workflow_id",
        (
            SELECT "run"."dataset_id"
            FROM "workflow_runs" AS "run"
            WHERE "run"."workflow_id" = "workflow"."id"
            ORDER BY "run"."created_at" DESC, "run"."id" DESC
            LIMIT 1
        ) AS "dataset_id"
    FROM "prompt_workflows" AS "workflow"
    WHERE "workflow"."kind" = 'prompt'
),
"current_roots" AS MATERIALIZED (
    SELECT "node"."workflow_id", "node"."id" AS "node_id"
    FROM "workflow_nodes" AS "node"
    INNER JOIN "prompt_targets" AS "target"
        ON "target"."workflow_id" = "node"."workflow_id"
    WHERE NOT EXISTS (
        SELECT 1
        FROM "workflow_edges" AS "edge"
        WHERE "edge"."workflow_id" = "node"."workflow_id"
          AND "edge"."to_node_id" = "node"."id"
    )
),
"inserted_inputs" AS (
    INSERT INTO "workflow_nodes" (
        "workflow_id",
        "node_key",
        "label",
        "node_type",
        "node_config",
        "eval_config"
    )
    SELECT
        "target"."workflow_id",
        'input-migration-0049',
        'Input',
        'input',
        jsonb_build_object(
            'type', 'input',
            'modality', COALESCE("dataset"."modality", 'text')
        ) || CASE
            WHEN "target"."dataset_id" IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('datasetId', "target"."dataset_id")
        END,
        '{"type":"none"}'::jsonb
    FROM "prompt_targets" AS "target"
    LEFT JOIN "datasets" AS "dataset" ON "dataset"."id" = "target"."dataset_id"
    RETURNING "workflow_id", "id"
)
INSERT INTO "workflow_edges" (
    "workflow_id",
    "from_node_id",
    "to_node_id",
    "carry_original_input"
)
SELECT
    "input"."workflow_id",
    "input"."id",
    "root"."node_id",
    false
FROM "inserted_inputs" AS "input"
INNER JOIN "current_roots" AS "root"
    ON "root"."workflow_id" = "input"."workflow_id";
--> statement-breakpoint
UPDATE "prompt_workflows" SET "kind" = 'multi' WHERE "kind" = 'prompt';
