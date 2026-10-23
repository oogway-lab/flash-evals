-- Rename application-owned execution metadata without altering datasets,
-- prompts, outputs, IDs, timestamps, credentials, or prior migration hashes.
-- Only reserved keys and enum values change; arbitrary user strings do not.
CREATE FUNCTION flash_evals_rename_metadata(value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb; entry record; new_key text; new_value jsonb;
BEGIN
    IF jsonb_typeof(value) = 'object' THEN
        result := '{}'::jsonb;
        FOR entry IN SELECT * FROM jsonb_each(value) LOOP
            new_key := CASE entry.key
                WHEN 'mosaicReuse' THEN 'flashEvalsReuse'
                WHEN '__mosaicOpenRouterCacheStatus' THEN '__flashEvalsOpenRouterCacheStatus'
                WHEN '__mosaicOpenRouterGenerationId' THEN '__flashEvalsOpenRouterGenerationId'
                ELSE entry.key END;
            new_value := flash_evals_rename_metadata(entry.value);
            IF entry.key = 'owner' AND entry.value = '"mosaic"'::jsonb THEN
                new_value := '"flash-evals"'::jsonb;
            ELSIF entry.key = 'status' AND entry.value = '"mosaic_reuse"'::jsonb THEN
                new_value := '"flash_evals_reuse"'::jsonb;
            END IF;
            result := result || jsonb_build_object(new_key, new_value);
        END LOOP;
        RETURN result;
    ELSIF jsonb_typeof(value) = 'array' THEN
        SELECT coalesce(jsonb_agg(flash_evals_rename_metadata(element) ORDER BY position), '[]'::jsonb)
        INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS items(element, position);
        RETURN result;
    END IF;
    RETURN value;
END;
$$;
--> statement-breakpoint
ALTER TABLE "llm_route_versions" DISABLE TRIGGER llm_route_versions_immutable;
ALTER TABLE "workflow_cell_attempts" DISABLE TRIGGER workflow_cell_attempts_immutable;
ALTER TABLE "workflow_exact_reuse" DISABLE TRIGGER workflow_exact_reuse_immutable;
ALTER TABLE "workflow_cell_attempts" DROP CONSTRAINT "workflow_cell_attempts_owner_check";
--> statement-breakpoint
UPDATE llm_route_versions SET config = flash_evals_rename_metadata(config)
WHERE config IS DISTINCT FROM flash_evals_rename_metadata(config);
UPDATE workflow_runs SET workflow_snapshot = flash_evals_rename_metadata(workflow_snapshot)
WHERE workflow_snapshot IS DISTINCT FROM flash_evals_rename_metadata(workflow_snapshot);
UPDATE workflow_cell_attempts SET
    owner = CASE WHEN owner = 'mosaic' THEN 'flash-evals' ELSE owner END,
    requested = flash_evals_rename_metadata(requested),
    actual = flash_evals_rename_metadata(actual),
    safe_provider_evidence = flash_evals_rename_metadata(safe_provider_evidence)
WHERE owner = 'mosaic'
    OR requested IS DISTINCT FROM flash_evals_rename_metadata(requested)
    OR actual IS DISTINCT FROM flash_evals_rename_metadata(actual)
    OR safe_provider_evidence IS DISTINCT FROM flash_evals_rename_metadata(safe_provider_evidence);
UPDATE workflow_exact_reuse SET origin_provenance = flash_evals_rename_metadata(origin_provenance)
WHERE origin_provenance IS DISTINCT FROM flash_evals_rename_metadata(origin_provenance);
UPDATE run_cells SET provider_metadata = flash_evals_rename_metadata(provider_metadata)
WHERE provider_metadata IS DISTINCT FROM flash_evals_rename_metadata(provider_metadata);
--> statement-breakpoint
ALTER TABLE "workflow_cell_attempts" ADD CONSTRAINT "workflow_cell_attempts_owner_check"
CHECK ("workflow_cell_attempts"."owner" in ('flash-evals', 'gateway'));
ALTER TABLE "llm_route_versions" ENABLE TRIGGER llm_route_versions_immutable;
ALTER TABLE "workflow_cell_attempts" ENABLE TRIGGER workflow_cell_attempts_immutable;
ALTER TABLE "workflow_exact_reuse" ENABLE TRIGGER workflow_exact_reuse_immutable;
DROP FUNCTION flash_evals_rename_metadata(jsonb);
