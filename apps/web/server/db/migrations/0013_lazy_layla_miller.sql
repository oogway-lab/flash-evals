ALTER TABLE "prompt_optimization_attempts" ALTER COLUMN "prompt_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_cells_cache_lookup_idx" ON "run_cells" USING btree ("dataset_item_id","content_fingerprint","max_tokens","schema_hash","status","schema_violation");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_models_cache_lookup_idx" ON "run_models" USING btree ("model_id","prompt_version_id");
