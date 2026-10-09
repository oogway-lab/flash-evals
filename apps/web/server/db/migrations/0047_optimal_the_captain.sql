ALTER TABLE "run_cells" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "run_cells" SET "claimed_at" = now() WHERE "status" = 'running';
