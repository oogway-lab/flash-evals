CREATE TABLE "spend_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"source_table" text NOT NULL,
	"source_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_usd" double precision NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spend_ledger_team_paid_at_idx" ON "spend_ledger" USING btree ("team_id","paid_at");--> statement-breakpoint
CREATE INDEX "spend_ledger_paid_at_idx" ON "spend_ledger" USING btree ("paid_at");--> statement-breakpoint
-- Spend is recorded when it is paid: whenever a row's cumulative spend
-- column grows, the increase goes into spend_ledger with the time. Written by
-- triggers so every writer (eval cells, judges, pipeline steps, final-answer
-- judges, shared transcription) is covered. A column that is lowered or
-- cleared records nothing.
CREATE OR REPLACE FUNCTION record_spend_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    new_row jsonb := to_jsonb(NEW);
    old_row jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
    owner_team uuid;
    paid double precision;
    i integer := 0;
BEGIN
    -- TG_ARGV: pairs of (spend column, kind).
    WHILE i + 1 < TG_NARGS LOOP
        paid := coalesce((new_row->>TG_ARGV[i])::double precision, 0)
            - coalesce((old_row->>TG_ARGV[i])::double precision, 0);
        IF paid > 0 THEN
            IF owner_team IS NULL THEN
                IF TG_TABLE_NAME = 'run_cells' THEN
                    SELECT team_id INTO owner_team FROM runs
                    WHERE id = (new_row->>'run_id')::uuid;
                ELSE
                    SELECT team_id INTO owner_team FROM workflow_runs
                    WHERE id = (new_row->>'workflow_run_id')::uuid;
                END IF;
            END IF;
            IF owner_team IS NOT NULL THEN
                INSERT INTO spend_ledger (team_id, source_table, source_id, kind, amount_usd)
                VALUES (owner_team, TG_TABLE_NAME, (new_row->>'id')::uuid, TG_ARGV[i + 1], paid);
            END IF;
        END IF;
        i := i + 2;
    END LOOP;
    RETURN NULL;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS run_cells_spend_ledger ON run_cells;--> statement-breakpoint
CREATE TRIGGER run_cells_spend_ledger
AFTER INSERT OR UPDATE OF incurred_cost_usd, judge_cost_usd ON run_cells
FOR EACH ROW EXECUTE FUNCTION record_spend_ledger('incurred_cost_usd', 'call', 'judge_cost_usd', 'judge');--> statement-breakpoint
DROP TRIGGER IF EXISTS workflow_run_cells_spend_ledger ON workflow_run_cells;--> statement-breakpoint
CREATE TRIGGER workflow_run_cells_spend_ledger
AFTER INSERT OR UPDATE OF cost_usd, judge_cost_usd ON workflow_run_cells
FOR EACH ROW EXECUTE FUNCTION record_spend_ledger('cost_usd', 'call', 'judge_cost_usd', 'judge');--> statement-breakpoint
DROP TRIGGER IF EXISTS workflow_run_answers_spend_ledger ON workflow_run_answers;--> statement-breakpoint
CREATE TRIGGER workflow_run_answers_spend_ledger
AFTER INSERT OR UPDATE OF judge_cost_usd ON workflow_run_answers
FOR EACH ROW EXECUTE FUNCTION record_spend_ledger('judge_cost_usd', 'judge');--> statement-breakpoint
DROP TRIGGER IF EXISTS workflow_run_items_spend_ledger ON workflow_run_items;--> statement-breakpoint
CREATE TRIGGER workflow_run_items_spend_ledger
AFTER INSERT OR UPDATE OF incurred_cost_usd ON workflow_run_items
FOR EACH ROW EXECUTE FUNCTION record_spend_ledger('incurred_cost_usd', 'call');--> statement-breakpoint
-- Spend recorded before the ledger, dated by its run's start (as the daily
-- cap dated it).
INSERT INTO spend_ledger (team_id, source_table, source_id, kind, amount_usd, paid_at)
SELECT r.team_id, 'run_cells', c.id, 'call',
    coalesce(c.incurred_cost_usd, CASE WHEN c.status <> 'cached' THEN c.cost_usd END),
    r.created_at
FROM run_cells c JOIN runs r ON r.id = c.run_id
WHERE coalesce(c.incurred_cost_usd, CASE WHEN c.status <> 'cached' THEN c.cost_usd END) > 0;--> statement-breakpoint
INSERT INTO spend_ledger (team_id, source_table, source_id, kind, amount_usd, paid_at)
SELECT r.team_id, 'run_cells', c.id, 'judge', c.judge_cost_usd,
    r.created_at
FROM run_cells c JOIN runs r ON r.id = c.run_id
WHERE c.judge_cost_usd > 0;--> statement-breakpoint
INSERT INTO spend_ledger (team_id, source_table, source_id, kind, amount_usd, paid_at)
SELECT r.team_id, 'workflow_run_cells', c.id, 'call', c.cost_usd, r.created_at
FROM workflow_run_cells c JOIN workflow_runs r ON r.id = c.workflow_run_id
WHERE c.cost_usd > 0;--> statement-breakpoint
INSERT INTO spend_ledger (team_id, source_table, source_id, kind, amount_usd, paid_at)
SELECT r.team_id, 'workflow_run_cells', c.id, 'judge', c.judge_cost_usd, r.created_at
FROM workflow_run_cells c JOIN workflow_runs r ON r.id = c.workflow_run_id
WHERE c.judge_cost_usd > 0;--> statement-breakpoint
INSERT INTO spend_ledger (team_id, source_table, source_id, kind, amount_usd, paid_at)
SELECT r.team_id, 'workflow_run_answers', a.id, 'judge', a.judge_cost_usd, r.created_at
FROM workflow_run_answers a JOIN workflow_runs r ON r.id = a.workflow_run_id
WHERE a.judge_cost_usd > 0;--> statement-breakpoint
INSERT INTO spend_ledger (team_id, source_table, source_id, kind, amount_usd, paid_at)
SELECT r.team_id, 'workflow_run_items', i.id, 'call', i.incurred_cost_usd, r.created_at
FROM workflow_run_items i JOIN workflow_runs r ON r.id = i.workflow_run_id
WHERE i.incurred_cost_usd > 0;