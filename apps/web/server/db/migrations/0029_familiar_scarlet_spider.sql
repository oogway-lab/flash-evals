CREATE TABLE IF NOT EXISTS "audio_transcript_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_item_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"source_transcript_hash" text NOT NULL,
	"variant_kind" text NOT NULL,
	"target_script" text NOT NULL,
	"target_language" text DEFAULT '' NOT NULL,
	"model_id" text NOT NULL,
	"prompt_hash" text DEFAULT '' NOT NULL,
	"prompt" text,
	"transcript" text NOT NULL,
	"provider_metadata" jsonb,
	"status" text DEFAULT 'completed' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_transcript_variants_dataset_item_id_storage_key_source_transcript_hash_variant_kind_target_script_target_language_model_id_prompt_hash_unique" UNIQUE("dataset_item_id","storage_key","source_transcript_hash","variant_kind","target_script","target_language","model_id","prompt_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audio_transcript_variants" ADD CONSTRAINT "audio_transcript_variants_dataset_item_id_dataset_items_id_fk" FOREIGN KEY ("dataset_item_id") REFERENCES "public"."dataset_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audio_transcript_variants_lookup_idx" ON "audio_transcript_variants" USING btree ("dataset_item_id","storage_key","source_transcript_hash","variant_kind","target_script","target_language","model_id","prompt_hash");