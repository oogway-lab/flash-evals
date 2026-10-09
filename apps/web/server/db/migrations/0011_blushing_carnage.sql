CREATE TYPE "public"."prompt_optimization_status" AS ENUM('running', 'proposed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."prompt_validation_status" AS ENUM('running', 'passed', 'failed', 'provider_error', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."prompt_version_status" AS ENUM('legacy', 'runnable');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompt_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"json_schema" jsonb,
	"field_configs" jsonb,
	"sample_inputs" jsonb,
	"source_prompt_version_id" uuid,
	"source_schema_version_id" uuid,
	"validation_evidence_stale" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompt_optimization_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"draft_id" uuid,
	"source_prompt_version_id" uuid,
	"target_model_id" text,
	"target_model_family" text,
	"optimizer_model_id" text NOT NULL,
	"status" "prompt_optimization_status" NOT NULL,
	"guidance_source" jsonb,
	"original_prompt" text NOT NULL,
	"proposed_prompt" text,
	"rationale" text,
	"validation_attempt_id" uuid,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompt_schema_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"json_schema" jsonb NOT NULL,
	"field_configs" jsonb NOT NULL,
	"schema_hash" text NOT NULL,
	"openai_compatible" boolean DEFAULT false NOT NULL,
	"compatibility_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_schema_versions_prompt_id_version_unique" UNIQUE("prompt_id","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompt_validation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"draft_id" uuid,
	"prompt_version_id" uuid,
	"schema_version_id" uuid,
	"target_model_id" text NOT NULL,
	"status" "prompt_validation_status" NOT NULL,
	"schema_hash" text,
	"evidence" jsonb,
	"raw_output" text,
	"parsed_output" jsonb,
	"error" text,
	"latency_ms" double precision,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompt_version_fit_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_version_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_version_fit_tags_prompt_version_id_tag_unique" UNIQUE("prompt_version_id","tag")
);
--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD COLUMN "schema_version_id" uuid;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD COLUMN "status" "prompt_version_status" DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD COLUMN "validation_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD COLUMN "optimizer_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "target_model_id" text;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "target_model_family" text;--> statement-breakpoint
ALTER TABLE "run_models" ADD COLUMN "schema_version_id" uuid;--> statement-breakpoint
ALTER TABLE "run_models" ADD COLUMN "prompt_snapshot" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_drafts" ADD CONSTRAINT "prompt_drafts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_drafts" ADD CONSTRAINT "prompt_drafts_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_drafts" ADD CONSTRAINT "prompt_drafts_source_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("source_prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_drafts" ADD CONSTRAINT "prompt_drafts_source_schema_version_id_prompt_schema_versions_id_fk" FOREIGN KEY ("source_schema_version_id") REFERENCES "public"."prompt_schema_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_drafts" ADD CONSTRAINT "prompt_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_optimization_attempts" ADD CONSTRAINT "prompt_optimization_attempts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_optimization_attempts" ADD CONSTRAINT "prompt_optimization_attempts_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_optimization_attempts" ADD CONSTRAINT "prompt_optimization_attempts_draft_id_prompt_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."prompt_drafts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_optimization_attempts" ADD CONSTRAINT "prompt_optimization_attempts_source_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("source_prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_optimization_attempts" ADD CONSTRAINT "prompt_optimization_attempts_validation_attempt_id_prompt_validation_attempts_id_fk" FOREIGN KEY ("validation_attempt_id") REFERENCES "public"."prompt_validation_attempts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_optimization_attempts" ADD CONSTRAINT "prompt_optimization_attempts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_schema_versions" ADD CONSTRAINT "prompt_schema_versions_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_schema_versions" ADD CONSTRAINT "prompt_schema_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_validation_attempts" ADD CONSTRAINT "prompt_validation_attempts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_validation_attempts" ADD CONSTRAINT "prompt_validation_attempts_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_validation_attempts" ADD CONSTRAINT "prompt_validation_attempts_draft_id_prompt_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."prompt_drafts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_validation_attempts" ADD CONSTRAINT "prompt_validation_attempts_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_validation_attempts" ADD CONSTRAINT "prompt_validation_attempts_schema_version_id_prompt_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "public"."prompt_schema_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_validation_attempts" ADD CONSTRAINT "prompt_validation_attempts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_version_fit_tags" ADD CONSTRAINT "prompt_version_fit_tags_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_drafts_team_id_idx" ON "prompt_drafts" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_drafts_prompt_id_idx" ON "prompt_drafts" USING btree ("prompt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_optimization_attempts_team_id_idx" ON "prompt_optimization_attempts" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_optimization_attempts_prompt_id_idx" ON "prompt_optimization_attempts" USING btree ("prompt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_schema_versions_prompt_id_idx" ON "prompt_schema_versions" USING btree ("prompt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_validation_attempts_team_id_idx" ON "prompt_validation_attempts" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_validation_attempts_prompt_id_idx" ON "prompt_validation_attempts" USING btree ("prompt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_version_fit_tags_prompt_version_id_idx" ON "prompt_version_fit_tags" USING btree ("prompt_version_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_schema_version_id_prompt_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "public"."prompt_schema_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_models" ADD CONSTRAINT "run_models_schema_version_id_prompt_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "public"."prompt_schema_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
