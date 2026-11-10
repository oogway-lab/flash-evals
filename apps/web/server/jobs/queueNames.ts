export const RUN_QUEUE = "eval-run";
export const WORKFLOW_RUN_QUEUE = "workflow-run";

/**
 * pg-boss's longest allowed expiry (24 hours). pg-boss's default of 15
 * minutes expires a long run while its handler is still running and hands the
 * job to another attempt, which would execute (and bill) the run twice.
 */
export const RUN_JOB_EXPIRE_SECONDS = 24 * 60 * 60;

/**
 * Applied to the eval-run queue and to every job sent to it. No pg-boss
 * retries: the worker's stale-claim recovery republishes an interrupted run,
 * and a retried job would re-claim failed cells and pay for them again.
 * Must match the API's RUN_JOB_OPTIONS.
 */
export const RUN_JOB_OPTIONS = {
    expireInSeconds: RUN_JOB_EXPIRE_SECONDS,
    retryLimit: 0,
} as const;

/**
 * Workflow runs keep bounded retries with backoff for executor errors; only
 * the expiry is raised so a long workflow run is not retried mid-flight.
 * Must match the API's WORKFLOW_RUN_JOB_OPTIONS.
 */
export const WORKFLOW_RUN_JOB_OPTIONS = {
    expireInSeconds: RUN_JOB_EXPIRE_SECONDS,
    retryLimit: 3,
    retryBackoff: true,
} as const;

export const WORKFLOW_RUN_QUEUE_OPTIONS = {
    name: WORKFLOW_RUN_QUEUE,
    policy: "stately",
    ...WORKFLOW_RUN_JOB_OPTIONS,
} as const;

/**
 * pg-boss 11+ cannot migrate the v10 schema, so v12 lives in its own schema.
 * The legacy one is left untouched for rollback and drained by
 * `worker:migrate-legacy-queue`. Must match the API's PG_BOSS_SCHEMA.
 */
export const PG_BOSS_SCHEMA = "pgboss_v12";
export const LEGACY_PG_BOSS_SCHEMA = "pgboss";
