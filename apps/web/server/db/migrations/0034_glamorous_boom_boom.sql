CREATE TABLE IF NOT EXISTS "provider_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"base_url" text,
	"hint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_keys" ADD CONSTRAINT "provider_keys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_keys_team_provider_idx" ON "provider_keys" USING btree ("team_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_keys_team_id_idx" ON "provider_keys" USING btree ("team_id");
