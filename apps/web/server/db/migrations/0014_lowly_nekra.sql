ALTER TABLE "prompt_validation_attempts" ALTER COLUMN "prompt_id" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_validation_attempt_id_prompt_validation_attempts_id_fk" FOREIGN KEY ("validation_attempt_id") REFERENCES "public"."prompt_validation_attempts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_optimizer_attempt_id_prompt_optimization_attempts_id_fk" FOREIGN KEY ("optimizer_attempt_id") REFERENCES "public"."prompt_optimization_attempts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_runnable_evidence_check" CHECK ("prompt_versions"."status" <> 'runnable' or ("prompt_versions"."schema_version_id" is not null and "prompt_versions"."validation_attempt_id" is not null));