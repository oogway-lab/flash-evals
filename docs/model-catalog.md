# Model catalog

The shared model registry combines a bundled snapshot with public metadata stored
in the `model_catalog_snapshots` table. Existing model IDs and transport aliases
are retained so saved prompts, routes, and runs continue to resolve.

Sources:

- [models.dev](https://models.dev/api.json): OpenAI, OpenRouter, and Vercel model metadata.
- [OpenRouter](https://openrouter.ai/api/v1/models): official OpenRouter IDs, capabilities, and prices.
- [Vercel AI Gateway](https://ai-gateway.vercel.sh/v1/models): official Gateway IDs, capabilities, and prices.

Sources merge in a fixed order (models.dev, then OpenRouter, then Gateway), so
official provider metadata takes precedence over models.dev, and reloading the
same data always yields the same registry. Hand-curated registry entries keep
their label, capability flags (reasoning, vision, structured output, judge
suitability), reasoning efforts, and default price; catalogs only add transports
and per-transport prices to them. Prices are normalized to USD per token and kept per transport. The text eval
catalog includes models with text input and text output, including vision models;
speech, embeddings, reranking, and image generation are excluded. Provider
discovery still checks availability using the team's configured credentials.
Bifrost remains specific to its configured endpoint and is not stored globally.

## Refresh and recovery

The existing worker registers a pg-boss job at **02:17 UTC daily** (07:47 IST),
and enqueues an initial refresh on startup. Replicas coalesce startup refreshes
within an hour. Only public endpoints are fetched; refresh jobs never read team
credentials or execute model requests.

Each source is validated and persisted independently. A failed or unusable source
keeps its last good snapshot; the job retries twice, with a 60-second delay.
Worker logs report `catalog.refreshed` or `catalog.refresh_failed` per source.
The API, the eval worker, and the web server check for updated database
snapshots at most once per minute; only the first load in a process is awaited,
later checks run in the background. The API skips health probes and preflight
requests. The worker loads persisted snapshots before it claims run jobs, and a
failure to start the refresh queue is logged without stopping evals. If the table
cannot be read, the process keeps its last loaded catalog or the bundled fallback.

OpenRouter's reported `usage.cost` is used for cell cost. For BYOK requests it
covers only the OpenRouter fee, so the upstream charge is added when OpenRouter
reports it; otherwise cost falls back to catalog pricing.

Capabilities and prices are provider metadata rather than guarantees; actual
request support and account availability remain subject to provider checks.

## Deployment

Apply migration `0060_model_catalog_snapshots.sql` through the usual migration
process before starting the updated worker. Deploy both the API and worker so
they share the same catalog database. No additional credentials or external cron
service are needed; the worker must remain running for scheduled refreshes.

The bundled snapshot includes Gemini 3.8 Flash and Gemini 3.5 Flash Lite on
OpenRouter. Catalog refresh does not silently change saved model selections.
Choose a Gemini 3.x model for the next demo run after deployment.

To update the checked-in fallback independently of the database:

```sh
pnpm models:refresh-snapshot
```

Review and commit the resulting JSON. This command fetches public metadata and
writes only the local snapshot; it does not modify an application database.
