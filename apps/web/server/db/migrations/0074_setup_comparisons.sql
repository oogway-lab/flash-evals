CREATE TABLE "setup_comparisons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"max_cost_usd" double precision,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cancel_requested_at" timestamp with time zone,
	"created_by" uuid,
	"idempotency_key" text,
	"idempotency_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_comparisons_idempotency_unique" UNIQUE("team_id","project_id","created_by","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "setup_comparison_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "setup_comparison_id" uuid;--> statement-breakpoint
ALTER TABLE "setup_comparisons" ADD CONSTRAINT "setup_comparisons_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_comparisons" ADD CONSTRAINT "setup_comparisons_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_comparisons" ADD CONSTRAINT "setup_comparisons_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_comparisons" ADD CONSTRAINT "setup_comparisons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "setup_comparisons_project_id_idx" ON "setup_comparisons" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_setup_comparison_id_setup_comparisons_id_fk" FOREIGN KEY ("setup_comparison_id") REFERENCES "public"."setup_comparisons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_setup_comparison_id_setup_comparisons_id_fk" FOREIGN KEY ("setup_comparison_id") REFERENCES "public"."setup_comparisons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_setup_comparison_id_idx" ON "runs" USING btree ("setup_comparison_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_setup_comparison_id_idx" ON "workflow_runs" USING btree ("setup_comparison_id");