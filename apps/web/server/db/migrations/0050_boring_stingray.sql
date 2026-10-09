CREATE TABLE IF NOT EXISTS "workflow_run_cell_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_cell_id" uuid NOT NULL,
	"verdict" "review_verdict" DEFAULT 'unreviewed' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_cell_annotations_workflow_run_cell_id_unique" UNIQUE("workflow_run_cell_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_run_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_notes_workflow_run_id_unique" UNIQUE("workflow_run_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_cell_annotations" ADD CONSTRAINT "workflow_run_cell_annotations_workflow_run_cell_id_workflow_run_cells_id_fk" FOREIGN KEY ("workflow_run_cell_id") REFERENCES "public"."workflow_run_cells"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_cell_annotations" ADD CONSTRAINT "workflow_run_cell_annotations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_notes" ADD CONSTRAINT "workflow_run_notes_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_notes" ADD CONSTRAINT "workflow_run_notes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_run_cell_annotations_workflow_run_cell_id_idx" ON "workflow_run_cell_annotations" USING btree ("workflow_run_cell_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_run_notes_workflow_run_id_idx" ON "workflow_run_notes" USING btree ("workflow_run_id");