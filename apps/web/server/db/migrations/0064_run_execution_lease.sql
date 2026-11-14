ALTER TABLE "runs" ADD COLUMN "execution_lease_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "execution_lease_at" timestamp with time zone;