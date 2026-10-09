CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_team_id_id_unique" UNIQUE("team_id","id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_workspace_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspaces_team_name_idx" ON "workspaces" USING btree ("team_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspaces_team_id_idx" ON "workspaces" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspaces_owner_user_id_idx" ON "workspaces" USING btree ("owner_user_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_workspace_id_idx" ON "projects" USING btree ("workspace_id");
--> statement-breakpoint
ALTER TABLE "llm_routes" DROP CONSTRAINT IF EXISTS "llm_routes_team_project_fk";--> statement-breakpoint
ALTER TABLE "llm_routes" ADD CONSTRAINT "llm_routes_team_project_fk"
FOREIGN KEY ("team_id", "project_id") REFERENCES "projects"("team_id", "id")
ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "llm_capability_versions" DROP CONSTRAINT IF EXISTS "llm_capability_versions_team_project_fk";--> statement-breakpoint
ALTER TABLE "llm_capability_versions" ADD CONSTRAINT "llm_capability_versions_team_project_fk"
FOREIGN KEY ("team_id", "project_id") REFERENCES "projects"("team_id", "id")
ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "llm_route_versions" DROP CONSTRAINT IF EXISTS "llm_route_versions_route_scope_fk";--> statement-breakpoint
ALTER TABLE "llm_route_versions" ADD CONSTRAINT "llm_route_versions_route_scope_fk"
FOREIGN KEY ("team_id", "project_id", "route_id") REFERENCES "llm_routes"("team_id", "project_id", "id")
ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "llm_route_versions" DROP CONSTRAINT IF EXISTS "llm_route_versions_capability_scope_fk";--> statement-breakpoint
ALTER TABLE "llm_route_versions" ADD CONSTRAINT "llm_route_versions_capability_scope_fk"
FOREIGN KEY ("team_id", "project_id", "capability_version_id") REFERENCES "llm_capability_versions"("team_id", "project_id", "id")
ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "project_llm_defaults" DROP CONSTRAINT IF EXISTS "project_llm_defaults_team_project_fk";--> statement-breakpoint
ALTER TABLE "project_llm_defaults" ADD CONSTRAINT "project_llm_defaults_team_project_fk"
FOREIGN KEY ("team_id", "project_id") REFERENCES "projects"("team_id", "id")
ON DELETE cascade DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "project_llm_defaults" DROP CONSTRAINT IF EXISTS "project_llm_defaults_route_scope_fk";--> statement-breakpoint
ALTER TABLE "project_llm_defaults" ADD CONSTRAINT "project_llm_defaults_route_scope_fk"
FOREIGN KEY ("team_id", "project_id", "route_version_id") REFERENCES "llm_route_versions"("team_id", "project_id", "id")
ON DELETE restrict DEFERRABLE INITIALLY IMMEDIATE;
