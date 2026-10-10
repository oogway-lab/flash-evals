# Worker operations for the internal pilot

The worker runs eval and workflow jobs from PostgreSQL. Keep its logs in the
existing private runtime log surface; no external error-tracking SDK, telemetry
credential, public metrics endpoint, or live alert destination is configured by
this change.

## Start, readiness, and status

Start the worker with `pnpm worker`. Once both queue consumers have started, its
JSON logs include `worker.ready` and one `worker.queue_ready` event per queue.
The process supervisor remains the liveness check: the worker does not expose an
unauthenticated HTTP health endpoint.

Run `pnpm worker:status` with the same `DATABASE_URL` to print one local JSON
snapshot. It checks the database and pg-boss tables, then reports pending,
active, and failed queue jobs; oldest queue age; pending/running/failed/stale
eval and workflow runs; and persisted provider/model usage and estimated costs
from the last 24 hours. It does not read or print prompts, inputs, outputs,
provider keys, or stored error text. The command is intended for a trusted
operator shell and must not be exposed through a public route or copied into a
public issue.

The status command reports `readiness: "queue_backend_ready"` when the database
and queue backend queries succeed. Confirm process liveness separately in the
runtime supervisor and check the worker's `worker.ready` log after each start.
An API `/health` result alone does not establish worker health.

## Shutdown and restart

On the first `SIGTERM` or `SIGINT`, the worker marks itself unready, stops its
stale-claim sweeps, and asks both pg-boss instances to stop polling and drain
active handlers. `MOSAIC_WORKER_DRAIN_TIMEOUT_MS` controls the drain window: the
default is 20 seconds, values below 1 second use the default, and values above
5 minutes are capped. Set the process manager's termination grace period above
the drain window plus five seconds.

At the pg-boss deadline, pg-boss marks any remaining active jobs failed using
their existing job retry settings before closing its own pool. The worker then
closes its application database pool and exits nonzero if work remained or
shutdown failed. A second termination signal forces immediate exit with status 1.

Jobs still queued remain durable for the next worker process. A graceful drain
that finishes before the deadline exits normally.

Stale-claim recovery runs at startup and periodically while the worker is
running. By default, claims older than 15 minutes are eligible for recovery;
`RUN_STALE_CLAIM_MS` and `WORKFLOW_STALE_CLAIM_MS` can adjust that lease, with a
60-second minimum. Recovery clears stale cell claims, resets the run to pending,
and republishes work through the existing queue path. Do not manually edit
pg-boss or run/cell rows as a first response.

## Recovery runbook

1. Check the worker process state and the `worker.startup_failed`,
   `worker.shutdown_forced`, `job.failed`, `job.retries_exhausted`,
   `recovery.failed`, and `recovery.completed` events.
2. Run `pnpm worker:status`. If the queue backend is unavailable, confirm the
   configured database is reachable and the worker has permission to use its
   pg-boss schema. Do not point the status command at a different or persistent
   database to investigate.
3. If a run is stale, restart the worker and allow the existing recovery sweep
   to process claims older than the configured lease. Confirm the run leaves
   `running` and that the queue's active/pending counts change as expected.
4. Review the resulting run or workflow cell status and its cost provenance in
   the authenticated app. Treat a provider call interrupted before result
   persistence as potentially billable even if no cost is recorded.
5. Record the date, run/workflow IDs, failure category, user-visible friction,
   recovery action, final status, provider/model cost source and estimate, and
   any unresolved discrepancy in the private daily pilot log. Do not copy
   prompts, outputs, credentials, or raw error text into that log.

## Errors, costs, and pilot review

Worker stdout uses JSON events with service, event, timestamp, queue, job/run or
cell IDs, duration, attempt count, and safe error name/code. Logs intentionally
omit exception messages and stacks because provider or database errors can echo
request content. Detailed, redacted cell errors remain in the app's existing
authenticated run views. API error-tracking configuration is currently a
placeholder shell; a configured DSN does not mean an external SDK is receiving
events. This worker path uses the private runtime logs as its error surface.

The status report sums persisted usage and cost estimates by provider/model and
cost source. A missing cost stays unavailable; catalog estimates and provider
reported values are not billing records. Compare costs with provider dashboards
when investigating discrepancies. The report and local logs do not implement
spend limits, billing, or entitlements.

For this pilot, the pilot owner/reviewer, Soumyo Dey, reviews the status and
daily record once per day. Review a failed job immediately before retrying it;
investigate any failed queue job, stale run, or unexplained cost discrepancy.
An oldest pending age over five minutes while the worker is expected to be
running is a practical check threshold. These are review recommendations only;
no alert integration or on-call commitment is configured. Keep snapshots and
logs in the existing private environment and its configured retention window;
do not enable external telemetry until its access, retention, and redaction
settings have been reviewed.

## Exactly-once boundary

Atomic run/cell claims prevent two workers from winning the same pending cell,
and a stopped job that is replayed while its cell remains running will not
invoke the provider again. Recovery eventually makes an expired cell eligible
again. A process can still be killed after a provider accepted and charged a
request but before the result and cost provenance commit. That later recovery
can make another provider request; exactly-once external billing cannot be
promised unless the provider supports and honors an idempotency key for that
operation. These changes improve durable logical recovery and observability,
not provider-side charge deduplication.

## Pilot gate

Passing code checks, CI, or a local database simulation does not count as seven
actual days of internal use. OOG-480 still requires a usable authenticated
internal deployment and seven real days of use with a daily record before any
later billing/customer-readiness decision. No billing implementation or hosted
telemetry configuration is part of this change.
