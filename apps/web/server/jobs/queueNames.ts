export const RUN_QUEUE = "eval-run";
export const WORKFLOW_RUN_QUEUE = "workflow-run";
export const WORKFLOW_RUN_QUEUE_OPTIONS = {
    name: WORKFLOW_RUN_QUEUE,
    policy: "stately",
} as const;

/**
 * pg-boss 11+ cannot migrate the v10 schema, so v12 lives in its own schema.
 * The legacy one is left untouched for rollback and drained by
 * `worker:migrate-legacy-queue`. Must match the API's PG_BOSS_SCHEMA.
 */
export const PG_BOSS_SCHEMA = "pgboss_v12";
export const LEGACY_PG_BOSS_SCHEMA = "pgboss";
