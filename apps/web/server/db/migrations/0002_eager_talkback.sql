ALTER TABLE "run_cells" ADD COLUMN "schema_violation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "run_cells" ADD COLUMN "max_tokens" integer;