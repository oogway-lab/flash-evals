-- Custom SQL migration file, put your code below! --
-- Backfill: one default pipeline per dataset from its existing dataset_schemas.
-- Mirrors fieldConfigsFromSchema() in server/pipelines/service.ts: every schema
-- property becomes a factual field; a ruled field carries its matcher spec
-- (the rule minus its `field` key), an unruled field is factual-but-unscored.
-- Idempotent: only datasets without a pipeline are touched.
DO $$
DECLARE
    r RECORD;
    new_pipeline_id uuid;
BEGIN
    FOR r IN
        SELECT d.id AS dataset_id, d.team_id, d.name,
               ds.json_schema, ds.field_rules
        FROM datasets d
        JOIN dataset_schemas ds ON ds.dataset_id = d.id
        WHERE d.pipeline_id IS NULL
    LOOP
        INSERT INTO pipelines (team_id, name, output_schema, field_configs)
        VALUES (
            r.team_id,
            r.name || ' pipeline',
            r.json_schema,
            (
                SELECT coalesce(
                    jsonb_agg(
                        CASE
                            WHEN fr.rule IS NOT NULL THEN jsonb_build_object(
                                'field', k.key,
                                'kind', 'factual',
                                'spec', (fr.rule - 'field')
                            )
                            ELSE jsonb_build_object(
                                'field', k.key,
                                'kind', 'factual'
                            )
                        END
                        ORDER BY k.key
                    ),
                    '[]'::jsonb
                )
                FROM jsonb_object_keys(
                    CASE
                        WHEN jsonb_typeof(r.json_schema -> 'properties') = 'object'
                            THEN r.json_schema -> 'properties'
                        ELSE '{}'::jsonb
                    END
                ) AS k(key)
                LEFT JOIN LATERAL (
                    SELECT x.rule
                    FROM jsonb_array_elements(
                        CASE
                            WHEN jsonb_typeof(r.field_rules) = 'array'
                                THEN r.field_rules
                            ELSE '[]'::jsonb
                        END
                    ) AS x(rule)
                    WHERE x.rule ->> 'field' = k.key
                    LIMIT 1
                ) fr ON true
            )
        )
        RETURNING id INTO new_pipeline_id;

        UPDATE datasets SET pipeline_id = new_pipeline_id WHERE id = r.dataset_id;
    END LOOP;
END $$;