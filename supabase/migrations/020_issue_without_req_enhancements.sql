-- ─────────────────────────────────────────────────────────────────────────
-- 020_issue_without_req_enhancements.sql
--
-- Adds everything needed for the upgraded "Issue Without Requisition" flow:
--
--   1. batch_id       — groups multiple item-lines entered together as one
--                        date's issuance (the web + mobile "add multiple
--                        items" form inserts several manual_issues rows that
--                        share one batch_id).
--   2. kitchen         — normalised kitchen bucket derived from
--                        destination_location ('MAIN KITCHEN' / 'STAFF KITCHEN'
--                        / NULL for everything else). Used to route the
--                        next-day reminder to the right deadline.
--   3. notified_at     — set the moment the "issued without req" alert has
--                        been raised (in-app realtime + push), so we never
--                        double notify the same batch.
--   4. push_tokens     — Expo push tokens registered by the mobile app,
--                        tagged with the staff member's kitchen so reminders
--                        can be targeted.
--   5. Realtime        — turns on Postgres realtime for manual_issues so the
--                        mobile app gets an instant "issued without req"
--                        alert the moment a row is inserted, from web OR
--                        mobile.
--   6. Cron scaffolding — commented-out pg_cron + pg_net jobs that call an
--                        Edge Function daily to push kitchen-specific
--                        reminders (Main Kitchen before 08:30, Staff Kitchen
--                        before 10:30, Maldives time / UTC+5) for anything
--                        still 'pending_req' from a previous day. Left
--                        commented because pg_cron / pg_net + the function's
--                        URL & service key are project-specific — see
--                        supabase/functions/send-issue-reminders/README.md.
--
-- All statements are idempotent so this file is safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1-3. New columns on manual_issues ───────────────────────────────────
ALTER TABLE manual_issues ADD COLUMN IF NOT EXISTS batch_id    UUID;
ALTER TABLE manual_issues ADD COLUMN IF NOT EXISTS kitchen     TEXT
  CHECK (kitchen IS NULL OR kitchen IN ('MAIN KITCHEN', 'STAFF KITCHEN'));
ALTER TABLE manual_issues ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_manual_issues_batch   ON manual_issues(batch_id);
CREATE INDEX IF NOT EXISTS idx_manual_issues_kitchen  ON manual_issues(kitchen);

-- Keep `kitchen` in sync with destination_location automatically so existing
-- rows / older clients that only set destination_location still route
-- correctly.
CREATE OR REPLACE FUNCTION sync_manual_issue_kitchen() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.destination_location IN ('MAIN KITCHEN', 'STAFF KITCHEN') THEN
    NEW.kitchen := NEW.destination_location;
  ELSIF NEW.kitchen IS NOT NULL AND NEW.kitchen NOT IN ('MAIN KITCHEN','STAFF KITCHEN') THEN
    NEW.kitchen := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_manual_issue_kitchen ON manual_issues;
CREATE TRIGGER trg_sync_manual_issue_kitchen
  BEFORE INSERT OR UPDATE OF destination_location ON manual_issues
  FOR EACH ROW EXECUTE FUNCTION sync_manual_issue_kitchen();

-- Backfill existing rows once.
UPDATE manual_issues
   SET kitchen = destination_location
 WHERE destination_location IN ('MAIN KITCHEN','STAFF KITCHEN')
   AND kitchen IS DISTINCT FROM destination_location;

-- ── 4. Mobile push token registry ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,          -- Expo push token, e.g. ExponentPushToken[xxxx]
  platform    TEXT,                          -- 'ios' | 'android'
  kitchen     TEXT CHECK (kitchen IS NULL OR kitchen IN ('MAIN KITCHEN','STAFF KITCHEN')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_kitchen ON push_tokens(kitchen);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='push_tokens' AND policyname='auth_push_tokens') THEN
    CREATE POLICY "auth_push_tokens" ON push_tokens FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 5. Realtime so mobile gets an instant "issued without req" alert ────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'manual_issues'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE manual_issues;
  END IF;
END $$;

-- ── 6. Daily kitchen-reminder cron (scaffolding — enable per-project) ───
-- Requires the `pg_cron` and `pg_net` extensions (Database → Extensions).
-- Uncomment and fill in your Edge Function URL + a secret stored via
-- `select vault.create_secret('...', 'issue_reminder_fn_key')` — never hard
-- code a service key directly in a migration file.
--
-- select cron.schedule(
--   'issue-reminder-main-kitchen',
--   '15 3 * * *',   -- 08:15 Maldives time (UTC+5) = 03:15 UTC, before the 08:30 deadline
--   $$
--     select net.http_post(
--       url := 'https://<project-ref>.supabase.co/functions/v1/send-issue-reminders',
--       headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'issue_reminder_fn_key')),
--       body := jsonb_build_object('kitchen','MAIN KITCHEN')
--     );
--   $$
-- );
--
-- select cron.schedule(
--   'issue-reminder-staff-kitchen',
--   '15 5 * * *',   -- 10:15 Maldives time (UTC+5) = 05:15 UTC, before the 10:30 deadline
--   $$
--     select net.http_post(
--       url := 'https://<project-ref>.supabase.co/functions/v1/send-issue-reminders',
--       headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'issue_reminder_fn_key')),
--       body := jsonb_build_object('kitchen','STAFF KITCHEN')
--     );
--   $$
-- );
