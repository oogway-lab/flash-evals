ALTER TABLE "prompts" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "prompts" DROP COLUMN IF EXISTS "scope";--> statement-breakpoint
DROP TYPE "public"."prompt_scope";