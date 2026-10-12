# Storage backup and restore

[Configuration](configuration.md#storage) · [Getting started](getting-started.md)

This procedure covers the intended pilot topology: PostgreSQL metadata plus
private R2 objects. Dataset rows keep object keys; images and audio are stored
separately. A database dump without its matching object snapshot is incomplete.
This is an operating plan, not evidence that a hosted backup schedule, retention
policy, or restore drill is configured.

## Ownership and proposed pilot policy

- **Coordinator:** Mageswari, as recorded on OOG-477.
- **Backup operator:** not assigned in the ticket. Assign a named operator and
  confirm access to the protected backup location before using real internal
  media.
- **Proposed retention:** keep 7 daily, 4 weekly, and 12 monthly paired
  PostgreSQL/object snapshots. Target a 24-hour recovery point and run a restore
  drill before the pilot and quarterly while the pilot is active.
- Keep snapshots encrypted in a separate protected location. Use a dedicated
  read-only R2 backup credential; keep database and R2 credentials in the
  approved secret manager. Do not put credentials, signed URLs, or real media in
  logs or source control.

These are proposed pilot targets. They need an owner, a scheduled job, retained
storage, and a recorded restore drill before they can be treated as operational
controls.

## Make a paired snapshot

Use the same application revision for the snapshot and its eventual restore.
Before starting, pause API writes and stop the Railway worker. Disable new
upload signing, wait at least the 10-minute upload URL lifetime for outstanding
browser PUTs to expire, and confirm active uploads have finished. This keeps
the database and object set stable during the copy. Use a protected, encrypted
backup directory with enough capacity; do not use a general-purpose temporary
directory for production media.

The commands below assume DATABASE_URL, R2_ACCOUNT_ID, R2_BUCKET,
R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY were injected into the operator
environment by the approved secret manager. For backup, use a separate
read-only R2 token with list/get access, not the application's write token.

    set -eu
    umask 077
    test -n "$DATABASE_URL"
    test -n "$R2_ACCOUNT_ID"
    test -n "$R2_BUCKET"
    test -n "$R2_ACCESS_KEY_ID"
    test -n "$R2_SECRET_ACCESS_KEY"
    test -n "$BACKUP_ROOT"

    export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
    export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
    export AWS_DEFAULT_REGION=auto

    STAMP=$(date -u +%Y%m%dT%H%M%SZ)
    SNAPSHOT="$BACKUP_ROOT/flash-evals-$STAMP"
    mkdir -p "$SNAPSHOT/objects"
    pg_dump --format=custom --no-owner --file="$SNAPSHOT/postgres.dump" "$DATABASE_URL"
    aws s3 sync "s3://$R2_BUCKET" "$SNAPSHOT/objects" \
      --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
      --only-show-errors
    pg_restore --list "$SNAPSHOT/postgres.dump" >/dev/null

Write the UTC timestamp, application revision, database dump checksum, object
copy completion status, operator, and snapshot location into the protected
backup log. Apply the 7/4/12 retention rotation to paired snapshots together;
do not expire the database and objects independently. Resume writes only after
both copies completed. R2 is private storage: do not enable a public bucket for
backup or recovery.

## Restore and verify

Restore into a separate database and an empty private recovery bucket first.
Keep production traffic paused until the restored application can read the
recovered metadata and media. The operator needs a write-scoped token for the
recovery bucket, injected through the secret manager.

    set -eu
    test -n "$RESTORE_DATABASE_URL"
    test -n "$RECOVERY_BUCKET"
    test -n "$R2_ACCOUNT_ID"
    test -n "$R2_ACCESS_KEY_ID"
    test -n "$R2_SECRET_ACCESS_KEY"
    test -n "$SNAPSHOT"

    export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
    export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
    export AWS_DEFAULT_REGION=auto

    pg_restore --clean --if-exists --no-owner \
      --dbname="$RESTORE_DATABASE_URL" "$SNAPSHOT/postgres.dump"
    aws s3 sync "$SNAPSHOT/objects" "s3://$RECOVERY_BUCKET" \
      --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
      --only-show-errors

Point only a recovery deployment at the restored database and bucket, using the
same R2_STORAGE_PREFIX. Check that known synthetic dataset rows resolve to
objects, compare representative object sizes and content types, and run an
image/audio read through the API authorization path. Verify that an unrelated
team/project cannot read those objects. Record the database dump checksum,
object snapshot, test keys, results, operator, and elapsed recovery time. Do not
switch the live API/worker until this review passes.

## Supabase-to-R2 cutover

The code supports the existing Supabase adapter and R2 using the same storage
keys, but this change does not run a live migration. For a later approved
cutover, freeze writes, copy every object key referenced by the database into
the same R2 key namespace, compare object counts and sizes, and verify synthetic
image/audio reads before setting MOSAIC_STORAGE_ADAPTER=r2 in the API, web
server, and Railway worker environments. Keep the private Supabase source and
a paired database/object backup available for rollback until the cutover is
accepted. Do not expose source objects through a public bucket or return raw
object URLs from the app.

For R2 S3 API and signed upload behavior, see Cloudflare's [JavaScript SDK
example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/),
[presigned URL guide](https://developers.cloudflare.com/r2/api/s3/presigned-urls/),
and [CORS guide](https://developers.cloudflare.com/r2/buckets/cors/).
