CREATE TABLE IF NOT EXISTS "workflow_run_item_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_item_id" uuid NOT NULL,
	"scorer_type" "scorer_type" NOT NULL,
	"status" text NOT NULL,
	"score" double precision,
	"details_json" jsonb,
	"rationale" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_item_scores_workflow_run_item_id_scorer_type_unique" UNIQUE("workflow_run_item_id","scorer_type"),
	CONSTRAINT "workflow_run_item_scores_scorer_type_check" CHECK ("workflow_run_item_scores"."scorer_type"::text in ('transcript_metric', 'transcript_judge')),
	CONSTRAINT "workflow_run_item_scores_status_check" CHECK ("workflow_run_item_scores"."status" in ('completed', 'skipped', 'error'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"dataset_item_id" uuid NOT NULL,
	"selected_transcript" text,
	"transcript_variant" text,
	"detected_language" text,
	"provider_id" text,
	"route_id" text,
	"stt_model_id" text,
	"canonical_model_id" text,
	"language" text,
	"config_hash" text,
	"config_json" jsonb,
	"segments_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"speakers_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_metadata" jsonb,
	"artifact_latency_ms" double precision,
	"artifact_cost_usd" double precision,
	"artifact_cost_source" "cost_source",
	"lookup_latency_ms" double precision,
	"transcription_latency_ms" double precision,
	"transliteration_latency_ms" double precision,
	"incurred_cost_usd" double precision,
	"incurred_cost_source" "cost_source",
	"cache_hit" boolean,
	"preparation_status" text DEFAULT 'pending' NOT NULL,
	"evaluation_status" text DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone,
	"lease_owner" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_items_workflow_run_id_dataset_item_id_unique" UNIQUE("workflow_run_id","dataset_item_id"),
	CONSTRAINT "workflow_run_items_transcript_variant_check" CHECK ("workflow_run_items"."transcript_variant" is null or "workflow_run_items"."transcript_variant" in ('raw', 'latin')),
	CONSTRAINT "workflow_run_items_preparation_status_check" CHECK ("workflow_run_items"."preparation_status" in ('pending', 'running', 'completed', 'error')),
	CONSTRAINT "workflow_run_items_evaluation_status_check" CHECK ("workflow_run_items"."evaluation_status" in ('pending', 'running', 'completed', 'partial', 'error', 'skipped'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_item_scores" ADD CONSTRAINT "workflow_run_item_scores_workflow_run_item_id_workflow_run_items_id_fk" FOREIGN KEY ("workflow_run_item_id") REFERENCES "public"."workflow_run_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_items" ADD CONSTRAINT "workflow_run_items_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_items" ADD CONSTRAINT "workflow_run_items_dataset_item_id_dataset_items_id_fk" FOREIGN KEY ("dataset_item_id") REFERENCES "public"."dataset_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_run_item_scores_item_id_idx" ON "workflow_run_item_scores" USING btree ("workflow_run_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_run_items_run_status_idx" ON "workflow_run_items" USING btree ("workflow_run_id","preparation_status","evaluation_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_run_items_dataset_item_id_idx" ON "workflow_run_items" USING btree ("dataset_item_id");