ALTER TYPE "public"."run_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "stop_reason" text;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_stop_reason_check" CHECK ("runs"."stop_reason" is null or "runs"."stop_reason" in ('cancelled'));