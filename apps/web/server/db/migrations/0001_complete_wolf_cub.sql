CREATE INDEX IF NOT EXISTS "cell_scores_run_cell_id_idx" ON "cell_scores" USING btree ("run_cell_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dataset_items_dataset_id_idx" ON "dataset_items" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "datasets_team_id_idx" ON "datasets" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "judge_configs_team_id_idx" ON "judge_configs" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompts_team_id_idx" ON "prompts" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_cells_run_id_idx" ON "run_cells" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_cells_dataset_item_id_idx" ON "run_cells" USING btree ("dataset_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_models_run_id_idx" ON "run_models" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_team_id_idx" ON "runs" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_team_id_idx" ON "users" USING btree ("team_id");