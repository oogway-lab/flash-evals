CREATE TABLE "mcp_idempotency_records" (
	"team_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"key_hash" text NOT NULL,
	"fingerprint" text NOT NULL,
	"response_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_idempotency_records_team_id_operation_key_hash_pk" PRIMARY KEY("team_id","operation","key_hash"),
	CONSTRAINT "mcp_idempotency_key_hash_check" CHECK (length("mcp_idempotency_records"."key_hash") = 64),
	CONSTRAINT "mcp_idempotency_fingerprint_check" CHECK (length("mcp_idempotency_records"."fingerprint") = 64)
);
--> statement-breakpoint
ALTER TABLE "mcp_idempotency_records" ADD CONSTRAINT "mcp_idempotency_records_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_idempotency_created_at_idx" ON "mcp_idempotency_records" USING btree ("created_at");