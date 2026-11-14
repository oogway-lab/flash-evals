CREATE TABLE "label_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_item_id" uuid NOT NULL,
	"path" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb NOT NULL,
	"choice" text NOT NULL,
	"task_key" text NOT NULL,
	"run_cell_id" uuid,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "label_corrections_choice_check" CHECK ("label_corrections"."choice" in ('candidate', 'benchmark'))
);
--> statement-breakpoint
ALTER TABLE "label_corrections" ADD CONSTRAINT "label_corrections_dataset_item_id_dataset_items_id_fk" FOREIGN KEY ("dataset_item_id") REFERENCES "public"."dataset_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_corrections" ADD CONSTRAINT "label_corrections_run_cell_id_run_cells_id_fk" FOREIGN KEY ("run_cell_id") REFERENCES "public"."run_cells"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_corrections" ADD CONSTRAINT "label_corrections_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "label_corrections_dataset_item_id_idx" ON "label_corrections" USING btree ("dataset_item_id");