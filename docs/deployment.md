# Flash Evals deployment and operations guide

[Documentation home](../README.md#documentation) · [Configuration](configuration.md) · [Worker operations](worker-operations.md)

This guide describes the Cloudflare, Railway, Clerk, PostgreSQL, and R2 deployment used by Flash Evals, including the fixes that made it work. Commands and configuration are grounded in application source at `0c315fa74edd9a0a72776060d63a01a162903b79` and official documentation checked on 12 October 2026. The documented versions are a tested baseline, not a claim that they are the latest versions. Recheck provider guidance before changing infrastructure.

Keep deployment-specific release records, account/resource identifiers, configuration values, and diagnostic reports in private storage outside the public repository. All connection examples and credential fields below are placeholders. Never paste passwords, bearer tokens, signed upload URLs, complete provider variable dumps, or production inputs into a ticket, chat, build log, or this document.

## 1. How to use this guide

Commands are marked by their evidence and effect:

- **Verified:** the exact command or underlying package script was used successfully in the recorded rollout, deployed service, or repository CI. This does not promise success against a different provider account or database.
- **Source verified:** the command is defined in tracked source; its full production workflow was not repeated while writing this guide.
- **Template:** a proposed command or configuration with placeholders. It needs verification against the selected account and database before being treated as tested there.
- **Read-only:** inspects state. It can still return sensitive information if used with inappropriate flags or targets.
- **Changes local files:** installs/builds/configures locally without deploying.
- **Changes infrastructure/data:** provisions resources, migrates, bootstraps, releases, rolls back, uploads, or runs evaluations. Review the exact target before execution.

Use a clean checkout of the approved release and record its full commit SHA. Commands below run from the **repository root**, unless a different directory is shown. Set `RELEASE_SHA` to that approved SHA before using release templates. Use the provider dashboards or an approved secret manager for credential entry; this guide does not require exporting secrets to the terminal.

For an existing instance, identify resources from its private release record and authorized provider metadata. Do not recreate a Supabase project, R2 bucket, Hyperdrive configuration, Clerk instance, Railway service, or apex-domain deployment merely to follow the first-install instructions.

## 2. Architecture and the paths requests take

| Component                       | What runs there                                                     | Main responsibilities                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Worker `flash-evals` | Next.js through OpenNext, plus packaged Astro marketing HTML/assets | Public `/`, Clerk sign-in/sign-up, `/dashboard`, authenticated pages/server actions, API proxying, some authorized database reads through Hyperdrive |
| Clerk production instance       | Hosted identity and OAuth authorization server                      | Web sessions, verified primary email identity, OAuth access tokens for MCP clients                                                                   |
| Railway API service             | Compiled TypeScript Node API                                        | Principal provisioning, tenant checks, datasets/prompts/runs, upload signing/verification, MCP endpoint and OAuth checks, durable job publication    |
| Railway private worker service  | TypeScript queue consumer launched with Node and `tsx`              | Evaluation and workflow execution, storage reads, provider calls, scoring, retry/recovery and private worker logs                                    |
| Supabase PostgreSQL             | PostgreSQL application tables and pg-boss queues                    | Users/teams/workspaces/projects, labels/prompts/run cells, encrypted provider credentials, durable queue state and migration journal                 |
| Cloudflare Hyperdrive           | Managed connection pool between web Worker and PostgreSQL           | Origin TLS validation and upstream connection pooling; query caching is disabled                                                                     |
| Cloudflare R2 private bucket    | S3-compatible object storage                                        | Dataset image/audio bytes; browser uploads use short-lived object-specific URLs                                                                      |

Supabase is used for **PostgreSQL only** in this deployment. Authentication is Clerk; media storage is R2. Supabase Auth, Supabase Storage credentials, Supabase Edge Functions, Railway PostgreSQL, Redis, and a Railway volume are not prerequisites for this topology. Docker is not required to build or deploy these hosted services. Disposable local PostgreSQL and some CI/security checks can use Docker; those are separate workflows.

### Web and admission path

An anonymous visit to `https://flashevals.dev/` receives the marketing page. An authenticated visitor to `/`, `/sign-in`, or `/sign-up` is redirected to `/dashboard`. Anonymous protected links redirect to `/sign-in`; successful sign-in and sign-up are forced to `/dashboard`, rather than accepting an arbitrary return destination. Clerk callback subpaths remain available. Sign-out returns to `/`.

Clerk authentication alone is not company admission. Protected pages obtain the current Clerk identity, require a verified primary email, and enforce the exact allowed domain before calling the API's principal resolver. The API repeats the domain/verified-email check. The Oogway pilot uses `MOSAIC_TENANCY_MODE=single-org` and `MOSAIC_ALLOWED_EMAIL_DOMAIN=oogwaylabs.com`. Matching is case-insensitive and exact: suffixes, subdomains, malformed addresses, and unverified addresses do not qualify. The public marketing page does not change that admission rule. An authenticated but inadmissible account reaches access denial when the dashboard validates its principal. [Admission source](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/server/auth/session.ts)

Single-org members share a team and its data. Workspaces/projects organize that data; do not describe this pilot as per-user private storage. First admitted web sign-in links or provisions the local application user and default workspace. MCP expects that application account to have been linked already.

The Cloudflare Worker cannot resolve Railway's private `*.railway.internal` network. Its `API_BASE_URL` must use a publicly reachable HTTPS API origin in this split topology. Privileged server-to-API calls use the shared `INTERNAL_API_TOKEN`, which stays on the server. A browser is never given this token.

### Upload/read path

The authenticated web/API path authorizes the dataset and requests a signed upload. R2 receives a browser PUT directly. The URL lasts ten minutes, binds the declared content type and length, and requires `If-None-Match: *`. The API verifies the stored object's size/media signature before linking it to a dataset. Media reads pass through the API's tenant/project checks, while the worker reads private objects with server credentials. Database rows retain object keys; they do not make the bucket public.

### Evaluation/job path

Run creation persists run/cell records and a durable publication intent. Jobs are published to PostgreSQL-backed pg-boss queues. A `pending_enqueue` response means the logical run exists and publication will be retried; retain its ID and idempotency key. The independent Railway worker consumes eval/workflow queues, claims cells, reads dataset inputs and labels, resolves provider credentials, executes the selected provider/model, scores outputs, and persists result/usage/cost provenance. The UI/MCP reads progress and results from the same backend.

Workflow execution uses a saved route snapshot, not an implicit override from `MOSAIC_LLM_PROVIDER`. Metric comparison nodes load dataset reference labels even without a field-diff scorer; the worker deployed on `97fafff` includes that fix. Atomic claims and recovery improve logical durability, but cannot guarantee exactly-once external billing if a process dies after a provider charges and before result persistence. [Worker operations](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/docs/worker-operations.md)

## 3. Accounts, access, and toolchain

Have authorized access to the repository/GitHub Actions, a Cloudflare account and the domain's DNS zone, R2 and Hyperdrive, the production Clerk instance, the correct Supabase project, the Railway project/environment/services, and the approved secret manager. For a new instance, assign an operator and recovery/backup owner before admitting real data. Paid model-provider access is needed only when performing real provider evaluations; do not add dummy keys to satisfy a smoke test.

| Tool/dependency                | Documented baseline and evidence                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js                        | `.nvmrc` and CI pin **24.21.0**. `engines.node` accepts `^22.12.0                                                                                                                      |     | ^24.0.0 |     | >=26.0.0`; a local build can use another version within that range. Use the repo/CI pin for repeatable setup. |
| pnpm                           | Root `packageManager` pins **12.6.0**, including its integrity suffix. Keep `pnpm-lock.yaml` and `pnpm-workspace.yaml`.                                                                |
| Next.js                        | Exact **16.3.8**. Do not fold an upgrade into a deployment release. Next 16.4 previously caused an OpenNext runtime `preview-props.json` manifest failure.                             |
| Astro                          | Marketing source pins **7.3.4**. It is packaged into the web release, not deployed as a second apex Worker.                                                                            |
| OpenNext Cloudflare / Wrangler | Tracked ranges `^1.20.8` / `^4.147.0`, installed from the lockfile; Wrangler inspected here is **4.147.0**. Do not replace lockfile-resolved versions with unreviewed latest versions. |
| PostgreSQL driver / queue      | Tracked `pg ^8.23.1`, `pg-boss ^10.1.5`; restore and deploy the reviewed lockfile.                                                                                                     |
| Codex CLI                      | Help/version inspected here: **0.162.1**. OAuth options below were verified in its help, not newly used to log in during documentation.                                                |

Clean checkout template (**changes local files; new clone template**):

```sh
git clone https://github.com/oogway-lab/flash-evals.git flash-evals-release
cd flash-evals-release
git checkout --detach "$RELEASE_SHA"
nvm install
nvm use
pnpm --version
pnpm install --frozen-lockfile
git rev-parse HEAD
git status --short
```

`nvm` is optional; an equivalent Node manager can honor `.nvmrc`. If pnpm is absent, install the exact pinned version through your trusted package-manager setup. Do not use an old Nixpacks/Corepack build recipe: the deployed services use Railpack, which detects pnpm from `packageManager`. The Nixpacks/Corepack failure was addressed in [PR13](https://github.com/oogway-lab/flash-evals/pull/13). [Railpack Node documentation](https://railpack.com/languages/node)

Use interactive provider login on the operator's own machine if needed. Wrangler authentication is distinct from Clerk app authentication; Railway platform login is distinct from API/MCP OAuth. A human completes provider login in the browser. Use authorized credentials through their intended runtime or provider tool without displaying values.

## 4. First-install deployment order

This is a **provisioning template**. It is not evidence that a clean-account installation has been repeated for every provider account.

1. Select the reviewed release, public web/API origins, region, tenancy policy, and a fresh pilot team UUID. Record owners and a rollback plan.
2. Provision or identify Supabase PostgreSQL. Before migrations or admitting application data, complete the Data API exposure gate in section 5: explicitly disable the unused Supabase Data API for this PostgreSQL-only topology. If another consumer requires it, review exposed schemas, existing/default grants, and RLS separately before proceeding. Establish trusted TLS and a reachable direct/session connection. Determine whether the database is genuinely empty or already populated.
3. Apply reviewed migrations under the appropriate fresh/existing procedure in section 5. Bootstrap the pilot team only after its prerequisites pass.
4. Configure the Clerk production web instance and DNS. Create the OAuth application/client policy needed for MCP. Keep web and API admission settings aligned.
5. Provision a private R2 bucket, scoped S3 credentials, an application prefix, and exact-origin CORS.
6. Provision Hyperdrive against the Supabase direct endpoint, upload the correct CA, select `verify-full`, disable query caching, and bind its resource ID in the web config.
7. Create separate Railway API and private worker services from the repo root. Enter settings/variables, build with Railpack, deploy compatible worker/API revisions, and verify API plus worker readiness. Migration predeploy belongs only on the API.
8. Add the API's public domain and the provider-specified DNS record; verify HTTPS. Configure Clerk's provider-specified DNS records separately.
9. Build the web with the correct **public build-time values**, enter server secrets/runtime settings, and deploy to the existing single Cloudflare Worker. Attach the web apex once.
10. Perform real admitted web sign-in, then MCP OAuth discovery/login/tool checks. Run synthetic storage and keyless evaluation acceptance before any paid-provider test.
11. Record component SHAs, provider deployment/version IDs, acceptance results, rollback targets, configuration-name inventories, and actual remaining pilot gates.

For an ordinary code release, skip provisioning. Inspect schema/contract compatibility and apply only pending reviewed migrations, then use sections 10, 13, and 15. A web-only marketing release does not justify new database, auth, storage, or domain resources.

## 5. PostgreSQL, TLS, migrations, and team bootstrap

### Data API exposure gate — before migrations or admitting data

The current application migrations create tables in `public` without adding RLS policies or hardening Data API grants/default privileges. Clerk and the Flash Evals API enforce application admission; those checks do not protect a separate Supabase Data API path to exposed database objects.

For this PostgreSQL-only topology, explicitly disable the unused Supabase Data API in the correct project's Data API settings and confirm that it is disabled before running migrations or admitting application data. If another consumer requires the Data API, pause this deployment path and separately review exposed schemas, existing object grants, default grants for newly created objects, and RLS policies for every exposed object before proceeding. Do not assume a fresh project's defaults or this application's Clerk authentication make exposure safe. Follow [Supabase's Data API security guide](https://supabase.com/docs/guides/api/securing-your-api#disable-the-data-api).

Confirm the selected project's Data API state through authorized read-only inspection before relying on it. This guide does not establish that the setting is disabled for another instance and does not change provider settings.

### Connection choices

Obtain host, port, database, user, and the matching certificate from the Supabase project's **Connect / Database settings** panels. The database password is a separate secret retained in the approved secret manager. URL-encode a password if the human/operator constructs a URI. Do not copy a production connection string into source, docs, or logs.

| Consumer                  | Choice for this stack                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hyperdrive origin         | Supabase direct `db.<PROJECT_REF>.supabase.co:5432`, database `postgres`, the project database user. Hyperdrive provides pooling; do not stack the transaction pooler behind it.                              |
| Railway API/worker        | Preserve their existing session-pooler `DATABASE_URL` on port 5432. A deliberately selected direct connection can work when outbound IPv6 is enabled and verified; that is a separate configuration decision. |
| Migration/backup operator | Prefer a direct connection with trusted TLS. If the operator cannot reach IPv6, use a reviewed session-mode alternative; do not silently replace it with transaction pooling.                                 |
| Local Next development    | `MOSAIC_WEB_DATABASE_URL` or `DATABASE_URL`; this is not how the production Cloudflare Worker connects.                                                                                                       |

Direct Supabase endpoints are IPv6 unless the project's IPv4 add-on changes the endpoint. Session pooling supports IPv4. Railway API and worker services using a direct IPv6 endpoint require verified outbound IPv6 reachability. For a new service using a direct IPv6 endpoint, enable that service's outbound IPv6 setting and apply its staged change; this is a network configuration change, not a DNS fix. A working laptop connection does not prove a Railway container can reach the endpoint. [Supabase connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres) · [Railway outbound IPv6](https://docs.railway.com/networking/outbound-networking)

### CA and TLS

`scripts/node-with-supabase-ca.mjs` launches Node with `NODE_EXTRA_CA_CERTS` defaulting to `apps/web/config/supabase-root-2021-ca.pem`. API start, worker start, migration, and bootstrap scripts use this wrapper. If `NODE_EXTRA_CA_CERTS` is already set, the wrapper preserves it; the operator must ensure that alternate file includes the required trust chain. Never fix certificate failures by disabling verification.

The checked-in public certificate is the **Supabase Root 2021 CA**, SHA-256 fingerprint `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`. Use a credential-free PostgreSQL STARTTLS check to validate the selected endpoint's certificate and hostname. For a different project/region, compare the provider-issued CA; do not assume this file is universally correct. Hyperdrive requires a region-specific single CA certificate, rather than a global bundle. [Hyperdrive TLS guide](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/)

Credential-free TLS diagnostic (**read-only template**, use the public hostname):

```sh
openssl s_client -starttls postgres \
  -connect 'db.<PROJECT_REF>.supabase.co:5432' \
  -servername 'db.<PROJECT_REF>.supabase.co' \
  -verify_hostname 'db.<PROJECT_REF>.supabase.co' \
  -verify_return_error \
  -CAfile apps/web/config/supabase-root-2021-ca.pem </dev/null
```

This verifies network/TLS, not a password, SQL permissions, schema, or application readiness. Node's additional-CA setting does not configure `psql`/`pg_dump`; those clients need their own protected libpq service/password settings and `sslmode=verify-full` with the correct `sslrootcert`.

### Fresh database

**Data-changing. Run only after confirming the database is new, empty of application data, and explicitly selected for this install.** The migration set contains historical destructive SQL: `0037_backfill_personal_workspaces.sql` executes `TRUNCATE TABLE "teams" CASCADE`. It is tolerable in a genuinely empty first installation; it can remove existing team-owned data if replayed.

The application uses Drizzle migrations from `apps/web/server/db/migrations`, including `meta/_journal.json`. It does not use Supabase CLI migration history as its application release journal. CI verifies the migration set against a disposable empty PostgreSQL service.

After the human has supplied the correct `DATABASE_URL`, `MOSAIC_DEFAULT_TEAM_ID`, and optional `MOSAIC_DEFAULT_TEAM_NAME` in a protected operator/API environment:

```sh
# Repository root; verified scripts; changes schema/data.
pnpm run db:migrate
pnpm run db:bootstrap-pilot-team
```

Migrations load `apps/api/.env` then `apps/web/.env` if present; existing process variables take precedence. Bootstrap deliberately loads only `apps/api/.env`, so a conflicting web file cannot shadow the team ID/name. In the hosted Railway predeploy environment, variables are supplied by Railway. Avoid unintended env-file overrides in an operator checkout.

Bootstrap creates the configured team only when the table is empty; the same ID/name is an idempotent no-op. It refuses another team or a conflicting name and does not run/reset migrations. The default name is `Oogway Labs`. Subsequent admitted sign-in creates/links the user/workspace through the principal resolver. Do not use `pnpm run seed` on a hosted database: it truncates application tables.

### Existing database

Before a release, take a recoverable paired database/object backup, compare the deployed migration journal with tracked `meta/_journal.json`, review only unapplied SQL, and check backward compatibility with running API/worker/web revisions. Preserve the `drizzle.__drizzle_migrations` journal and its records. Do not delete journal rows, drop the journal/schema, mark guessed migrations applied, replay all SQL manually, or reset the database to resolve a deployment problem.

Read-only SQL templates for the approved database console:

```sql
SELECT to_regclass('public.teams') AS teams_table,
       to_regclass('drizzle.__drizzle_migrations') AS migration_journal;
-- Execute the next query only after confirming the journal table exists.
SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id;
```

These are verification templates, not queries executed during this documentation task. If application data exists but migration history is missing/inconsistent, stop automated migrations and design a reviewed reconciliation on a recovery copy. Do not run the destructive historical migration or bootstrap as a repair tool. Bootstrap's refusal is protective; do not bypass it by deleting other teams.

The deployment baseline API predeploy command is `pnpm run db:migrate && pnpm run db:bootstrap-pilot-team`. Its safe use on an existing database depends on retaining the migration journal and matching bootstrap state. Reusing that command on another database requires the fresh/existing checks above. The worker has **no predeploy migration/bootstrap**.

## 6. Clerk web authentication and MCP OAuth

### Web production instance

In Clerk, select the correct production instance and web domain. Obtain its live publishable key and server secret from the instance's key panel; do not use test-instance keys in production. Enter the publishable key as `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` for web build and runtime. Enter the server key as encrypted `CLERK_SECRET_KEY` in the web Worker and as a protected API variable. These must refer to the same Clerk instance.

Use the provider's displayed DNS records for the Frontend API/accounts/email domain verification. Keep Clerk verification CNAMEs in **DNS-only** mode when required; Cloudflare proxying can prevent Clerk from verifying them. Do not invent targets or copy another deployment's Clerk DNS values. Configure the site's `/sign-in` and `/sign-up` URLs and require verification appropriate to this company pilot. App-level exact-domain admission remains authoritative even if the Clerk dashboard also restricts sign-up. [Clerk production deployment guide](https://clerk.com/docs/guides/development/deployment/production)

The sign-in component uses `forceRedirectUrl="/dashboard"`; sign-out uses `/`. Middleware checks the exact entry routes, leaving factor/callback subpaths alone. These application decisions are source controlled and do not need an extra redirect-rule layer at the DNS/CDN provider. Keep entry redirects and marketing responses private/no-store; do not put a public cache rule over personalized redirects.

### MCP authorization server and application

MCP is served by the **Railway API** at `/mcp`, using Streamable HTTP. Browser cookies are not MCP bearer credentials. Configure the API with `MOSAIC_MCP_ENABLED=true`, the HTTPS `MOSAIC_MCP_RESOURCE_URL` ending in `/mcp`, `CLERK_ISSUER`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and the correct JWT verification public key in `CLERK_JWT_KEY`. The latter is a public PEM signing-verification key; it is not a JWT token or private key.

For the current pinned-client policy, create/identify the Clerk OAuth application and set `MOSAIC_MCP_OAUTH_CLIENT_ID` to its client ID. Register the exact callback displayed by the actual Codex client. Enable the appropriate native/public-client PKCE flow. Do not invent or pre-register a guessed localhost path. Clerk must issue **JWT OAuth access tokens** for the MCP resource audience. The verifier accepts access-JWT types `at+jwt` or `application/at+jwt`, validates the signature and audience, and checks that verified `iss` exactly equals `CLERK_ISSUER`.

`client_id`, `azp`, issuer, and audience have distinct meanings. The server compares the verified OAuth `clientId` to the configured pin. `CLERK_AUTHORIZED_PARTIES`, if intentionally set, restricts `azp` separately; do not put the OAuth client ID there as a substitute. A valid signature from the expected key does not replace the exact issuer check. Opaque tokens are rejected because they cannot provide the required verified issuer claims. [OAuth verifier source](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/api/src/mcp/auth.ts)

Dynamic registration is an alternative policy, not a prerequisite. It requires both provider support/enablement and `MOSAIC_MCP_OAUTH_DYNAMIC_CLIENTS=true`, with the client pin unset. That broadens client registration and removes the single-client equality guard; do not switch the current deployment just to work around a client error. Current Clerk docs also describe CIMD; verify compatibility with this pinned API/client before adopting a different policy. [Clerk MCP documentation](https://clerk.com/docs/expressjs/guides/ai/mcp/build-mcp-server)

Keep `MOSAIC_MCP_RAW_TOKEN_FALLBACK_ENABLED=false` in production; the API rejects enabling it under `NODE_ENV=production`. `MOSAIC_MCP_TOKEN_PEPPER` and `MOSAIC_MCP_LOCAL_TOKEN` are for the separate local raw-token path, not production OAuth. Sign into the web app once with the intended admitted account before MCP login. MCP then rechecks that account's current verified primary email through Clerk on each request.

Set `MOSAIC_MCP_ALLOWED_ORIGINS` only for the exact browser-client origins that actually send an `Origin` header. A native client without that header does not need an entry. This allowlist is separate from the API's web `CORS_ORIGINS`.

## 7. Private R2 media storage

Create or identify the bucket in the correct Cloudflare account. Keep public access disabled: no public custom domain or `r2.dev` exposure is needed. Choose the application prefix once and keep it identical across web, API, and worker. The current adapter uses the standard account S3 endpoint and `region=auto`; a jurisdiction-specific endpoint is not configurable in production through `R2_ENDPOINT`, so do not silently substitute a jurisdictional bucket.

Generate **R2 S3-compatible credentials**, scoped to the intended bucket and object read/write operations. Save the generated **Access Key ID** and **Secret Access Key** as a matched pair in the secret manager. A generic Cloudflare bearer API token or account identifier is not the S3 secret/key pair; confusing them caused an earlier deployment failure. The secret is displayed when created, not recoverable later; rotate through an explicit credential handoff if lost. [R2 credential documentation](https://developers.cloudflare.com/r2/api/tokens/)

Enter `R2_ACCOUNT_ID`, `R2_BUCKET`, and optional `R2_STORAGE_PREFIX` as server configuration in all three components. Enter `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` as protected server variables/secrets in all three. Set `MOSAIC_STORAGE_ADAPTER=r2` explicitly; its production fallback is otherwise Supabase storage.

CORS dashboard template (**changes bucket configuration; placeholder policy**):

```json
[
    {
        "AllowedOrigins": ["https://<WEB_DOMAIN>"],
        "AllowedMethods": ["PUT"],
        "AllowedHeaders": ["Content-Type", "If-None-Match"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
    }
]
```

Use the exact scheme/host, without a path; add a preview origin only when it is intentionally admitted. The current web proxy preserves the API's `requiredHeaders`, including `If-None-Match`, and the browser sends them. Do not remove the header to work around 403/CORS: that defeats create-only upload semantics. The browser supplies its file's actual content length; application JavaScript should not invent a conflicting `Content-Length` header. [PR18](https://github.com/oogway-lab/flash-evals/pull/18) · [R2 CORS documentation](https://developers.cloudflare.com/r2/buckets/cors/)

Set the web build's `MOSAIC_CSP_STORAGE_ORIGIN` to `https://<BUCKET>.<ACCOUNT_ID>.r2.cloudflarestorage.com`. Bucket CORS and web CSP must both permit the upload; changing CORS cannot repair a CSP baked into the web build. Signed URLs are temporary bearer credentials; do not log them.

Validate with a small synthetic image/audio through the app: signing, browser preflight/PUT, linking verification, authenticated read, and the application's scoped deletion if cleanup is authorized. A replay PUT against the same signed random key should fail the create-only condition. A completed PUT that never links can leave an orphan object; there is no automatic orphan cleanup. Do not add lifecycle expiry to live dataset objects or use broad bucket deletion as cleanup.

## 8. Hyperdrive for the Cloudflare web Worker

Use the Supabase **direct** endpoint, database `postgres`, and provider-issued database credentials. Hyperdrive supplies its own upstream pool, so the transaction pooler is not the origin choice for this deployment. Upload the appropriate public CA, select it in Hyperdrive, use **TLS `verify-full`**, and disable query caching for fresh authorization/settings and read-after-write behavior. [Cloudflare Supabase guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/) · [Query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)

Repository-documented provisioning command (**source verified; changes Cloudflare resources**, working directory `apps/web`):

```sh
cd apps/web
pnpm exec wrangler cert upload certificate-authority \
  --ca-cert config/supabase-root-2021-ca.pem \
  --name flash-evals-supabase-ca
```

Create the Hyperdrive configuration in the dashboard. Enter the password directly in its protected form rather than putting a connection string in command-line arguments. Record the resource ID, endpoint, TLS mode/CA, and disabled-cache setting in the private release record. For a new deployment, replace the example resource ID in `apps/web/wrangler.jsonc` with the correct resource's ID; never replace the existing production binding during an ordinary app release.

The binding name is exactly **`HYPERDRIVE`**. The Worker reads its managed `connectionString`. It creates a request-scoped `pg.Pool` with `max: 1`, `maxUses: 1`, `idleTimeoutMillis: 0`, and a five-second connection timeout. It does not reuse a global TCP pool across Worker requests or configure driver TLS on the Worker-to-Hyperdrive socket. Hyperdrive validates TLS to Supabase. Missing Hyperdrive fails closed even if a legacy database URL remains in the environment. [Database client source](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/server/db/client.ts) · [Cloudflare pg guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/)

The API application pool is bounded at three connections; the Node worker application pool is bounded at four, with separate pg-boss pools. Account for API/worker replicas, deployment overlap, migrations, and Hyperdrive origins when checking the database connection budget. Do not scale worker/API replicas without checking capacity and job/provider behavior.

## 9. Railway API and separate private worker

Configure both services from the repository root so workspace packages/scripts and the lockfile are available. Select **Railpack**, not Nixpacks. Both use this source-verified, successfully deployed build command:

```sh
pnpm --filter @mosaic/api build
```

It builds shared object-storage/contracts/LLM/secrets packages before compiling the API. Keep dependencies needed by migrations and the TypeScript worker in the deployed image. Set `RAILPACK_PRUNE_DEPS=false` when development dependencies such as migration tooling must be retained. Verify the effective build output; do not assume a provider default preserves runtime or predeploy tooling. [Railpack package-manager/pruning documentation](https://railpack.com/languages/node)

| Setting               | API                                                                                | Separate worker                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Source root           | Repository root                                                                    | Repository root                                                                                   |
| Builder/build command | Railpack / command above                                                           | Railpack / command above                                                                          |
| Start command         | `pnpm --filter @mosaic/api start:railway`                                          | `cd apps/web && exec node ../../scripts/node-with-supabase-ca.mjs --import tsx scripts/worker.ts` |
| Production flag       | `NODE_ENV=production`, `MOSAIC_API_START_WORKER=false`                             | `NODE_ENV=production`; worker runs directly                                                       |
| Predeploy             | Reviewed `pnpm run db:migrate && pnpm run db:bootstrap-pilot-team` on the API only | None                                                                                              |
| Health                | `/health`                                                                          | No HTTP healthcheck; logs/supervisor and private status command                                   |
| Public networking     | API HTTPS domain; target port matches injected `PORT`                              | No public domain or TCP proxy                                                                     |
| Shutdown              | Verify the service's graceful termination window                                   | 30-second graceful window; default application drain is 20 seconds plus five-second buffer        |

The root `railway.json` describes the API. `railway.worker.json` describes the separate worker. For an existing legacy Config-as-Code service, choose the worker config file `/railway.worker.json`; leaving it on the root API config can overwrite the worker's start/health settings. The effective deployed configuration matters more than the dashboard form alone. **As checked on 12 October 2026**, Railway documents Config as Code as deprecated, with existing services supported until **1 December 2026**, and new services unable to opt in. For a new service, enter equivalent settings directly or use a separately reviewed supported IaC workflow; this repository does not contain that IaC migration. [Railway Config as Code](https://docs.railway.com/config-as-code)

The API's `PORT` comes from Railway. The server listens on that port without a loopback-only host restriction; the public-domain target port must match the injected value. Do not hard-code local port 3001 in a provider domain while the deployed process uses Railway's injected port. Verify the deployment logs and domain target together. Tracked `railway.json` sets a 30-second healthcheck timeout; effective service settings can differ. Inspect the deployment's effective setting and consciously choose a startup budget. Railway's deployment healthcheck is not a continuous worker monitor. [Railway healthchecks](https://docs.railway.com/deployments/healthchecks) · [Public networking](https://docs.railway.com/networking/public-networking)

API predeploy runs after build, before the service starts, with service variables available. A failed predeploy prevents the new deployment; it is not a database rollback. Inspect/set a reasonable predeploy timeout through the provider for migration releases; do not assume a timeout is configured merely because the command exists. [Railway predeploy documentation](https://docs.railway.com/deployments/pre-deploy-command)

The worker command uses `exec` to replace the launch shell and avoids package-manager wrappers between Railway and the worker. The Node CA wrapper forwards termination signals to one child process group and waits for drain; duplicate signal delivery would force immediate exit. Default `MOSAIC_WORKER_DRAIN_TIMEOUT_MS` is 20000; if increased, increase the service grace window above that value plus five seconds. Observe `worker.queue_ready` for both queues, then `worker.ready`. A successful API healthcheck alone does not establish a functioning worker. [PR16](https://github.com/oogway-lab/flash-evals/pull/16)

For compatibility-sensitive workflow changes, deploy the supported worker first, verify its readiness/contract, then deploy the API and enable new writes only when every worker supports them. Keep `MOSAIC_WORKFLOW_LLM_WRITES_ENABLED=false` until the contract gate is intentionally satisfied. Record the full API and worker SHAs independently; do not assume matching deployment timestamps mean matching source.

Use the existing GitHub-backed service or a deliberately selected exact source release. A merge can auto-deploy the API before the manual web release. Configure/check CI gating deliberately; verify whether the API service actually waits for GitHub checks rather than assuming it does. This guide does not change that policy.

## 10. DNS and the web production build/deploy

### DNS ownership

The apex belongs to the **existing web Worker**, once. Do not deploy `apps/site` separately with another Worker claiming `flashevals.dev`. The API has its own Railway domain such as `api.<WEB_DOMAIN>`, with the CNAME/verification record supplied by Railway. Clerk uses its own provider-specified verification records. Keep these ownerships separate; R2 needs no public media domain. A new-domain attachment is an infrastructure change, not an implicit part of every release. [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

Cloudflare route/custom-domain bindings are managed on the existing service in this deployment; `apps/web/wrangler.jsonc` contains no competing site routes. `--keep-vars` does not mean DNS/routes/bindings are protected from every config change. Review the selected Worker/account/config before deployment.

### Marketing integration

`apps/site` is an Astro static source with base `/marketing`. `scripts/build-marketing.mjs` builds it, packages its complete HTML into ignored `apps/web/generated/marketing.json`, and copies assets to ignored `apps/web/public/marketing`. Next's root route serves the HTML with `private, no-store`; middleware decides root versus dashboard per session. `/dashboard` keeps the existing app. OpenNext packages these assets under its `ASSETS` binding. Build scripts regenerate the files; do not deploy stale generated artifacts or commit them as the release source. Accessibility/reduced-motion behavior and narrow-screen stamp containment were retained and tested. [PR20](https://github.com/oogway-lab/flash-evals/pull/20)

### Public build-time values versus runtime configuration

Supply the following public settings before the production build. **Template values below; the command form was verified in the actual release.** Obtain the real publishable key from the chosen Clerk production instance, rather than using a placeholder that decodes to the wrong Frontend API host.

```sh
# Repository root; public variables only; changes local build output.
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='<CLERK_PRODUCTION_PUBLISHABLE_KEY>' \
NEXT_PUBLIC_API_BASE_URL='https://api.<WEB_DOMAIN>' \
NEXT_PUBLIC_CLERK_SIGN_IN_URL='/sign-in' \
NEXT_PUBLIC_CLERK_SIGN_UP_URL='/sign-up' \
MOSAIC_CSP_STORAGE_ORIGIN='https://<BUCKET>.<ACCOUNT_ID>.r2.cloudflarestorage.com' \
AUTH_DEV=false AUTH_DEV_ALLOW_INSECURE=0 \
pnpm run web:build:cloudflare
```

This builds marketing/shared packages and runs OpenNext's production build with Next's supported `next build --webpack` command. Retain the exact Next 16.3.8 pin. The expected output is `apps/web/.open-next/worker.js` plus `.open-next/assets`. Build-time CSP decodes the Clerk publishable key and includes the API/storage origins. Runtime variables cannot repair a CSP or browser bundle already built with the wrong values; rebuild when they change. A fixture/test Clerk key is not production configuration. [Security-header source](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/config/security-headers.mjs)

Review warnings. Non-hosted production builds can warn rather than fail when the Clerk key is missing; do not interpret a green build alone as usable login. `WORKERS_CI=1` makes the relevant hosted build guard fail in that situation, but it is a platform build flag, not a runtime authentication setting.

In the existing Worker settings, preserve `HYPERDRIVE` and `ASSETS`, all runtime variable names, and encrypted secrets. The current `wrangler.jsonc` declares `MOSAIC_DEFAULT_TEAM_ID`; its value takes effect from config and must match the intended pilot team even when using keep-vars. Enter server secrets through the provider's encrypted secret surface. The web encrypted secrets required by this topology are `CLERK_SECRET_KEY`, `INTERNAL_API_TOKEN`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`.

### Deployment path actually used

The OpenNext adapter deploy wrapper stopped **before upload** because it wanted a local Hyperdrive simulation connection. No database credential or local simulation configuration was added to work around it. The successfully used existing Wrangler path was:

```sh
# Repository root; VERIFIED; changes the existing production Worker.
# Run only after building/reviewing the exact approved release.
OPEN_NEXT_DEPLOY=true pnpm --filter @mosaic/web exec wrangler deploy \
  --keep-vars \
  --message "Approved release; source $RELEASE_SHA"
```

`OPEN_NEXT_DEPLOY=true` is the adapter's deployment recursion marker, allowing direct Wrangler upload of the already-built output instead of redirecting back into the adapter wrapper. It is a command-level tool flag, not an application runtime secret or a permanent provider variable. This path is recorded for the pinned adapter baseline; reverify the path after a separately reviewed adapter upgrade. It does not bypass production database validation or substitute mocks.

The wrapper's generic `deploy:cloudflare` package script exists, but it was not the successful final command for this release. Keep the tested build-plus-upload sequence as the baseline. The existing OpenNext config uses dummy incremental/tag/cache-purge adapters and direct queue behavior; it does not require provisioning an extra cache bucket or Cloudflare queue for this rollout.

`--keep-vars` preserves dashboard-configured plain variables absent from the config. It does **not** correct wrong declared values, supply missing build-time variables, configure Hyperdrive TLS/caching, preserve every route/resource declaration, back up secrets, or pin a source SHA. Wrangler documents that encrypted secrets are not removed by normal deploy unless explicitly deleted. Confirm names/counts in the masked settings UI; never use full Worker-version JSON as a convenient variable dump. [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) · [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

Record the upload's version ID and independently inspect the active deployment/percentage:

```sh
# Repository root; VERIFIED read-only metadata check.
pnpm --filter @mosaic/web exec wrangler deployments list \
  --name flash-evals --json
```

The deploy annotation associates the source SHA with the release; combine it with the recorded local `git rev-parse HEAD`, successful build, and output version. Do not assume an arbitrary live Worker exposes its Git SHA through its public homepage. Never print `wrangler versions view --json` for credential inspection: full version metadata may include secret binding values. Masked UI/name-only inspection is the safe procedure used here.

## 11. Codex MCP login and acceptance

Check unauthenticated discovery first (**read-only; URL templates**):

```sh
curl -i 'https://api.<WEB_DOMAIN>/.well-known/oauth-protected-resource/mcp'
curl -i 'https://api.<WEB_DOMAIN>/mcp'
```

Expect a resource metadata document containing the exact resource URL, Clerk authorization server, and header bearer method; expect unauthenticated `/mcp` to return 401 with its metadata challenge. The code also supports the root protected-resource metadata path. A 200 metadata response or 401 challenge proves discovery, not a client's completed OAuth flow.

For Codex, use a named Streamable HTTP MCP server and the configured pinned client. **Configuration-changing template; options verified with Codex CLI 0.162.1 help. This exact placeholder setup was not executed today.**

```sh
codex mcp add flash-evals \
  --url 'https://api.<WEB_DOMAIN>/mcp' \
  --oauth-client-id '<CLERK_OAUTH_CLIENT_ID>'
codex mcp login flash-evals --scopes 'openid,profile,email,flash-evals:eval'
```

Use a profile actually allowed by the Clerk OAuth application. A read-only account/client should request `flash-evals:read`; routine evaluations use `flash-evals:eval`. `flash-evals:admin` exposes destructive/provider-key operations and is not the default grant for a routine agent. The server's current resource metadata does not advertise `scopes_supported`; explicitly request the intended scopes when supported. Its compatibility fallback for OAuth clients with no Flash Evals profile scope is `eval`.

Complete consent in the user's browser, register the exact callback Codex displays, and reload/reconnect the client if required. Current official Codex docs describe callback selection and issuer-bound responses; do not assume every client version uses `/callback` with no suffix or fixed port. Preserve the client's private OAuth store; do not export its tokens into shell headers. A native public client should use the provider's appropriate PKCE/client policy rather than placing a secret in a command argument. [Official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

The inspected CLI also has `--oauth-resource`, but do not add an override blindly. The MCP resource audience is exactly the server's configured URL, including `/mcp`. Previous client setup encountered a **duplicate `resource` parameter** when resource configuration was layered. Use one resource source, inspect only redacted/non-secret authorization parameters if diagnosing a duplicate, and remove an unnecessary override rather than disabling audience validation. The commands above are supported templates; verify the actual client/provider registration, callback, and resource configuration before treating OAuth acceptance as complete.

After login, perform these tool checks through the supported client, without extracting credentials:

1. `get_current_user`: verify the intended admitted identity.
2. `list_workspaces`, then `list_projects` with a returned `workspaceId`.
3. `list_eval_context` with returned workspace/project IDs; discover available models/routes rather than guessing model identifiers.
4. `tools/list`: verify the current role's catalog, schemas and effects. The source catalog has 84 tools across profiles; the visible count can be lower by scope.
5. `resources/templates/list` and a tenant-owned `resources/read`: the eight parameterized templates are not an inventory returned by `resources/list`. The historical `mosaic://` URI prefix remains valid.
6. Read `create_eval_happy_path` via `prompts/get`; it is guidance, not an evaluation by itself.
7. Run synthetic keyless acceptance in the approved environment. For a real provider test, review spend/data destination first, use a stable idempotency key, wait for terminal run state, and inspect cell outputs/scores/cost provenance.

Check HTTP status, JSON-RPC `error`, `result.isError`, and tool-specific state. HTTP 200 can still contain a failed tool or a validation result with `passed=false`. A successful MCP connection does not establish worker execution. A timeout does not prove a run was not created; reuse the same logical idempotency key or discover the existing run before repeating a write. Provider retry can incur another charge. Destructive `confirm: true` arguments do not implement human authorization; retain client approval controls. [MCP operating guide](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/docs/mcp-eval-server.md)

## 12. Configuration reference: exact names, owners, and entry points

**Classification:** Public = safe to embed in browser output; Internal = non-secret server/policy setting; Secret = confidential credential/key/credential-bearing URL. Keep actual account IDs/prefixes in the private deployment record. Railway variables are entered on the correct service/environment; Cloudflare secrets go in encrypted Worker secrets, other server settings in runtime variables; build values go in the operator's build environment (or a separately configured build pipeline). Do not duplicate API environment values into a web env file merely to copy examples.

Required means required for this chosen hosted topology or feature, not necessarily an API startup validation in isolation. Optional settings are included so a fresh operator can tell what may remain unset. Exact readers are linked in the source map at the end.

### 12.1 Core, identity, URLs, and database

| Exact name                          | Component / classification                                                                      | How the human obtains/selects it and where to enter it                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                          | API, worker, web runtime / Internal; required                                                   | Select `production`; enter in Railway API/worker and web runtime. API's Railway start script also sets it.                                                                                                                |
| `DATABASE_URL`                      | API, worker, migration/bootstrap operator / Secret; required                                    | Supabase Connect panel plus protected database password, selected direct/session endpoint and verified TLS. Enter as protected Railway variables/operator injection. Never put it in web Wrangler config or browser vars. |
| `NODE_EXTRA_CA_CERTS`               | Node launcher / Internal optional                                                               | Public CA file path from the verified project certificate. Wrapper supplies repo CA by default; only override intentionally in the Node service/operator environment.                                                     |
| `MOSAIC_WEB_DATABASE_URL`           | Local Next Node server only / Secret optional                                                   | Operator's local database URL, entered in local web env. Production Cloudflare uses `HYPERDRIVE`; do not add a production URI as fallback.                                                                                |
| `PORT`                              | API / Internal platform-supplied                                                                | Railway injects it; match the public-domain target port. Local default is 3001. Worker has no HTTP port.                                                                                                                  |
| `API_BASE_URL`                      | Web server / Internal URL; required baseline                                                    | Select publicly reachable Railway API HTTPS origin; enter web runtime. A Railway internal hostname is inaccessible from the Worker.                                                                                       |
| `NEXT_PUBLIC_API_BASE_URL`          | Web build and runtime / Public; required baseline                                               | Same intended public API origin; enter public build env and Worker variable. Also contributes to build-time CSP.                                                                                                          |
| `MOSAIC_API_PUBLIC_URL`             | API / Public-origin setting; optional for R2                                                    | Select its HTTPS public origin; enter API variables. Used for local-adapter absolute upload URLs, not a replacement for R2 endpoint.                                                                                      |
| `CORS_ORIGINS`                      | API / Internal policy; required in production                                                   | Choose exact admitted web origin(s), comma separated; enter API variables. No wildcard/guessed origin needed.                                                                                                             |
| `INTERNAL_API_TOKEN`                | API and web server / Secret; required                                                           | Generate one high-entropy secret (32 random bytes) through approved secret manager; enter the **same value** in protected API variables and encrypted web secret. Worker does not need it for direct queue execution.     |
| `MOSAIC_TENANCY_MODE`               | API/web; shared worker config / Internal; required policy                                       | Select `single-org` for this pilot; enter API/web consistently. Worker carries matching deployment policy. Do not silently change to `isolated`.                                                                          |
| `MOSAIC_ALLOWED_EMAIL_DOMAIN`       | API/web; shared worker config / Internal; required policy                                       | Owner selects exact `oogwaylabs.com` for existing pilot; enter API/web consistently. It is not a suffix allowlist.                                                                                                        |
| `MOSAIC_DEFAULT_TEAM_ID`            | API, bootstrap, web config; shared worker setting / Internal; required for single-org admission | Generate/select one team UUID for a fresh install; use existing row ID for an existing install. Enter API/bootstrap and matching Wrangler/web variable; preserve current ID in routine releases.                          |
| `MOSAIC_DEFAULT_TEAM_NAME`          | Bootstrap/API predeploy / Internal optional                                                     | Owner selects name (default `Oogway Labs`); enter API environment used by bootstrap. Existing ID/name must match.                                                                                                         |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Web build and runtime / Public; required                                                        | Production Clerk instance key panel; enter public build env and Worker variable. Not interchangeable with server secret.                                                                                                  |
| `CLERK_SECRET_KEY`                  | API and web server / Secret; required                                                           | Same production Clerk instance key panel; enter protected API variable and encrypted Worker secret. Worker does not require it for queue execution.                                                                       |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`     | Clerk web build/runtime / Public; required baseline                                             | Application route `/sign-in`; enter public build/runtime variable.                                                                                                                                                        |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL`     | Clerk web build/runtime / Public; required baseline                                             | Application route `/sign-up`; enter public build/runtime variable.                                                                                                                                                        |

### 12.2 Storage and Cloudflare bindings

| Exact name                  | Component / classification                                                                     | Human source and destination                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MOSAIC_STORAGE_ADAPTER`    | API, worker, web server / Internal; required baseline                                          | Select `r2` in all three component environments. Blank defaults can select another adapter.                                                                                                         |
| `R2_ACCOUNT_ID`             | API, worker, web server / Internal; required                                                   | Cloudflare account overview, 32 hex characters; enter all three server environments.                                                                                                                |
| `R2_BUCKET`                 | API, worker, web server / Internal; required                                                   | Name of the private bucket created/selected in R2; enter all three.                                                                                                                                 |
| `R2_ACCESS_KEY_ID`          | API, worker, web server / Secret; required                                                     | Generated R2 S3 credential pair; protected Railway variables and encrypted Worker secret.                                                                                                           |
| `R2_SECRET_ACCESS_KEY`      | API, worker, web server / Secret; required                                                     | Matching R2 S3 secret; same entry surfaces as key ID. Do not paste a Cloudflare bearer token here.                                                                                                  |
| `R2_STORAGE_PREFIX`         | API, worker, web server / Internal optional                                                    | Select a stable safe namespace, or deliberately use no prefix; enter matching values in all three. Changing it disconnects existing metadata from media.                                            |
| `MOSAIC_CSP_STORAGE_ORIGIN` | Web build; retained web runtime var / Public; required for browser uploads                     | Construct exact bucket/account S3 HTTPS origin from chosen resource; enter **before build**, plus retained web variable.                                                                            |
| `HYPERDRIVE`                | Cloudflare managed resource binding / Internal handle with secret managed connection; required | Create/select verified Hyperdrive resource; enter resource ID in `apps/web/wrangler.jsonc` under this exact binding name. Enter database credentials only in Hyperdrive's protected resource setup. |
| `ASSETS`                    | Cloudflare generated asset binding / Public assets; required                                   | Build generates `.open-next/assets`; Wrangler `assets.binding` declares `ASSETS`. No key is generated.                                                                                              |

R2 S3 credentials are used instead of a native R2 Worker binding. Do not add an invented `R2` binding as a substitute for these adapter settings. Supabase Storage variables `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, and `SUPABASE_STORAGE_PREFIX` exist for an alternate adapter, but are not required/configured by this R2 topology. The service-role key is secret if that alternate deployment is deliberately used; never add it to browser code.

### 12.3 API MCP OAuth settings

| Exact name                              | Classification / requirement            | Human source and destination                                                                                                                                                                  |
| --------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MOSAIC_MCP_ENABLED`                    | Internal; required for MCP              | Select `true`; API variable.                                                                                                                                                                  |
| `MOSAIC_MCP_RESOURCE_URL`               | Public endpoint; required OAuth         | Exact API HTTPS resource ending `/mcp`; API variable. Token audience must agree.                                                                                                              |
| `CLERK_ISSUER`                          | Public issuer; required OAuth           | Exact production Clerk OAuth issuer from that instance's metadata/provider settings; API variable. Preserve exact URL spelling, including any slash policy; do not substitute the web origin. |
| `CLERK_PUBLISHABLE_KEY`                 | Public; required OAuth                  | Production instance publishable key; API variable (different name from web's `NEXT_PUBLIC_` key).                                                                                             |
| `CLERK_JWT_KEY`                         | Public verification PEM; required OAuth | Clerk's correct JWT signing verification public key; API variable preserving PEM/newlines (code normalizes escaped newlines). Never use a private key/access token.                           |
| `MOSAIC_MCP_OAUTH_CLIENT_ID`            | Public ID; required for pinned policy   | Clerk OAuth application's registered client ID; API variable and matching Codex client configuration.                                                                                         |
| `MOSAIC_MCP_OAUTH_DYNAMIC_CLIENTS`      | Internal; alternative policy            | `false` for pinned baseline. Only set true after provider/client registration policy review; API variable.                                                                                    |
| `MOSAIC_MCP_ALLOWED_ORIGINS`            | Internal optional allowlist             | Actual browser MCP client origins, comma separated; API variable. Native no-Origin client can leave unset.                                                                                    |
| `CLERK_AUTHORIZED_PARTIES`              | Internal optional restriction           | Deliberate permitted `azp` values for the provider token policy; API variable. No implicit fallback to the client ID. Leave unset unless required/verified.                                   |
| `MOSAIC_MCP_RAW_TOKEN_FALLBACK_ENABLED` | Internal; must be false in production   | API variable false or unset; production true is rejected.                                                                                                                                     |
| `MOSAIC_MCP_TOKEN_PEPPER`               | Secret; local raw-token path only       | If using that separate development path, generate/store an independent stable secret in local API configuration. Not required for production Clerk OAuth.                                     |
| `MOSAIC_MCP_LOCAL_TOKEN`                | Secret; local example/client only       | Created by the documented local token tool and held in private client process environment. Do not configure it as the production OAuth solution.                                              |

`CLERK_SECRET_KEY` is also required by API OAuth and live email rechecks (listed above). An OAuth client secret, if a deliberately selected confidential client needs one, belongs in that client's protected credential facility; it is not an additional named Flash Evals API variable. Do not supply one in a command argument just because a CLI accepts that option.

### 12.4 Provider credentials, workflow contract, and worker controls

| Exact name                                    | Component / classification                                             | Human source and destination                                                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MOSAIC_SECRETS_ENC_KEY`                      | API and every worker / Secret; required for saved provider credentials | Generate once as base64 of **32 random bytes**, retain with protected backups; enter identical protected API/worker variables. Do not rotate without a key migration.                  |
| `OPENAI_API_KEY`                              | API/worker provider path / Secret optional                             | Selected OpenAI project/provider key; protected API/worker vars if using environment credentials. Alternative: team-managed key via authenticated app/admin MCP, encrypted in DB.      |
| `AI_GATEWAY_API_KEY`                          | API/worker / Secret optional                                           | Vercel AI Gateway key from selected account/project; protected API/worker vars or supported stored credential.                                                                         |
| `OPENROUTER_API_KEY`                          | API/worker / Secret optional                                           | OpenRouter account key; protected API/worker vars or stored credential.                                                                                                                |
| `BIFROST_API_KEY`                             | API/worker / Secret optional                                           | Chosen Bifrost deployment's credential; protected API/worker vars or stored credential.                                                                                                |
| `SONIOX_API_KEY`                              | API/worker STT / Secret optional                                       | Soniox account key; protected API/worker vars or supported stored credential.                                                                                                          |
| `GEMINI_API_KEY`                              | API/worker audio/STT / Secret optional                                 | Chosen Google/Gemini API project key; protected API/worker vars or supported stored credential. Route must also pass capability verification.                                          |
| `OPENROUTER_BASE_URL`                         | API/worker / Internal optional endpoint                                | Owner-approved OpenRouter endpoint override; default `https://openrouter.ai/api/v1`; provider environment.                                                                             |
| `BIFROST_BASE_URL`                            | API/worker / Internal; required when that transport selected           | URL supplied by chosen Bifrost operator; provider environment. Validate destination before sending keys/inputs.                                                                        |
| `MOSAIC_LLM_PROVIDER`                         | API legacy/default setup path / Internal optional                      | Choose supported `auto`, `vercel-ai`, `openai`, `gateway`, `openrouter`, or `bifrost`; API variable. Explicit workflow route snapshots are authoritative. Not a mock-provider switch.  |
| `PROMPT_OPTIMIZER_MODEL`                      | API; web helper configuration / Internal optional                      | Select an available provider-compatible model for optimizer/schema/judge setup; keep intended API/web values aligned. Source fallback is `gpt-5.4-mini`, not a latest-model guarantee. |
| `MOSAIC_STT_CAPABILITY_PROBES`                | API / Internal optional JSON                                           | Result mapping from deliberate live synthetic STT probes, or use stored probe results; API setting. Do not mark routes available based only on key presence.                           |
| `MOSAIC_GATEWAY_FALLBACK_MODELS`              | Provider factory / Internal optional                                   | Leave empty for evaluation accuracy: nonempty fallback lists are rejected until served-model provenance is supported. Do not enable to mask model errors.                              |
| `MOSAIC_GATEWAY_HTTP_REFERER`                 | Provider execution / Public attribution optional                       | Approved attribution URL; enter where gateway requests execute, if desired.                                                                                                            |
| `MOSAIC_GATEWAY_APP_TITLE`                    | Provider execution / Public attribution optional                       | Chosen app title; same provider environment. No authentication role.                                                                                                                   |
| `MOSAIC_WORKFLOW_LLM_WRITES_ENABLED`          | API / Internal rollout flag                                            | False until API/every worker are compatible, then explicit policy choice; API variable.                                                                                                |
| `MOSAIC_WORKFLOW_LLM_WORKER_CONTRACT_VERSION` | API / Internal rollout contract                                        | Worker-supported snapshot contract from shared source (1 on this baseline); API variable paired with compatible worker.                                                                |
| `MOSAIC_API_START_WORKER`                     | Railway API launcher / Internal; required false for split topology     | Literal `false`; API variable. Otherwise launcher also spawns a worker.                                                                                                                |
| `EVAL_CONCURRENCY`                            | Worker / Internal optional                                             | Operator-selected per-run cell concurrency; source defaults 5 eval / 4 workflow, minimum 1. Worker variable; review provider/DB budgets.                                               |
| `RUN_STALE_CLAIM_MS`                          | Worker/status / Internal optional                                      | Operator-selected eval recovery lease; default 900000 ms, minimum 60000. Worker/operator status environment.                                                                           |
| `WORKFLOW_STALE_CLAIM_MS`                     | Worker/status / Internal optional                                      | Same choice for workflow cells; same default/minimum.                                                                                                                                  |
| `MOSAIC_WORKER_DRAIN_TIMEOUT_MS`              | Worker / Internal optional                                             | Drain window default 20000 ms, accepted minimum 1000, capped 300000; worker variable. Coordinate service termination window.                                                           |

No real provider key is required to prove public routing or health. Current keyless synthetic checks are not a claim that paid provider execution passed. Do not put provider keys in `NEXT_PUBLIC_*` or copy them into a production web build to avoid a runtime error.

### 12.5 Limits and optional observability

All following names are source verified. They are optional policy/integration settings; an env name being accepted does not establish a deployed external integration.

| Exact name                                 | Component / classification                                 | Human source and destination                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MOSAIC_MAX_RUN_CELLS`                     | API / Internal                                             | Owner-selected bound; default 10000, maximum 16000; API variable.                                                                                                        |
| `MOSAIC_TEAM_DAILY_SPEND_CAP_USD`          | API / Internal                                             | Owner-selected positive rolling recorded-spend cap; unset disables it; API variable. Does not reserve in-flight spend or enforce a provider billing ceiling.             |
| `MOSAIC_RATE_LIMIT_LLM_PER_MINUTE`         | API / Internal                                             | Owner-selected per-user limit; default 20; API variable. Zero disables.                                                                                                  |
| `MOSAIC_RATE_LIMIT_RUNS_PER_MINUTE`        | API / Internal                                             | Owner-selected per-user run/retry limit; default 10; API variable. Zero disables.                                                                                        |
| `MOSAIC_ERROR_TRACKING_DSN`                | API / confidential integration config                      | Only obtain from an approved monitoring project after implementation/access review; API setting. Existing integration is a placeholder shell, not proof of SDK delivery. |
| `MOSAIC_ANALYTICS_KEY`                     | API / confidential integration credential                  | Approved analytics project credential, if implemented; API setting. No new integration is provisioned by this runbook.                                                   |
| `MOSAIC_ALERT_WEBHOOK_URL`                 | API / Secret capability URL                                | Approved private alert destination, if implemented; protected API setting. Do not publish it or assume alerts are active.                                                |
| `MOSAIC_PROFILING_ENABLED`                 | API / Internal                                             | Operator opt-in; default false; API variable.                                                                                                                            |
| `MOSAIC_FLAG_ANALYTICS_EVENTS`             | API / Internal                                             | Integration owner opt-in; default false; API variable.                                                                                                                   |
| `MOSAIC_FLAG_ERROR_TRACKING`               | API / Internal                                             | Integration owner opt-in; default false; API variable.                                                                                                                   |
| `MOSAIC_FLAG_PROFILING`                    | API / Internal                                             | Integration owner opt-in; default false; API variable.                                                                                                                   |
| `NEXT_PUBLIC_MOSAIC_ANALYTICS_KEY`         | Browser build / Public credential intended for browser use | Only approved public client key from chosen analytics project; web build variable. Never substitute a secret server key.                                                 |
| `NEXT_PUBLIC_MOSAIC_ERROR_TRACKING_DSN`    | Browser build / Public client config                       | Approved public browser DSN, if integration exists; web build variable.                                                                                                  |
| `NEXT_PUBLIC_MOSAIC_ANALYTICS_DEBUG`       | Browser build / Public flag                                | Operator-selected debug mode, default false; web build variable.                                                                                                         |
| `NEXT_PUBLIC_MOSAIC_FLAG_ANALYTICS_EVENTS` | Browser build / Public flag                                | Approved opt-in, default false; web build variable.                                                                                                                      |
| `NEXT_PUBLIC_MOSAIC_FLAG_ERROR_TRACKING`   | Browser build / Public flag                                | Approved opt-in, default false; web build variable.                                                                                                                      |
| `MOSAIC_TIMING_LOGS`                       | Web server / Internal                                      | Temporary diagnostic choice (`true` logs every timing span); web runtime setting.                                                                                        |
| `MOSAIC_TIMING_SLOW_MS`                    | Web server / Internal                                      | Operator slow-span threshold; default 1000 ms; web runtime setting.                                                                                                      |

### 12.6 Provider/build/operator controls and forbidden sample settings

| Name / setting                                                                               | Purpose and handling                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RAILPACK_PRUNE_DEPS`                                                                        | Railpack build setting (non-secret), documented by provider. Template false retains tooling needed by predeploy/TypeScript runtime. Enter on appropriate Railway services and verify the built image.                                                                                                                                |
| `RAILPACK_NODE_VERSION`                                                                      | Optional provider Node version override (non-secret). Select the reviewed repo pin if overriding automatic detection; not a required application variable.                                                                                                                                                                           |
| `OPEN_NEXT_DEPLOY`                                                                           | Command-level adapter flag used for direct verified Wrangler upload; not a runtime variable.                                                                                                                                                                                                                                         |
| `WORKERS_CI`                                                                                 | Cloudflare build-system flag; affects build-time missing-Clerk-key guard. Not admission configuration.                                                                                                                                                                                                                               |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`                                             | Optional Wrangler automation authentication/target selection; first is secret, second non-secret. Human obtains scoped management token/account ID from Cloudflare. Keep in protected deploy automation; not application Worker bindings or R2 S3 keys. Interactive Wrangler OAuth does not require copying a token into this guide. |
| `RAILWAY_API_TOKEN` / `RAILWAY_TOKEN`                                                        | Optional Railway automation credentials (secret account/project scopes respectively); human obtains through approved Railway account/project workflow. Not application API auth or Clerk tokens. Prefer existing authenticated provider tools for operator checks.                                                                   |
| `API_ENV` / `WEB_ENV`                                                                        | Local readiness-script input paths; defaults `apps/api/.env` / `apps/web/.env`. Paths are non-secret; file contents are confidential. Only use human-prepared, ignored, access-restricted files.                                                                                                                                     |
| `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT`, `RAILWAY_API_SERVICE`, `RAILWAY_WORKER_SERVICE` | Non-secret target selectors for the repository live-readiness script; human gets exact IDs/names from provider metadata. Distinct API/worker services are required.                                                                                                                                                                  |
| `CLOUDFLARE_WEB_ENV`                                                                         | Path to confidential current web configuration used by live-readiness script; not a Cloudflare environment name. Do not create it by dumping provider secrets.                                                                                                                                                                       |
| `WRANGLER_BIN`                                                                               | Optional local tool path for live-readiness script, default `apps/web/node_modules/.bin/wrangler`.                                                                                                                                                                                                                                   |
| `WEB_BASE_URL`                                                                               | Optional public web URL for split-health operator script. That script's `API_BASE_URL` is an operator API target, not automatically inherited web runtime configuration.                                                                                                                                                             |
| `AUTH_DEV`, `AUTH_DEV_ALLOW_INSECURE`                                                        | Local web bypass only. Keep absent/false/0 in production; never adopt fixture values as hosted configuration.                                                                                                                                                                                                                        |
| `MOSAIC_ALLOW_INSECURE_DEV_DEFAULTS`                                                         | Local API/storage bypass; refused when production. Keep unset/false.                                                                                                                                                                                                                                                                 |
| `MOSAIC_ALLOW_PUBLIC_EMAIL_DOMAIN`                                                           | Dangerous single-org policy override for common public domains. Not required for `oogwaylabs.com`; leave unset/false.                                                                                                                                                                                                                |
| `MOSAIC_DEFAULT_USER_ID`, `MOSAIC_DEFAULT_WORKSPACE_ID`                                      | Local development-bypass principal defaults; not production sign-in identifiers.                                                                                                                                                                                                                                                     |
| `R2_ENDPOINT`                                                                                | Loopback S3 test endpoint only; production rejects it. Leave unset.                                                                                                                                                                                                                                                                  |
| `MOSAIC_IMAGE_STORAGE_ADAPTER`                                                               | Legacy alias. Use explicit `MOSAIC_STORAGE_ADAPTER=r2` instead.                                                                                                                                                                                                                                                                      |
| `UPLOAD_DIR`                                                                                 | Local disk adapter location; not a hosted R2 storage setting. No Railway volume is needed.                                                                                                                                                                                                                                           |
| `NEXT_PHASE`, `CI`, `MOSAIC_PACKAGES_BUILT`, Playwright/coverage/smoke-test variables        | Build/test tooling state, not required production settings. Do not set `NEXT_PHASE` to obtain a fake runtime database fallback. Consult tracked test config for disposable tests only.                                                                                                                                               |

For new secrets, the human can generate random bytes within the approved secret manager. `openssl rand -base64 32` is the repository's documented generation method for the internal token/encryption key, but its output is secret: direct it to a protected file/manager, not a shared terminal transcript. Generate the internal token and encryption key independently. This documentation task generated neither.

## 13. Release tests and acceptance

### Repository checks

The following command forms are verified for this baseline; they change only local build/test output unless a configured test targets external services:

```sh
pnpm run quality
pnpm run typecheck
pnpm run marketing:build
pnpm exec playwright test tests/e2e/health.spec.ts
pnpm exec playwright test --config playwright.marketing.config.ts
pnpm run web:build:cloudflare
pnpm run web:smoke:cloudflare
```

Run browser/Worker fixture tests only with their documented isolated test setup. Fixture authentication/mock backends are useful regressions, not real Clerk verification. Production build needs real **public** configuration before it is treated as deployable. `web:smoke:cloudflare` starts a local Wrangler Worker; it is not a live production login test. Repository CI also includes migration checks on a fresh disposable DB, package/web tests, static/dependency checks, and secret/SAST scans. Inspect CI on the **exact** release SHA.

### Readiness-script limits

`pnpm run deploy:check` is source verified and validates human-prepared local API/web config files without needing to print values; it does not inspect actual Railway start/health settings. The checked web config forbids production DB/provider keys. `pnpm run deploy:check:live` obtains full Railway variable values into private temporary files even though its result reports comparisons; **do not run it under a no-secret-read workflow**. Use masked provider settings/name-only service metadata and existing authorized runtime probes instead. Token equality can be checked by an authorized human/secret manager without showing either value.

`pnpm run smoke:split-health` has a stale internal assertion that detailed health `storage` is `supabase`. With a valid internal token on this R2 deployment, it can fail that assertion despite healthy R2. Do not change the storage adapter to satisfy it. Public-only health usage avoids that assertion; a revised R2-aware detailed check is a follow-up code improvement, not a change made by this guide.

### Anonymous health/routing

Read-only URL templates (the corresponding production checks passed):

```sh
curl -fsS 'https://<WEB_DOMAIN>/api/health'
curl -fsS 'https://api.<WEB_DOMAIN>/health'
curl -sS -D - -o /dev/null 'https://<WEB_DOMAIN>/'
curl -sS -D - -o /dev/null 'https://<WEB_DOMAIN>/dashboard'
curl -sS -D - -o /dev/null 'https://<WEB_DOMAIN>/runs/example?tab=cost'
```

Do not attach cookies/tokens or print complete browser request headers. Root should return marketing and private/no-store; anonymous protected paths should redirect to sign-in; assets should load. API public health performs DB and storage checks but returns only aggregate status; web `/api/health` is simple web liveness. A web 200 alone cannot prove API/DB/worker readiness.

### Real browser and account acceptance

Use a supported browser route available to the operator. Identify the actual browser and control method in the private acceptance report, and distinguish real Clerk checks from fixture browser tests. The user enters passwords/verification directly; never read/store them or inspect authentication tokens.

Verify anonymous `/`; sign-in entry; resulting admitted dashboard; authenticated `/` and `/sign-in` redirects; datasets/prompts/runs/settings; direct protected links; refresh; Back/Forward; interrupted/repeated login entry; and logout to public marketing. Preserve a useful authenticated session at the end unless logout needs another genuine test. Middleware redirect checks do not replace server-side admission. Use an authorized existing alternate account for a live denial test; do not create a new user or weaken the policy to obtain coverage.

Use a synthetic dataset with reference labels for keyless workflow evaluation and metric scoring. Then, only with reviewed provider/spend authorization, use one small real-provider evaluation and inspect its terminal state, scores, usage and provider cost source. Do not treat the marketing demo animation or a deterministic mock provider as a paid-provider success.

### Worker and detailed runtime acceptance

Source-verified read-only private status command from repository root, with the correct protected `DATABASE_URL` already injected:

```sh
pnpm run worker:status
```

It reports queue/database readiness, queue ages/counts, run states and persisted cost estimates without reading/printing prompt/output/key content. Confirm process liveness and `worker.ready` separately in Railway. In an authorized protected runtime, a detailed health call using the already-injected internal token can check `storage=r2`, DB/storage checks and no-volume status without exposing the token. Do not put a token value into a curl command line or log a full variable set.

Release acceptance is the combination of exact-source CI/build, active deployment metadata, public checks, real session/admission behavior, private worker liveness, and intentional execution tests. Record each as passed/failed/unrun, with genuine limitations.

## 14. Rollback by component

Rollback changes live state. Before acting, identify the regression, its component, the known-good source/version, and schema/config compatibility. Pause new writes/jobs only when required for consistency. A code rollback does not reverse migrations, external provider charges, stored objects, or encryption-key changes.

### Cloudflare web

Use the previously recorded compatible Worker version. Command form below is source/help documented; the rollback **was not executed** during the accepted rollout:

```sh
# Repository root; TEMPLATE; changes active web deployment.
pnpm --filter @mosaic/web exec wrangler rollback '<KNOWN_GOOD_VERSION_ID>' \
  --name flash-evals \
  --message 'Rollback after acceptance regression'
```

Check active deployment/percentage, masked bindings/secrets, marketing/health, and real routing after rollback. Previous versions can reference old binding configuration; inspect compatibility and availability of those resources first. Do not assume rollback recreates a deleted database/bucket/Hyperdrive resource. [Cloudflare rollback documentation](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

### Railway API/worker

Select the exact previously successful component deployment in Railway and use its supported rollback/redeploy workflow. Verify source SHA, variables/config, migrations, and workflow contract before promoting it. Stop newly gated writes if an older worker cannot execute captured snapshots. Preserve the worker's graceful shutdown window and allow durable jobs to recover through their established leases. Do not re-run a broad cleanup/reset or directly edit queue/cell state to simulate rollback. Verify API health and worker readiness separately afterward.

### Database, storage, identity, and keys

Database rollback is a reviewed recovery operation: prefer a backward-compatible forward fix or restore to a separate recovery database, validate, then deliberately cut over. Do not delete migration history or run inverse destructive SQL by guesswork. Pair the recovery point with its R2 object snapshot and encryption key. Restoring a DB alone can leave missing media or undecryptable provider credentials.

For a storage configuration regression, restore the recorded adapter/bucket/prefix/credential policy rather than deleting objects. Preserve create-only headers/CORS/CSP. A web rebuild may be needed for CSP changes. For Clerk/OAuth regression, restore the verified instance/client/issuer/audience/redirect configuration through an approved handoff; do not disable issuer, audience, domain, or verified-email checks. Credential rotations require coordinated API/web/worker updates and an old-key retention/cutover plan; do not casually regenerate `MOSAIC_SECRETS_ENC_KEY`.

## 15. Routine release checklist and troubleshooting

### Routine release checklist

1. Record approved full SHA, exact CI result, intended component scope, current active versions and rollback targets.
2. Inspect changes for migrations, schema/job contract, public build origins, provider dependencies, and source-controlled binding values. Preserve lockfiles and Next 16.3.8 unless an upgrade has separate proof.
3. Confirm protected backup/recovery readiness if data/schema changes are involved. Review pending migration SQL and existing journal; no reset/seed/replay.
4. Verify intended account/project/environment/service identities and masked config-name inventories. Keep internal token, encryption key, storage namespace and company policy consistent without displaying values.
5. Deploy compatible worker/API in the required order. Check predeploy result, API health, worker logs/liveness, and contract before enabling new writes.
6. Build marketing/web from that SHA with the correct public values, inspect build warnings, then upload to the existing web Worker with the tested keep-vars path.
7. Read active deployment IDs/traffic and component SHAs; verify assets/health/anonymous routes, real admitted session routes, storage flow and intended evaluation path.
8. Roll back the affected component if a genuine acceptance/availability/admission regression occurs. Keep data/config compatibility in view.
9. Write a private release record with UTC date, source/provider IDs, passed/failed/unrun checks, browser mode, incidents/recovery, and open gates. Never post an operational report publicly by default.

### Logs and likely failure modes

| Symptom                                                   | Evidence to inspect / safe next action                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nixpacks/Corepack install failure                         | Effective builder and root packageManager/lockfile. Use the verified Railpack config; do not randomly upgrade package managers.                                     |
| API/worker missing migration tool/`tsx`                   | Build/root directory, retained dependencies and `RAILPACK_PRUNE_DEPS`; inspect build output, not runtime secrets.                                                   |
| `ENETUNREACH` to Supabase                                 | Endpoint IP family and per-service outbound IPv6; session-mode alternative if deliberately selected.                                                                |
| Certificate-chain/hostname failure                        | Correct project/region CA, wrapper launch, existing `NODE_EXTRA_CA_CERTS`, Hyperdrive CA/mode. Never set rejectUnauthorized false.                                  |
| Too many DB clients/timeouts                              | DB capacity, bounded application pools, pg-boss pools, replicas and deployment overlap; don't stack poolers blindly.                                                |
| Principal API rejected/login configuration error          | Shared internal token consistency, exact team ID, existing team/bootstrap state, current verified email and matching API/web domain policy.                         |
| Login script blocked by CSP                               | Build-time publishable key and derived Clerk origin; rebuild with correct public settings. Runtime-only changes cannot repair it.                                   |
| `Unexpected loadManifest(...preview-props.json)`          | Exact deployed Next version and adapter baseline; retain/recover proven 16.3.8 rather than deploying the unsupported 16.4 build.                                    |
| Root serves dashboard to anonymous users or redirect loop | Real session state, no-cache entry response/redirects, exact middleware routes, Clerk callback subpaths and provider redirects. Do not add competing CDN redirects. |
| R2 signature/access failure                               | Matched S3 key/secret type, correct account/bucket/prefix, signed content type/size and required create-only header. Don't print signed URLs.                       |
| Browser R2 upload fails but server access works           | Exact CORS origin/PUT/headers, web build CSP, proxy `requiredHeaders`; don't weaken create-only behavior.                                                           |
| Worker deployment runs API healthcheck or port            | Effective selected service config: worker start/no HTTP health/no public domain. Root API config can override legacy worker dashboard settings.                     |
| Worker dies immediately on SIGTERM                        | `exec` launch path, CA wrapper signal isolation/forwarding, duplicate signals, drain timeout versus service grace window.                                           |
| Run stuck `pending_enqueue`/running                       | Private worker liveness, queue readiness/ages, stale-claim sweep and durable retry; preserve IDs/idempotency key, not blind duplicate submission.                   |
| MCP OAuth 401                                             | Sanitized `mcp.auth.rejected` reason and request ID; key/issuer/access-JWT type/audience and actual client. No unverified token decode or token dump needed.        |
| MCP client mismatch / `azp` rejection                     | Configured verified client-ID pin separately from explicit authorized-parties restriction; correct Clerk OAuth application.                                         |
| OAuth invalid duplicate resource                          | One resource source in client setup; remove duplicated override, retaining exact audience validation.                                                               |
| MCP account not linked                                    | Real admitted web sign-in once using the same Clerk identity, then reconnect; don't provision an arbitrary DB account.                                              |
| MCP 403 Origin                                            | Separate exact MCP allowlist, not web CORS; inspect the client's non-secret Origin.                                                                                 |
| HTTP 200 but MCP failure                                  | JSON-RPC error, `isError`, validation/run result fields; catalog listing alone is insufficient.                                                                     |
| Metric node lacks reference score                         | Dataset labels present, worker includes PR22 `metric_compare` label-loading fix, captured workflow config correct.                                                  |
| Detailed split-health script fails `storage`              | Script expects Supabase storage; current actual adapter is R2. Use a correct protected R2-aware check, not a provider change.                                       |

Use Cloudflare Worker observability and Railway build/deploy/runtime logs in their private provider surfaces. Keep returned request IDs and allowlisted error categories; redact unknown raw errors because provider/DB errors may contain sensitive content. Worker JSON events include queue/job/run/cell IDs and safe error codes, not prompt/output/key contents. Avoid unbounded live log streaming into a shared chat.

`worker.ready`, `worker.startup_failed`, `worker.shutdown_started`, `worker.shutdown_completed`, `worker.shutdown_forced`, `worker.drain_timed_out`, `job.failed`, `recovery.failed`, and `recovery.completed` are useful worker events. An oldest pending age over five minutes is a suggested manual investigation threshold, not an installed alert/SLA. Persisted costs are estimates/provenance, not provider billing records. Inspect the selected service's tracing/integration state; optional integration env names do not establish external telemetry delivery.

## 16. Backups, recovery drills, and pilot limits

The tracked backup runbook is an **operating plan**, not evidence of an installed schedule or a passed restore drill. PostgreSQL metadata, private R2 objects, and `MOSAIC_SECRETS_ENC_KEY` must be recoverable together. Assign an operator, protected encrypted backup destination, retention policy, and a tested recovery process before real-media dependence. Proposed source targets are 7 daily, 4 weekly, 12 monthly paired snapshots, a 24-hour recovery point, and a pre-pilot/quarterly drill; owners must approve/provision them. [Backup/restore plan](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/docs/storage-backup-restore.md)

For consistency, pause writes/new upload signing, gracefully stop the worker, wait for active uploads to finish and the ten-minute outstanding URL lifetime to expire, then take a database dump and object copy under one release/timestamp. Use a dedicated read-only R2 backup credential. Store checksums, completion status, source revision, snapshot pairing and operator in a protected log. Do not use `/tmp` for production media backups.

A backup template can use `pg_dump --format=custom --no-owner` and an S3-compatible object copy, but the operator must configure trusted TLS and protected credentials without placing a password-bearing URI in process arguments. Prefer a protected libpq service/password file or approved credential injection. Avoid broad reset/cleanup commands against production. A recovery drill restores into a **separate** empty database/private recovery bucket, verifies synthetic media/tenant authorization and decryption, and records elapsed recovery time before any production cutover. These procedures are templates, not evidence of a completed recovery drill.

Track real paid-provider execution, live alternate-account denial, a backup/restore drill, and seven actual days of internal pilot use with daily records as separate acceptance gates. Code tests, keyless evaluations and operational documentation do not close those gates. No hosted backup schedule, external alert integration, billing entitlement system, or customer-readiness claim is established by this runbook. Provider interruption may still be billable and retry may charge again.

## Source map and historical fixes

All code links here are pinned to the documented web/API baseline so subsequent main changes do not silently rewrite this guide's evidence.

| Evidence                                     | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package scripts, pnpm and Node policy        | [Root package.json](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/package.json), [.nvmrc](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/.nvmrc), [CI](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/.github/workflows/ci.yml)                                                                                                                                                                                                                                                                                                   |
| Web/API exact script definitions             | [Web package](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/package.json), [API package](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/api/package.json)                                                                                                                                                                                                                                                                                                                                                                                                    |
| API core/OAuth/limit env readers             | [config.ts](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/api/src/config.ts), [featureFlags.ts](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/api/src/featureFlags.ts)                                                                                                                                                                                                                                                                                                                                                                                          |
| API/worker launches and CA wrapper           | [railway.json](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/railway.json), [railway.worker.json](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/railway.worker.json), [Node CA launcher](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/scripts/node-with-supabase-ca.mjs)                                                                                                                                                                                                                                                       |
| Database migration/bootstrap                 | [drizzle.config.ts](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/drizzle.config.ts), [migration journal](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/server/db/migrations/meta/_journal.json), [historical destructive migration](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/server/db/migrations/0037_backfill_personal_workspaces.sql), [bootstrap script](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/scripts/bootstrap-pilot-team.ts) |
| Cloudflare binding/build/cache configuration | [wrangler.jsonc](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/wrangler.jsonc), [OpenNext config](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/open-next.config.ts)                                                                                                                                                                                                                                                                                                                                                                                    |
| Marketing packaging and routing              | [build-marketing.mjs](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/scripts/build-marketing.mjs), [root route](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/app/route.ts), [middleware](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/middleware.ts)                                                                                                                                                                                                                                                         |
| Web API/storage configuration                | [server API client](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/server/api/client.ts), [storage objects](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/server/storage/objects.ts), [R2 adapter](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/packages/object-storage/src/r2.ts)                                                                                                                                                                                                                            |
| Provider keys/encryption/gateway settings    | [resolveApiKeys](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/server/secrets/resolveApiKeys.ts), [secrets package](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/packages/secrets/src/index.ts), [provider factory](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/packages/llm-core/src/providers/factory.ts), [gateway](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/packages/llm-core/src/providers/gateway.ts)                                                          |
| Worker controls/status/scoring               | [worker entry](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/scripts/worker.ts), [status](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/web/scripts/worker-status.ts), [metric labels](https://github.com/oogway-lab/flash-evals/blob/97fafff424e25611e1bf8ed90b5ecb2576034dec/apps/web/server/workflowRuns/scoring.ts)                                                                                                                                                                                                                                     |
| Health/readiness limits                      | [health source](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/apps/api/src/health.ts), [split health script](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/scripts/smoke-split-health.sh), [live readiness](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/scripts/check-live-split-deployment-readiness.sh)                                                                                                                                                                                                                     |
| Configuration and acceptance reference       | [Configuration](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/docs/configuration.md), [real-backend MCP matrix](https://github.com/oogway-lab/flash-evals/blob/0c315fa74edd9a0a72776060d63a01a162903b79/docs/mcp-real-backend-acceptance.md)                                                                                                                                                                                                                                                                                                                                                                        |

Historical fixes reflected in the deployed source: [PR7 exact company admission](https://github.com/oogway-lab/flash-evals/pull/7), [PR10 private R2 adapter](https://github.com/oogway-lab/flash-evals/pull/10), [PR12 Hyperdrive/pilot web](https://github.com/oogway-lab/flash-evals/pull/12), [PR13 Railpack](https://github.com/oogway-lab/flash-evals/pull/13), [PR14 Next/OpenNext compatibility](https://github.com/oogway-lab/flash-evals/pull/14), [PR16 separate worker/signals](https://github.com/oogway-lab/flash-evals/pull/16), [PR17 safe OAuth diagnostics](https://github.com/oogway-lab/flash-evals/pull/17), [PR18 signed-upload headers](https://github.com/oogway-lab/flash-evals/pull/18), [PR19 OAuth client-ID/azp separation](https://github.com/oogway-lab/flash-evals/pull/19), [PR21 exact OAuth issuer](https://github.com/oogway-lab/flash-evals/pull/21), [PR22 metric reference labels](https://github.com/oogway-lab/flash-evals/pull/22), and [PR20 marketing/dashboard integration](https://github.com/oogway-lab/flash-evals/pull/20).

Provider guidance is linked where used. Recheck relevant docs before changing provider configuration, especially Railway's Config-as-Code cutoff and Codex/Clerk OAuth callback policy. The upstream [OpenNext manifest issue](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355) supports the compatibility concern; the repository's exact pin and successful release are the operative evidence for this stack.
