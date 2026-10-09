ALTER TABLE "workflow_nodes" DROP CONSTRAINT "workflow_nodes_model_id_check";--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_model_id_check" CHECK ("workflow_nodes"."node_type" in ('metric_compare', 'input') or "workflow_nodes"."model_id" is not null);
