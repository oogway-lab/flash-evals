ALTER TABLE "prompt_versions" ADD COLUMN "reasoning_config" jsonb;--> statement-breakpoint
ALTER TABLE "run_models" ADD COLUMN "reasoning_config" jsonb;