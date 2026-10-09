ALTER TABLE "workflow_nodes" ALTER COLUMN "prompt_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ALTER COLUMN "model_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ALTER COLUMN "eval_config" SET DEFAULT '{"type":"none"}'::jsonb;--> statement-breakpoint
ALTER TABLE "prompt_workflows" ADD COLUMN "kind" text DEFAULT 'prompt' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD COLUMN "node_type" text DEFAULT 'prompt' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD COLUMN "node_config" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_prompt_version_check" CHECK ("workflow_nodes"."node_type" <> 'prompt' or "workflow_nodes"."prompt_version_id" is not null);