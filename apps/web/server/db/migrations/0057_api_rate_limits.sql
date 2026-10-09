CREATE TABLE IF NOT EXISTS "api_rate_limits" (
	"bucket_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "api_rate_limits_bucket_key_window_start_pk" PRIMARY KEY("bucket_key","window_start")
);
