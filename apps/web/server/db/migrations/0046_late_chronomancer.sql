CREATE TABLE IF NOT EXISTS "stt_route_probes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"route_id" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"probed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"probed_by" uuid NOT NULL,
	CONSTRAINT "stt_route_probes_status_check" CHECK ("status" in ('available', 'failed', 'unsupported_input'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stt_route_probes" ADD CONSTRAINT "stt_route_probes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stt_route_probes" ADD CONSTRAINT "stt_route_probes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stt_route_probes" ADD CONSTRAINT "stt_route_probes_probed_by_users_id_fk" FOREIGN KEY ("probed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stt_route_probes_team_project_model_idx" ON "stt_route_probes" USING btree ("team_id","project_id","model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stt_route_probes_team_project_idx" ON "stt_route_probes" USING btree ("team_id","project_id");
