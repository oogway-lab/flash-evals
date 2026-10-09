ALTER TYPE "public"."scorer_type" ADD VALUE IF NOT EXISTS 'transcript_metric';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audio_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_item_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"provider_id" text DEFAULT 'openai' NOT NULL,
	"route_id" text DEFAULT 'openai-audio-transcriptions' NOT NULL,
	"stt_model_id" text NOT NULL,
	"canonical_model_id" text DEFAULT '' NOT NULL,
	"language" text DEFAULT '' NOT NULL,
	"config_hash" text DEFAULT '' NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transcript" text NOT NULL,
	"raw_text" text,
	"normalized_text" text,
	"detected_language" text,
	"segments_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"speakers_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_metadata" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN IF NOT EXISTS "provider_id" text DEFAULT 'openai' NOT NULL;
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN IF NOT EXISTS "route_id" text DEFAULT 'openai-audio-transcriptions' NOT NULL;
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN IF NOT EXISTS "canonical_model_id" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN IF NOT EXISTS "config_hash" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN IF NOT EXISTS "config_json" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN IF NOT EXISTS "raw_text" text;
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN IF NOT EXISTS "normalized_text" text;
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN IF NOT EXISTS "detected_language" text;
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN IF NOT EXISTS "segments_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN IF NOT EXISTS "speakers_json" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN IF NOT EXISTS "provider_metadata" jsonb;
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN IF NOT EXISTS "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'completed' NOT NULL;
--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN IF NOT EXISTS "error" text;
--> statement-breakpoint
UPDATE "audio_transcripts"
SET
	"provider_id" = CASE
		WHEN "stt_model_id" LIKE 'vercel:%' THEN 'vercel-gateway'
		WHEN "stt_model_id" LIKE 'soniox:%' THEN 'soniox'
		WHEN "stt_model_id" LIKE 'openrouter:%' THEN 'openrouter'
		WHEN "stt_model_id" LIKE 'bifrost:%' THEN 'bifrost'
		ELSE "provider_id"
	END,
	"route_id" = CASE
		WHEN "stt_model_id" LIKE 'vercel:%' THEN 'vercel-ai-gateway-stt'
		WHEN "stt_model_id" LIKE 'soniox:%' THEN 'soniox-async-file-transcription'
		WHEN "stt_model_id" LIKE 'openrouter:google/gemini%' THEN 'openrouter-audio-understanding-unverified'
		WHEN "stt_model_id" LIKE 'openrouter:%' THEN 'openrouter-stt-unverified'
		WHEN "stt_model_id" LIKE 'bifrost:%' THEN 'bifrost-stt-unverified'
		ELSE "route_id"
	END,
	"canonical_model_id" = CASE
		WHEN "canonical_model_id" <> '' THEN "canonical_model_id"
		WHEN "stt_model_id" LIKE 'vercel:%' THEN regexp_replace("stt_model_id", '^vercel:', '')
		WHEN "stt_model_id" LIKE 'soniox:%' THEN regexp_replace("stt_model_id", '^soniox:', '')
		WHEN "stt_model_id" LIKE 'openrouter:%' THEN regexp_replace("stt_model_id", '^openrouter:', '')
		WHEN "stt_model_id" LIKE 'bifrost:%' THEN regexp_replace("stt_model_id", '^bifrost:', '')
		WHEN "stt_model_id" LIKE 'openai:%' THEN regexp_replace("stt_model_id", '^openai:', '')
		ELSE "stt_model_id"
	END,
	"raw_text" = COALESCE("raw_text", "transcript"),
	"normalized_text" = COALESCE("normalized_text", "transcript"),
	"detected_language" = COALESCE("detected_language", NULLIF("language", '')),
	"provider_metadata" = COALESCE(
		"provider_metadata",
		jsonb_build_object('provider', "provider_id", 'route', "route_id", 'model', "canonical_model_id")
	);
--> statement-breakpoint
ALTER TABLE "audio_transcripts" DROP CONSTRAINT IF EXISTS "audio_transcripts_dataset_item_id_storage_key_stt_model_id_language_unique";
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "audio_transcripts" ADD CONSTRAINT "audio_transcripts_dataset_item_id_dataset_items_id_fk" FOREIGN KEY ("dataset_item_id") REFERENCES "public"."dataset_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "audio_transcripts" ADD CONSTRAINT "audio_transcripts_dataset_item_id_storage_key_provider_id_route_id_canonical_model_id_language_config_hash_unique" UNIQUE("dataset_item_id","storage_key","provider_id","route_id","canonical_model_id","language","config_hash");
EXCEPTION
	WHEN duplicate_object OR duplicate_table THEN null;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "audio_transcripts_lookup_idx";
--> statement-breakpoint
CREATE INDEX "audio_transcripts_lookup_idx" ON "audio_transcripts" USING btree ("dataset_item_id","storage_key","provider_id","route_id","canonical_model_id","language","config_hash");
--> statement-breakpoint
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
