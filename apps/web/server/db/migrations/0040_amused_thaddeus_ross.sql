CREATE TYPE "public"."run_target" AS ENUM('single_item', 'dataset');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompt_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_cell_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_cell_id" uuid NOT NULL,
	"scorer_type" "scorer_type" NOT NULL,
	"score" double precision,
	"details_json" jsonb,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"carry_original_input" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_edges_workflow_id_from_node_id_to_node_id_unique" UNIQUE("workflow_id","from_node_id","to_node_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"label" text NOT NULL,
	"prompt_version_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"reasoning_config" jsonb,
	"eval_config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_nodes_workflow_id_id_unique" UNIQUE("workflow_id","id"),
	CONSTRAINT "workflow_nodes_workflow_id_node_key_unique" UNIQUE("workflow_id","node_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_run_cells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"dataset_item_id" uuid NOT NULL,
	"node_key" text NOT NULL,
	"status" "cell_status" DEFAULT 'pending' NOT NULL,
	"input_text" text DEFAULT '' NOT NULL,
	"output_json" jsonb,
	"latency_ms" double precision,
	"cost_usd" double precision,
	"error" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_cells_workflow_run_id_dataset_item_id_node_key_unique" UNIQUE("workflow_run_id","dataset_item_id","node_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"workflow_snapshot" jsonb NOT NULL,
	"run_target" "run_target" NOT NULL,
	"target_item_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_workflows" ADD CONSTRAINT "prompt_workflows_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_workflows" ADD CONSTRAINT "prompt_workflows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_workflows" ADD CONSTRAINT "prompt_workflows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_cell_scores" ADD CONSTRAINT "workflow_cell_scores_workflow_run_cell_id_workflow_run_cells_id_fk" FOREIGN KEY ("workflow_run_cell_id") REFERENCES "public"."workflow_run_cells"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_workflow_id_prompt_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."prompt_workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_from_node_workflow_fk" FOREIGN KEY ("workflow_id","from_node_id") REFERENCES "public"."workflow_nodes"("workflow_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_to_node_workflow_fk" FOREIGN KEY ("workflow_id","to_node_id") REFERENCES "public"."workflow_nodes"("workflow_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_workflow_id_prompt_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."prompt_workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_cells" ADD CONSTRAINT "workflow_run_cells_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_cells" ADD CONSTRAINT "workflow_run_cells_dataset_item_id_dataset_items_id_fk" FOREIGN KEY ("dataset_item_id") REFERENCES "public"."dataset_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_prompt_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."prompt_workflows"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_target_item_id_dataset_items_id_fk" FOREIGN KEY ("target_item_id") REFERENCES "public"."dataset_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_workflows_team_id_idx" ON "prompt_workflows" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_workflows_project_id_idx" ON "prompt_workflows" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_cell_scores_workflow_run_cell_id_idx" ON "workflow_cell_scores" USING btree ("workflow_run_cell_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_edges_workflow_id_idx" ON "workflow_edges" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_edges_from_node_id_idx" ON "workflow_edges" USING btree ("from_node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_edges_to_node_id_idx" ON "workflow_edges" USING btree ("to_node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_nodes_workflow_id_idx" ON "workflow_nodes" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_run_cells_workflow_run_id_idx" ON "workflow_run_cells" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_run_cells_dataset_item_id_idx" ON "workflow_run_cells" USING btree ("dataset_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_run_cells_lookup_idx" ON "workflow_run_cells" USING btree ("workflow_run_id","dataset_item_id","node_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_team_id_idx" ON "workflow_runs" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_project_id_idx" ON "workflow_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_workflow_id_idx" ON "workflow_runs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_dataset_id_idx" ON "workflow_runs" USING btree ("dataset_id");
