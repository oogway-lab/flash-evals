UPDATE "workflow_nodes"
SET "model_id" = "node_config"->'sttConfig'->>'modelId'
WHERE "node_type" = 'stt' AND "model_id" IS NULL;--> statement-breakpoint
UPDATE "workflow_nodes"
SET "model_id" = "node_config"->'transliteration'->>'modelId'
WHERE "node_type" = 'transliterate' AND "model_id" IS NULL;--> statement-breakpoint
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "workflow_nodes"
        WHERE "node_type" <> 'metric_compare' AND "model_id" IS NULL
    ) THEN
        RAISE EXCEPTION 'workflow_nodes contains model-carrying nodes without model_id';
    END IF;
END $$;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_model_id_check" CHECK ("workflow_nodes"."node_type" = 'metric_compare' or "workflow_nodes"."model_id" is not null);
