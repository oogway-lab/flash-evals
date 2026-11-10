ALTER TABLE "workflow_run_cells" ADD COLUMN "judge_cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "config_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "stop_reason" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_stop_reason_check" CHECK ("workflow_runs"."stop_reason" is null or "workflow_runs"."stop_reason" in ('cancelled', 'spend_cap'));