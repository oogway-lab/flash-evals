ALTER TABLE "prompt_optimization_attempts" DROP COLUMN IF EXISTS "target_model_family";--> statement-breakpoint
ALTER TABLE "prompts" DROP COLUMN IF EXISTS "target_model_family";