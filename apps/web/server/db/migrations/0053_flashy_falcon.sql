ALTER TABLE "workflow_nodes" DROP CONSTRAINT "workflow_nodes_llm_selection_check";--> statement-breakpoint
ALTER TABLE "workflow_run_enqueue_outbox" DROP CONSTRAINT "workflow_run_enqueue_outbox_status_check";--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_llm_selection_check" CHECK (coalesce(("workflow_nodes"."llm_selection_mode" is null and "workflow_nodes"."llm_route_version_id" is null)
                or ("workflow_nodes"."llm_selection_mode" = 'project_default' and "workflow_nodes"."llm_route_version_id" is null)
                or ("workflow_nodes"."llm_selection_mode" = 'pinned_route' and "workflow_nodes"."llm_route_version_id" is not null), false));--> statement-breakpoint
ALTER TABLE "workflow_run_enqueue_outbox" ADD CONSTRAINT "workflow_run_enqueue_outbox_status_check" CHECK ("workflow_run_enqueue_outbox"."status" in ('pending_enqueue', 'publishing', 'queued', 'failed'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION rotate_provider_key_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.ciphertext IS DISTINCT FROM OLD.ciphertext
        OR NEW.iv IS DISTINCT FROM OLD.iv
        OR NEW.auth_tag IS DISTINCT FROM OLD.auth_tag
        OR NEW.base_url IS DISTINCT FROM OLD.base_url THEN
        NEW.rotation_version = gen_random_uuid();
    END IF;
    RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS provider_keys_rotate_version ON provider_keys;--> statement-breakpoint
CREATE TRIGGER provider_keys_rotate_version
BEFORE UPDATE OF ciphertext, iv, auth_tag, base_url ON provider_keys
FOR EACH ROW EXECUTE FUNCTION rotate_provider_key_version();--> statement-breakpoint
CREATE INDEX IF NOT EXISTS llm_capability_versions_latest_model_idx
ON llm_capability_versions (
    team_id,
    project_id,
    transport,
    ((capability_snapshot->'transport'->>'transportModelId')),
    captured_at DESC,
    id DESC
);
