CREATE TABLE IF NOT EXISTS "audio_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_item_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"stt_model_id" text NOT NULL,
	"language" text DEFAULT '' NOT NULL,
	"transcript" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_transcripts_dataset_item_id_storage_key_stt_model_id_language_unique" UNIQUE("dataset_item_id","storage_key","stt_model_id","language")
);
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD CONSTRAINT "audio_transcripts_dataset_item_id_dataset_items_id_fk" FOREIGN KEY ("dataset_item_id") REFERENCES "public"."dataset_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audio_transcripts_lookup_idx" ON "audio_transcripts" USING btree ("dataset_item_id","storage_key","stt_model_id","language");
