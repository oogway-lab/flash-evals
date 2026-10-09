CREATE TYPE "public"."dataset_purpose" AS ENUM('golden', 'evaluation');--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "purpose" "dataset_purpose" DEFAULT 'golden' NOT NULL;