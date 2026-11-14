CREATE TABLE "workflow_run_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"dataset_item_id" uuid NOT NULL,
	"answer" jsonb,
	"status" text NOT NULL,
	"schema_errors" jsonb,
	"cost_usd" double precision,
	"latency_ms" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_answers_workflow_run_id_dataset_item_id_unique" UNIQUE("workflow_run_id","dataset_item_id")
);
--> statement-breakpoint
ALTER TABLE "prompt_workflows" ADD COLUMN "final_answer" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_run_answers" ADD CONSTRAINT "workflow_run_answers_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_answers" ADD CONSTRAINT "workflow_run_answers_dataset_item_id_dataset_items_id_fk" FOREIGN KEY ("dataset_item_id") REFERENCES "public"."dataset_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_run_answers_workflow_run_id_idx" ON "workflow_run_answers" USING btree ("workflow_run_id");