# Worker operations for the internal pilot

The worker runs eval and workflow jobs from PostgreSQL. Keep its logs in the
existing private runtime log surface; no external error-tracking SDK, telemetry
credential, public metrics endpoint, or live alert destination is configured by
this change.

## Start, readiness, and status

Start the worker with `bun run worker`. Once both queue consumers have started, its
JSON logs include `worker.ready` and one `worker.queue_ready` event per queue.
The process supervisor remains the liveness check: the worker does not expose an
unauthenticated HTTP health endpoint.

Run `bun run worker:status` with the same `DATABASE_URL` to print one local JSON
snapshot. It checks the database and pg-boss tables, then reports pending,
active, and failed queue jobs; oldest queue age; pending/running/failed/stale
eval and workflow runs; and spend paid in the last 24 hours, from the same
spend ledger the team daily cap sums (`spend_ledger`, so a cell retried today
counts today's calls whenever it was created): by provider/model for cells'
own calls (a reused answer pays none), one `judge` row with the judge calls
that scored eval cells (cache hits included: scoring a reused answer still
pays the judge), a second `judge` row with `workflow: true` for the judges
that scored pipeline steps or compared their final answers with an eval run,
and a `transcription` row for pipelines' shared audio transcription. Token
counts are each cell's last call's. It does not read or print prompts, inputs,
outputs, provider keys, or stored error text. The command is intended for a
trusted operator shell and must not be exposed through a public route or copied
into a public issue.

The status command reports `readiness: "queue_backend_ready"` when the database
and queue backend queries succeed. Confirm process liveness separately in the
runtime supervisor and check the worker's `worker.ready` log after each start.
An API `/health` result alone does not establish worker health.

## Shutdown and restart

On the first `SIGTERM` or `SIGINT`, the worker marks itself unready, stops its
stale-claim sweeps, and asks both pg-boss instances to stop polling and drain
active handlers. `FLASH_EVALS_WORKER_DRAIN_TIMEOUT_MS` controls the drain window: the
default is 20 seconds, values below 1 second use the default, and values above
5 minutes are capped. Set the process manager's termination grace period above
the drain window plus five seconds.

At the pg-boss deadline, pg-boss marks any remaining active jobs failed using
their existing job retry settings before closing its own pool. Eval-run jobs
have no pg-boss retries, so an eval run interrupted this way is resumed by
stale-claim recovery (below) once its claims and run lease go stale. The worker then
closes its application database pool and exits nonzero if work remained or
shutdown failed. A second termination signal forces immediate exit with status 1.

Jobs still queued remain durable for the next worker process. A graceful drain
that finishes before the deadline exits normally.

Stale-claim recovery runs at startup and periodically while the worker is
running. By default, claims older than 15 minutes are eligible for recovery;
`RUN_STALE_CLAIM_MS` and `WORKFLOW_STALE_CLAIM_MS` can adjust that lease, with a
60-second minimum. An eval run's lease stores the worker's window
(`runs.execution_lease_stale_ms`, migration 0082), so the API's Cancel and Retry
judge whether a pass is alive by the worker's setting even when the API's
`RUN_STALE_CLAIM_MS` differs. Recovery clears stale cell claims, resets the run to pending,
and republishes work through the existing queue path. Do not manually edit
pg-boss or run/cell rows as a first response.

## Long runs: job expiry, retries and the run lease

A paid run can take hours. pg-boss's defaults (a 15-minute expiry and two
immediate retries) would expire such a job while its handler is still running
and start a second pass of the same run, which re-claims failed cells and pays
for them again. So:

- Eval-run and workflow-run jobs expire after 24 hours, pg-boss's maximum.
  The worker and the API set this on the queue (updating a queue created with
  the old defaults) and on every job they send, including recovery requeues.
- Eval-run jobs have no pg-boss retries. An interrupted eval run is resumed by
  stale-claim recovery instead. Workflow-run jobs keep three retries with
  backoff, because the workflow executor rethrows its errors once steps have
  started (a setup failure fails the run instead, below).
- Only one worker pass executes an eval run at a time. Before executing, a
  job takes the run's lease (`runs.execution_lease_id`/`execution_lease_at`),
  and the claim heartbeat keeps it fresh. A second job for the same run logs
  `job.deferred_run_busy` and is queued again to start after the stale-claim
  window, so a run whose worker died is still picked up. A late job for a run
  that has already finished does nothing.
- Workflow runs need no separate run lease. Their queue uses pg-boss's
  `stately` policy with the run ID as singleton key, so at most one job per
  run is queued and one is active, and every send (creation, Retry,
  recovery) carries that key. Steps are claimed atomically (pending to
  running) and a step's judge runs inside its claim, so a second pass, even
  after a 24-hour expiry, finds claimed and finished steps and does not run
  or score them again. Failed steps run again only through an explicit
  Retry.
- pg-boss `warning` events are logged as `queue.warning` with the warning type
  only (for example `handler_overrun` when a handler outlives its expiry).
  Investigate any `handler_overrun`.

Apply the database migration before starting a worker from this release: the
lease columns are new. The same holds for the workflow run columns
(`config_snapshot`, `cancel_requested_at`, `stop_reason`, `error`,
`workflow_run_cells.judge_cost_usd`, migration 0071). Setup comparisons need migration 0074 (`setup_comparisons` and the
`setup_comparison_id` columns on `runs` and `workflow_runs`).

## Concurrency and provider limits

`EVAL_CONCURRENCY` (default 5) sets how many cells one run works on at once.
`bun run dev` starts the local worker with `EVAL_CONCURRENCY=100` and
`FLASH_EVALS_PROVIDER_CONCURRENCY=100` unless the shell sets them; deployed
workers keep their own values.
Every eval model call and judge call (benchmark head-to-head and rubric
judges, judge prompts, legacy and field judges) also waits for a slot on its
provider (transport: OpenAI, Vercel AI Gateway, OpenRouter, Bifrost, Anthropic
or Gemini). `FLASH_EVALS_PROVIDER_CONCURRENCY` sets the slots per provider,
default 5, shared by all runs in the worker process, with per-provider
overrides such as `5,openrouter=10`. Pipeline (workflow) runs share the same
slots: every step call (prompt, LLM text, transliteration and judge steps)
and every judge that scores a step waits for its provider's slot.
`EVAL_CONCURRENCY` (default 4 for workflow runs) still caps the steps one
workflow worker runs at once. A benchmark cell's several judge calls
therefore queue behind other calls to the same provider instead of adding a
burst. The provider SDKs still retry network errors, 429 and 5xx responses
inside a slot. Nothing retries an answer cut off by the output limit: the
cell fails with "reached the output token limit" and is only run again by an
explicit Retry (raise the output limit first).

## Runs that stay pending

A run is pending until a worker pass finishes its setup (keys, prompts,
dataset) and sets it running. If that setup throws, the worker logs
`job.failed` and marks the run `failed` with the redacted error
(`runs.error`), which the run page shows with Retry. Setup errors used to be
swallowed, leaving the run pending forever.

Workflow runs work the same way: the worker sets a workflow run running once
its setup (cells, items, keys, scoring context) is done. If setup throws, the
run is marked `failed` with the redacted error (`workflow_runs.error`) and the
job is not retried; the pipeline run page shows it with Retry. A workflow run
whose steps had started keeps the job's retries, and the error of the last
attempt is stored once they are exhausted.

The run page also says when a run has been pending for over a minute with no
cell finished: "The worker hasn't picked this run up. Is it running?" (or, if
the API has not managed to queue it yet, that it is still being queued). Check
that `bun run worker` is running and look at its logs. The notice offers
Retry; while the run's job is still waiting in the queue, Retry does nothing
and says so, so it never queues the same run twice. Retry queues it again
once the job is gone (for example a pending run left behind by an older
release). The pipeline run page has the same notice; its Retry checks the
`workflow-run` job by the run's singleton key.

## Cancelling a run

Cancel a pending or running eval run from its page ("Cancel run"), the
`POST /api/runs/cancel` route, or the `cancel_run` MCP tool. The request is
stored on the run (`cancel_requested_at`, `stop_reason = 'cancelled'`):

- A run no worker has started is marked `cancelled` at once; its queued job
  finds it cancelled and does nothing.
- A running pass checks for the request before each cell, at most every two
  seconds. Calls already sent finish and are recorded (and charged); cells
  not started go back to pending and are shown as "Not run"; scoring stops
  for cells not yet scored. The run then ends `cancelled`.
- If the worker died, stale-claim recovery requeues the run and the next pass
  ends it `cancelled` without claiming cells.

"Resume run" (Retry) on a cancelled run clears the request and runs the cells
that did not run, then scores any cell left unscored.

Pipeline runs are cancelled the same way: "Cancel run" on the pipeline run
page, `POST /api/workflows/{workflowId}/runs/{runId}/cancel`, or the
`cancel_workflow_run` MCP tool. The request is stored on the workflow run
(`cancel_requested_at`, `stop_reason`). A pending workflow run is cancelled at
once; a worker still in its setup finds it cancelled and stops. A running pass
checks before each step (at most every two seconds), lets calls already sent
finish (a step's judge finishes with it), leaves steps not started pending
("not run") and ends the run `cancelled`. Final answers are recorded only for
items whose steps all finished. "Resume run" (`retry_workflow_run`) clears the
request and runs the remaining steps.

## Per-run spend limit

### Judge cost

Benchmark head-to-head and rubric judges, run-level judge prompts, legacy
judges and generative-field judges record what each call cost when the
provider reports it or the price list has the judge model. Each cell keeps the
sum in `run_cells.judge_cost_usd`, added to on every scoring pass (re-scoring
pays again, and the replaced scores are not read for totals, so nothing is
counted twice). The run page's "Total cost" adds it to the models' cost, and
the per-run limit, the team daily cap and `worker:status` include it. Each
model's own cost (cost per call, the cost chart) leaves it out so models still
compare fairly. A transcript-evaluator call is shared by the cells that use
its transcript; its cost is added to the first of them.

Pipeline steps scored by a judge (judge prompts and generative-field judges)
record the judge calls' cost in `workflow_run_cells.judge_cost_usd`, added to
on every scoring pass. A branch's reported cost on the pipeline run page, the
per-run limit, the team daily cap and `worker:status` (a `judge` row with
`workflow: true`) include it. On a pipeline run compared with an eval run, the
judges that score each item's final answer against that run's reference
record their cost in `workflow_run_answers.judge_cost_usd` (migration 0073),
counted the same way. That scoring runs after the run's final answers are
recorded, checks the run's stop (cancel or spend limit) before each item and
shares the provider limits; answers it did not reach are scored when the run
is resumed.

### The limit

A run can carry a spend limit (`maxCostUsd`, in USD) set when it is created:
the comparison setup suggests 1.5 times its estimate, the full form and the
API/MCP `create_eval_run` take an optional value. It is stored in the run's
config snapshot. With a limit, each stop check (before each cell, at most
every two seconds) also sums the run's recorded spend: what its cells' own
calls cost when they were made (`run_cells.incurred_cost_usd`, migration 0080:
the model call, nothing for a reused answer, plus the transcription the cell's
input needed, nothing for a reused transcript, charged to the first cell that
used it) plus every judge call made to score its cells. Cells written before
0080 count their cost unless cached. A cell's `cost_usd` stays the list cost
shown on it. Once that reaches the limit the worker stops starting cells,
exactly like a cancel, and the run ends `cancelled` with
`stop_reason = 'spend_cap'` ("Stopped at spend limit" in the app).

The limit is not a provider billing ceiling. Calls already sent when the limit
is reached finish and are paid. Between reads the worker adds what its cells
paid since the last read and, for each cell still in flight, the average cost
of the cells it has finished, and stops starting cells once recorded spend
plus that estimate reaches the limit. A run can still end over its limit by
the cells started before any cost was known (at most `EVAL_CONCURRENCY`), by
cells that cost more than the average, and by judge calls while scoring. Each
setup-comparison member estimates only its own cells in flight. A call whose
cost neither the provider nor the price list gives counts as nothing. Resuming
a run stopped at its limit would stop again at once, so the app offers a new
run instead. The team daily cap (`FLASH_EVALS_TEAM_DAILY_SPEND_CAP_USD`) is
separate and only checked when a run is created or retried; it counts eval and
pipeline spend by when it was paid (`spend_ledger`, migration 0081: database
triggers add a row each time a cell's, final answer's or item's recorded spend
grows), so a run retried or re-judged today counts only today's spend. Spend
of a deleted run still counts.

Pipeline runs take the same optional `maxCostUsd` (API, MCP
`create_workflow_run`, and "Spend limit and data rules" under **Run flow**),
stored in `workflow_runs.config_snapshot`. Their recorded spend is the cost of
their steps' calls (a reused result records none), every judge call that
scored a step or compared a final answer with an eval run's reference, and
shared audio transcription
(`workflow_run_items.incurred_cost_usd`). Between reads the worker estimates
steps in flight the way it estimates eval cells (what finished steps' calls
cost, and the average for each step still running). The run ends `cancelled`
with `stop_reason = 'spend_cap'`, as an eval run does.

### A setup comparison's shared limit

A setup comparison (Compare setups, `create_setup_comparison`) gives its eval
run and every pipeline run the comparison's `maxCostUsd`, and each member's
stop check reads the spend of all members together (each counted as above;
`setup_comparisons`, `runs.setup_comparison_id` and
`workflow_runs.setup_comparison_id`, migration 0074). Once their total
reaches the limit, every member stops starting calls and ends
`cancelled` with `stop_reason = 'spend_cap'`. Cancelling the comparison asks
every pending or running member to cancel, exactly as each run's own Cancel
does.

The pipeline runs start with the eval run. When a pipeline run's steps have
all finished while its eval run is still pending or running, it records the
final answers and stays `running` without scoring them
(`workflow_run.waiting_for_eval_run` in the log). When the eval run's job
ends, its worker queues every such pipeline run of the comparison
(`comparison.pipelines_queued_for_scoring`); their next pass scores the
answers against the finished reference and ends them. The stale-claim
recovery sweep queues them too, so a missed queue send does not leave a
pipeline run waiting. The comparison page shows "Steps done. Its answers are
scored once the eval run finishes" for such a run.

## Recovery runbook

1. Check the worker process state and the `worker.startup_failed`,
   `worker.shutdown_forced`, `job.failed`, `job.retries_exhausted`,
   `job.deferred_run_busy`, `queue.warning`, `recovery.failed`, and
   `recovery.completed` events.
2. Run `bun run worker:status`. If the queue backend is unavailable, confirm the
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

## pg-boss 12 cutover

pg-boss 11 and later cannot migrate the pg-boss 10 schema, so pg-boss 12 runs in
a separate `pgboss_v12` schema. The release that introduces it leaves the legacy
`pgboss` schema untouched. Waiting jobs in it are invisible to the new worker
until they are copied, and `bun run worker:status` reports them as
`legacyQueuePending`.

1. Take a database backup or confirm point-in-time recovery is available, then
   run `bun run worker:status` on the old release and note pending/active counts.
   A quiet queue makes the cutover shorter but is not required.
2. Deploy the API and worker services from the same release. Until the first
   new worker starts, `bun run worker:status` reports `not_ready` because
   `pgboss_v12` does not exist yet.
3. Once no pre-cutover API or worker instance remains, run
   `bun run worker:migrate-legacy-queue --dry-run` and then
   `bun run worker:migrate-legacy-queue`. It copies waiting eval and workflow jobs
   with their original ids and remaining attempts and marks the legacy rows
   cancelled in the same transaction. Re-running it is safe; jobs already queued
   under the same id or workflow run are deduplicated.
4. If it reports `blocked_by_active_legacy_jobs`, an old worker may still be
   running them. Confirm it has stopped; its runs are recovered once their claims
   pass the stale-claim lease. Then re-run with `--allow-active`.
5. Confirm `bun run worker:status` shows `legacyQueuePending: 0` and that new
   runs complete. Copied jobs report their age from the copy, not the original
   enqueue.

To roll back, redeploy the previous release. It uses the untouched legacy
schema; runs enqueued only into `pgboss_v12` stay pending until retried. Drop the
legacy `pgboss` schema only after the new release is stable and a rollback is no
longer planned.

## Errors, costs, and pilot review

Worker stdout uses JSON events with service, event, timestamp, queue, job/run or
cell IDs, duration, attempt count, allowlisted runtime error names, and known
network/SQLSTATE codes. Unknown provider-supplied names or codes collapse to a
generic category or are omitted. Logs omit exception messages and stacks because
provider or database errors can echo request content. Detailed, redacted cell
errors remain in the app's existing authenticated run views. API error-tracking
configuration is currently a placeholder shell; a configured DSN does not mean
an external SDK is receiving events. This worker path uses the private runtime
logs as its error surface.

The status report sums persisted usage and cost estimates by provider/model and
cost source for non-cached cells created in the prior 24 hours. Because the
schema does not record provider execution time for every cell, this is a
cell-creation-time window. A missing cost stays unavailable; catalog estimates
and provider-reported values are not billing records. Compare costs with
provider dashboards when investigating discrepancies. The report and local
logs do not implement spend limits, billing, or entitlements; per-run spend
limits are enforced by the worker (above).

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
