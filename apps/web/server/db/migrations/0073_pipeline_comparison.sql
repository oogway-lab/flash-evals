ALTER TABLE "workflow_run_answers" ADD COLUMN "benchmark_score" double precision;--> statement-breakpoint
ALTER TABLE "workflow_run_answers" ADD COLUMN "benchmark_details" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_run_answers" ADD COLUMN "benchmark_scored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_run_answers" ADD COLUMN "judge_cost_usd" double precision;