ALTER TYPE "scorer_type" ADD VALUE IF NOT EXISTS 'transcript_metric';--> statement-breakpoint
ALTER TABLE "audio_transcripts" DROP CONSTRAINT IF EXISTS "audio_transcripts_dataset_item_id_storage_key_stt_model_id_language_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "audio_transcripts_lookup_idx";--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN "provider_id" text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN "route_id" text DEFAULT 'openai-audio-transcriptions' NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN "canonical_model_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN "config_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN "config_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN "raw_text" text;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN "normalized_text" text;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN "detected_language" text;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN "segments_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN "speakers_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN "provider_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN "status" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD COLUMN "error" text;--> statement-breakpoint
UPDATE "audio_transcripts"
SET
	"provider_id" = CASE
		WHEN "stt_model_id" LIKE 'vercel:%' THEN 'vercel-gateway'
		WHEN "stt_model_id" LIKE 'soniox:%' THEN 'soniox'
		WHEN "stt_model_id" LIKE 'openrouter:%' THEN 'openrouter'
		WHEN "stt_model_id" LIKE 'bifrost:%' THEN 'bifrost'
		ELSE 'openai'
	END,
	"route_id" = CASE
		WHEN "stt_model_id" LIKE 'vercel:%' THEN 'vercel-ai-gateway-stt'
		WHEN "stt_model_id" LIKE 'soniox:%' THEN 'soniox-async-file-transcription'
		WHEN "stt_model_id" LIKE 'openrouter:google/gemini%' THEN 'openrouter-audio-understanding-unverified'
		WHEN "stt_model_id" LIKE 'openrouter:%' THEN 'openrouter-stt-unverified'
		WHEN "stt_model_id" LIKE 'bifrost:%' THEN 'bifrost-stt-unverified'
		ELSE 'openai-audio-transcriptions'
	END,
	"canonical_model_id" = CASE
		WHEN "stt_model_id" LIKE 'vercel:%' THEN regexp_replace("stt_model_id", '^vercel:', '')
		WHEN "stt_model_id" LIKE 'soniox:%' THEN regexp_replace("stt_model_id", '^soniox:', '')
		WHEN "stt_model_id" LIKE 'openrouter:%' THEN regexp_replace("stt_model_id", '^openrouter:', '')
		WHEN "stt_model_id" LIKE 'bifrost:%' THEN regexp_replace("stt_model_id", '^bifrost:', '')
		WHEN "stt_model_id" LIKE 'openai:%' THEN regexp_replace("stt_model_id", '^openai:', '')
		ELSE "stt_model_id"
	END,
	"raw_text" = "transcript",
	"normalized_text" = "transcript",
	"detected_language" = NULLIF("language", ''),
	"provider_metadata" = jsonb_build_object('provider', "provider_id", 'route', "route_id", 'model', "canonical_model_id");
--> statement-breakpoint
UPDATE "audio_transcripts"
SET "provider_metadata" = jsonb_build_object('provider', "provider_id", 'route', "route_id", 'model', "canonical_model_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audio_transcripts_lookup_idx" ON "audio_transcripts" USING btree ("dataset_item_id","storage_key","provider_id","route_id","canonical_model_id","language","config_hash");--> statement-breakpoint
ALTER TABLE "audio_transcripts" ADD CONSTRAINT "audio_transcripts_dataset_item_id_storage_key_provider_id_route_id_canonical_model_id_language_config_hash_unique" UNIQUE("dataset_item_id","storage_key","provider_id","route_id","canonical_model_id","language","config_hash");
