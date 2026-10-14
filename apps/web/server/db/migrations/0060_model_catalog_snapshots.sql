CREATE TABLE "model_catalog_snapshots" (
	"source" text PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
