-- Product decision (2026-07-11): this environment has no production users or
-- data to preserve. Reset the team-rooted application graph once so every real
-- user is provisioned through the new personal-workspace + Default-project flow.
-- TRUNCATE is transaction-safe in PostgreSQL and remains a no-op on re-run.
TRUNCATE TABLE "teams" CASCADE;
