CREATE TYPE "public"."dataset_modality" AS ENUM('image', 'text');--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "modality" "dataset_modality" DEFAULT 'image' NOT NULL;