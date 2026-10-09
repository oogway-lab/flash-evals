CREATE TYPE "public"."review_verdict" AS ENUM('unreviewed', 'approved', 'needs_review', 'issue');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_cell_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_cell_id" uuid NOT NULL,
	"verdict" "review_verdict" DEFAULT 'unreviewed' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_cell_annotations_run_cell_id_unique" UNIQUE("run_cell_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_notes_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_cell_annotations" ADD CONSTRAINT "run_cell_annotations_run_cell_id_run_cells_id_fk" FOREIGN KEY ("run_cell_id") REFERENCES "public"."run_cells"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_cell_annotations" ADD CONSTRAINT "run_cell_annotations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_notes" ADD CONSTRAINT "run_notes_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_notes" ADD CONSTRAINT "run_notes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_cell_annotations_run_cell_id_idx" ON "run_cell_annotations" USING btree ("run_cell_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_notes_run_id_idx" ON "run_notes" USING btree ("run_id");