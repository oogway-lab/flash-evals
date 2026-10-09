ALTER TABLE "workflow_nodes" ADD COLUMN IF NOT EXISTS "llm_transport" text;--> statement-breakpoint
ALTER TABLE "workflow_nodes" DROP CONSTRAINT IF EXISTS "workflow_nodes_llm_selection_check";--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_llm_selection_check" CHECK (coalesce(("workflow_nodes"."llm_selection_mode" is null and "workflow_nodes"."llm_route_version_id" is null)
    or ("workflow_nodes"."llm_selection_mode" = 'simple' and "workflow_nodes"."llm_transport" is not null and "workflow_nodes"."llm_route_version_id" is null)
    or ("workflow_nodes"."llm_selection_mode" = 'project_default' and "workflow_nodes"."llm_route_version_id" is null)
    or ("workflow_nodes"."llm_selection_mode" = 'pinned_route' and "workflow_nodes"."llm_route_version_id" is not null), false));
