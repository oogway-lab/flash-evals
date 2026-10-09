CREATE TYPE "public"."prompt_kind" AS ENUM('eval', 'judge');--> statement-breakpoint
ALTER TABLE "prompt_versions" DROP CONSTRAINT "prompt_versions_runnable_evidence_check";--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD COLUMN "judge_spec" jsonb;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "kind" "prompt_kind" DEFAULT 'eval' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "judge_prompt_version_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runs" ADD CONSTRAINT "runs_judge_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("judge_prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_runnable_evidence_check" CHECK ("prompt_versions"."status" <> 'runnable' or ("prompt_versions"."judge_spec" is not null or ("prompt_versions"."schema_version_id" is not null and "prompt_versions"."validation_attempt_id" is not null)));