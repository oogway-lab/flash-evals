ALTER TABLE "datasets" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "judge_configs" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pipelines" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_drafts" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_optimization_attempts" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_schema_generation_attempts" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_validation_attempts" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prompts" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "project_id" SET NOT NULL;