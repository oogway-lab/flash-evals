CREATE TYPE "public"."prompt_schema_generation_status" AS ENUM('proposed', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompt_schema_generation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"target_model_id" text,
	"generator_model_id" text NOT NULL,
	"status" "prompt_schema_generation_status" NOT NULL,
	"openai_compatible" boolean,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_schema_generation_attempts" ADD CONSTRAINT "prompt_schema_generation_attempts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_schema_generation_attempts" ADD CONSTRAINT "prompt_schema_generation_attempts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_schema_generation_attempts_team_id_idx" ON "prompt_schema_generation_attempts" USING btree ("team_id");