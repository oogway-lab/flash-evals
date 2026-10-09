CREATE TABLE IF NOT EXISTS "llm_capability_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"transport" text NOT NULL,
	"capability_digest" text NOT NULL,
	"capability_snapshot" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_capability_versions_team_id_project_id_id_unique" UNIQUE("team_id","project_id","id"),
	CONSTRAINT "llm_capability_versions_project_id_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "llm_capability_versions_project_id_capability_digest_unique" UNIQUE("project_id","capability_digest"),
	CONSTRAINT "llm_capability_versions_transport_check" CHECK ("llm_capability_versions"."transport" in ('openai', 'gateway', 'openrouter', 'bifrost')),
	CONSTRAINT "llm_capability_versions_window_check" CHECK ("llm_capability_versions"."expires_at" > "llm_capability_versions"."captured_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_route_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"provider_key_id" uuid NOT NULL,
	"provider_key_rotation_version" uuid NOT NULL,
	"capability_version_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_route_versions_team_id_project_id_id_unique" UNIQUE("team_id","project_id","id"),
	CONSTRAINT "llm_route_versions_project_id_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "llm_route_versions_route_id_version_unique" UNIQUE("route_id","version"),
	CONSTRAINT "llm_route_versions_version_check" CHECK ("llm_route_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_routes_team_id_project_id_id_unique" UNIQUE("team_id","project_id","id"),
	CONSTRAINT "llm_routes_project_id_id_unique" UNIQUE("project_id","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_llm_defaults" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"route_version_id" uuid NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_cell_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_run_cell_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"owner" text NOT NULL,
	"requested" jsonb NOT NULL,
	"actual" jsonb,
	"outcome" text NOT NULL,
	"error_class" text,
	"latency_ms" double precision,
	"safe_provider_evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_cell_attempts_workflow_run_cell_id_sequence_owner_unique" UNIQUE("workflow_run_cell_id","sequence","owner"),
	CONSTRAINT "workflow_cell_attempts_sequence_check" CHECK ("workflow_cell_attempts"."sequence" > 0),
	CONSTRAINT "workflow_cell_attempts_owner_check" CHECK ("workflow_cell_attempts"."owner" in ('mosaic', 'gateway')),
	CONSTRAINT "workflow_cell_attempts_outcome_check" CHECK ("workflow_cell_attempts"."outcome" in ('succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_exact_reuse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"fingerprint_version" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"canonical_input_digest" text NOT NULL,
	"artifact_digest" text NOT NULL,
	"artifact" jsonb NOT NULL,
	"origin_provenance" jsonb NOT NULL,
	"source_cell_id" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_exact_reuse_project_id_fingerprint_version_fingerprint_unique" UNIQUE("project_id","fingerprint_version","fingerprint"),
	CONSTRAINT "workflow_exact_reuse_fingerprint_version_check" CHECK ("workflow_exact_reuse"."fingerprint_version" > 0),
	CONSTRAINT "workflow_exact_reuse_digest_check" CHECK (length("workflow_exact_reuse"."fingerprint") > 0
                and length("workflow_exact_reuse"."canonical_input_digest") > 0
                and length("workflow_exact_reuse"."artifact_digest") > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_run_enqueue_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"status" text DEFAULT 'pending_enqueue' NOT NULL,
	"publish_attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"queued_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_enqueue_outbox_workflow_run_id_unique" UNIQUE("workflow_run_id"),
	CONSTRAINT "workflow_run_enqueue_outbox_status_check" CHECK ("workflow_run_enqueue_outbox"."status" in ('pending_enqueue', 'queued', 'failed')),
	CONSTRAINT "workflow_run_enqueue_outbox_attempts_check" CHECK ("workflow_run_enqueue_outbox"."publish_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "provider_keys" ADD COLUMN "rotation_version" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD COLUMN "llm_selection_mode" text;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD COLUMN "llm_route_version_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "enqueue_status" text DEFAULT 'legacy_unresolved' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ALTER COLUMN "enqueue_status" SET DEFAULT 'pending_enqueue';--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_id_unique" UNIQUE("team_id","id");--> statement-breakpoint
ALTER TABLE "provider_keys" ADD CONSTRAINT "provider_keys_team_id_id_unique" UNIQUE("team_id","id");--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_project_id_id_unique" UNIQUE("project_id","id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_capability_versions" ADD CONSTRAINT "llm_capability_versions_team_project_fk" FOREIGN KEY ("team_id","project_id") REFERENCES "public"."projects"("team_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_route_versions" ADD CONSTRAINT "llm_route_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_route_versions" ADD CONSTRAINT "llm_route_versions_route_scope_fk" FOREIGN KEY ("team_id","project_id","route_id") REFERENCES "public"."llm_routes"("team_id","project_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_route_versions" ADD CONSTRAINT "llm_route_versions_capability_scope_fk" FOREIGN KEY ("team_id","project_id","capability_version_id") REFERENCES "public"."llm_capability_versions"("team_id","project_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_routes" ADD CONSTRAINT "llm_routes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_routes" ADD CONSTRAINT "llm_routes_team_project_fk" FOREIGN KEY ("team_id","project_id") REFERENCES "public"."projects"("team_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_llm_defaults" ADD CONSTRAINT "project_llm_defaults_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_llm_defaults" ADD CONSTRAINT "project_llm_defaults_team_project_fk" FOREIGN KEY ("team_id","project_id") REFERENCES "public"."projects"("team_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_llm_defaults" ADD CONSTRAINT "project_llm_defaults_route_scope_fk" FOREIGN KEY ("team_id","project_id","route_version_id") REFERENCES "public"."llm_route_versions"("team_id","project_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_cell_attempts" ADD CONSTRAINT "workflow_cell_attempts_workflow_run_cell_id_workflow_run_cells_id_fk" FOREIGN KEY ("workflow_run_cell_id") REFERENCES "public"."workflow_run_cells"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_exact_reuse" ADD CONSTRAINT "workflow_exact_reuse_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_exact_reuse" ADD CONSTRAINT "workflow_exact_reuse_source_cell_id_workflow_run_cells_id_fk" FOREIGN KEY ("source_cell_id") REFERENCES "public"."workflow_run_cells"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_run_enqueue_outbox" ADD CONSTRAINT "workflow_run_enqueue_outbox_run_scope_fk" FOREIGN KEY ("project_id","workflow_run_id") REFERENCES "public"."workflow_runs"("project_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_capability_versions_lookup_idx" ON "llm_capability_versions" USING btree ("project_id","transport","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_route_versions_project_idx" ON "llm_route_versions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "llm_routes_project_name_idx" ON "llm_routes" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_routes_team_project_idx" ON "llm_routes" USING btree ("team_id","project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_llm_defaults_team_id_idx" ON "project_llm_defaults" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_cell_attempts_cell_idx" ON "workflow_cell_attempts" USING btree ("workflow_run_cell_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_exact_reuse_source_cell_idx" ON "workflow_exact_reuse" USING btree ("source_cell_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_run_enqueue_outbox_pending_idx" ON "workflow_run_enqueue_outbox" USING btree ("status","available_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_llm_route_version_id_llm_route_versions_id_fk" FOREIGN KEY ("llm_route_version_id") REFERENCES "public"."llm_route_versions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_llm_selection_check" CHECK (("workflow_nodes"."llm_selection_mode" is null and "workflow_nodes"."llm_route_version_id" is null)
                or ("workflow_nodes"."llm_selection_mode" = 'project_default' and "workflow_nodes"."llm_route_version_id" is null)
                or ("workflow_nodes"."llm_selection_mode" = 'pinned_route' and "workflow_nodes"."llm_route_version_id" is not null));--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_enqueue_status_check" CHECK ("workflow_runs"."enqueue_status" in ('pending_enqueue', 'queued', 'failed', 'legacy_unresolved'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_llm_route_provider_key_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "provider_keys"
        WHERE "id" = NEW."provider_key_id"
          AND "team_id" = NEW."team_id"
    ) THEN
        RAISE EXCEPTION 'provider key is not available in the route team'
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER llm_route_versions_provider_key_scope
BEFORE INSERT ON "llm_route_versions"
FOR EACH ROW EXECUTE FUNCTION enforce_llm_route_provider_key_scope();--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_immutable_llm_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is immutable', TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER llm_capability_versions_immutable
BEFORE UPDATE OR DELETE ON "llm_capability_versions"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_llm_history();--> statement-breakpoint
CREATE TRIGGER llm_route_versions_immutable
BEFORE UPDATE OR DELETE ON "llm_route_versions"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_llm_history();--> statement-breakpoint
CREATE TRIGGER workflow_cell_attempts_immutable
BEFORE UPDATE OR DELETE ON "workflow_cell_attempts"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_llm_history();--> statement-breakpoint
CREATE TRIGGER workflow_exact_reuse_immutable
BEFORE UPDATE ON "workflow_exact_reuse"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_llm_history();
