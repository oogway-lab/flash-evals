CREATE TABLE "run_enqueue_outbox" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending_enqueue' NOT NULL,
	"publish_attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"queued_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_enqueue_outbox_job_unique" UNIQUE("job_id"),
	CONSTRAINT "run_enqueue_outbox_status_check" CHECK ("run_enqueue_outbox"."status" in ('pending_enqueue', 'queued')),
	CONSTRAINT "run_enqueue_outbox_attempts_check" CHECK ("run_enqueue_outbox"."publish_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "idempotency_fingerprint" text;--> statement-breakpoint
ALTER TABLE "run_enqueue_outbox" ADD CONSTRAINT "run_enqueue_outbox_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_enqueue_outbox_pending_idx" ON "run_enqueue_outbox" USING btree ("status","available_at");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_idempotency_scope_unique" UNIQUE("team_id","project_id","created_by","idempotency_key");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_idempotency_check" CHECK (
            ("runs"."idempotency_key" is null and "runs"."idempotency_fingerprint" is null)
            or ("runs"."idempotency_key" is not null and "runs"."idempotency_fingerprint" is not null
                and "runs"."created_by" is not null and length("runs"."idempotency_key") between 1 and 200)
        );