-- ============================================================
-- 009_batches_and_expiry_email.sql
-- 1. ITEM BATCHES  — one item can hold stock with several
--    different expiry dates, each with its own quantity.
-- 2. EXPIRY EMAIL SCHEDULE — per-threshold toggles for the
--    automated expiry reminder emails sent via Brevo.
-- 3. EXPIRY EMAIL LOG — de-duplicates reminders so the same
--    item/threshold isn't emailed twice.
-- ============================================================

-- ------------------------------------------------------------
-- ITEM BATCHES  (multiple expiry dates per item)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS item_batches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  expiry_date DATE,
  quantity    NUMERIC(10,2) NOT NULL DEFAULT 0,
  batch_code  TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_batches_item   ON item_batches(item_id);
CREATE INDEX IF NOT EXISTS idx_item_batches_expiry ON item_batches(expiry_date);

ALTER TABLE item_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_item_batches"
  ON item_batches FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- keep updated_at fresh
DROP TRIGGER IF EXISTS trg_item_batches_updated_at ON item_batches;
CREATE TRIGGER trg_item_batches_updated_at
  BEFORE UPDATE ON item_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- EXPIRY EMAIL LOG  (dedupe automated reminders)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expiry_email_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     UUID REFERENCES items(id) ON DELETE CASCADE,
  batch_id    UUID REFERENCES item_batches(id) ON DELETE CASCADE,
  threshold   TEXT NOT NULL,           -- '3m' | '2m' | '1m' | '15d' | '7d' | 'after'
  expiry_date DATE,
  recipient   TEXT,
  sent_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expiry_email_log_item ON expiry_email_log(item_id);

ALTER TABLE expiry_email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_expiry_email_log"
  ON expiry_email_log FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- EXPIRY EMAIL SCHEDULE SETTINGS  (which thresholds to send)
-- ------------------------------------------------------------
INSERT INTO settings (key, value) VALUES
  ('expiry_email_enabled', 'false'),
  ('expiry_email_3m',      'false'),  -- 3 months before
  ('expiry_email_2m',      'false'),  -- 2 months before
  ('expiry_email_1m',      'true'),   -- 1 month before
  ('expiry_email_15d',     'true'),   -- 15 days before
  ('expiry_email_7d',      'true'),   -- 7 days before
  ('expiry_email_after',   'false')   -- after it has expired
ON CONFLICT (key) DO NOTHING;
