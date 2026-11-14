ALTER TYPE "public"."cell_status" ADD VALUE 'skipped';--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD COLUMN "run_condition" jsonb;