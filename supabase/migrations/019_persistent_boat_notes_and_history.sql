-- ============================================================
-- 019_persistent_boat_notes_and_history.sql
--
-- Makes boat-note data PERSISTENT and adds a per-boat-note change history so
-- every upload and every later edit is preserved and viewable forever:
--
--   1. RETENTION OFF  — boat notes (and everything derived from them: History,
--      Received, Not Arrived, Weekly Log, Returns, Samples) are NO LONGER
--      auto-deleted after N days. The retention window is forced to 0 = keep
--      forever. Any previously scheduled purge job is removed. A boat note is
--      now only ever removed when the user explicitly presses Remove.
--
--   2. BOAT NOTE EVENTS — a full changelog per boat note. Every weekly upload is
--      recorded ("uploaded", with a snapshot of the original lines) and every
--      later change (received / not arrived / wrong item / damaged / short /
--      edits) is appended, with who did it and when. Tapping a boat note's
--      history shows what was originally there and what was updated afterwards.
--
-- Every statement is idempotent so this file is safe to re-run against a live
-- database that already has migrations 001-018.
-- ============================================================

-- ── 1. Turn OFF automatic boat-note retention (keep everything forever) ──────
-- 0 (or blank) means "never auto-delete".
UPDATE settings SET value = '0' WHERE key = 'boat_note_retention_days';
INSERT INTO settings (key, value)
  VALUES ('boat_note_retention_days', '0')
  ON CONFLICT (key) DO UPDATE SET value = '0';

-- Remove any scheduled purge job that may have been created via pg_cron so the
-- notes are never wiped automatically. Wrapped so it is a no-op if pg_cron is
-- not installed / no such job exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule(jobid)
        FROM cron.job
       WHERE command ILIKE '%boat_note%'
          OR jobname  ILIKE '%boat_note%';
    EXCEPTION WHEN OTHERS THEN
      -- ignore: nothing scheduled, or insufficient privilege
      NULL;
    END;
  END IF;
END $$;

-- ── 2. Per-boat-note change history (audit trail) ───────────────────────────
--    event_type examples:
--      'uploaded'      → the note was uploaded this week (snapshot = original lines)
--      'received'      → a line was received into inventory
--      'not_arrived'   → a line was flagged as not arrived
--      'wrong_item'    → a line was flagged as a wrong item
--      'damaged'       → a line was flagged damaged (with the affected qty)
--      'short'         → a line was flagged short (with the affected qty)
--      'item_updated'  → a line was edited
--      'resolved'      → a problem line was moved back to pending
--      'note_updated'  → the note header was edited
CREATE TABLE IF NOT EXISTS boat_note_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boat_note_id      UUID NOT NULL REFERENCES boat_notes(id) ON DELETE CASCADE,
  boat_note_item_id UUID REFERENCES boat_note_items(id) ON DELETE SET NULL,
  event_type        TEXT NOT NULL,
  detail            TEXT,               -- human-readable summary of the change
  part_number       TEXT,
  product_name      TEXT,
  department        TEXT,
  qty               NUMERIC(12,2),      -- qty involved (received / affected)
  snapshot          JSONB,              -- optional: full line/note state at the time
  actor             TEXT,               -- who made the change
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_boat_note_events_note ON boat_note_events(boat_note_id, created_at);

ALTER TABLE boat_note_events ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='boat_note_events' AND policyname='auth_all_boat_note_events') THEN
    CREATE POLICY "auth_all_boat_note_events" ON boat_note_events
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
