-- ────────────────────────────────────────────────────────────────────────────
-- 012_manual_issues_and_stocktake.sql
--
-- 1. MANUAL ISSUES ("Issue Without Requisition")
--    Lets the store log an item that was given out WITHOUT a requisition yet.
--    Each entry captures item name, quantity, code number, destination location
--    (department incl. ALLOWANCE) etc. and tracks whether the requisition was
--    later provided:
--       • 'pending_req'  → issued, requisition NOT yet provided  (reminder due)
--       • 'req_provided' → requisition has since been provided    (settled)
--    A daily reminder email is sent for everything still 'pending_req'.
--
-- 2. STOCKTAKE upload sessions
--    Groups every physical-count row that came from one uploaded file so the
--    variance report can be rebuilt per upload, and stores the variance value.
--
-- All statements are idempotent so this file is safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. MANUAL ISSUES ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manual_issues (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date                 DATE NOT NULL DEFAULT CURRENT_DATE,
  item_id              UUID REFERENCES items(id) ON DELETE SET NULL,
  item_name            TEXT NOT NULL,
  part_number          TEXT,                       -- code number
  quantity             NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit                 TEXT DEFAULT 'pcs',
  destination_location TEXT,                        -- dept / ALLOWANCE / etc.
  issued_to            TEXT,                        -- who took it (e.g. "Sir")
  issued_by            TEXT,
  status               TEXT NOT NULL DEFAULT 'pending_req'
                       CHECK (status IN ('pending_req','req_provided')),
  req_number           TEXT,                        -- filled when req is provided
  req_provided_at      TIMESTAMPTZ,
  deduct_stock         BOOLEAN DEFAULT TRUE,        -- whether it reduced inventory
  last_reminder_at     TIMESTAMPTZ,                 -- last reminder email sent
  reminder_count       INT DEFAULT 0,
  note                 TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manual_issues_status ON manual_issues(status);
CREATE INDEX IF NOT EXISTS idx_manual_issues_date   ON manual_issues(date DESC);

ALTER TABLE manual_issues ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='manual_issues' AND policyname='auth_manual_issues') THEN
    CREATE POLICY "auth_manual_issues" ON manual_issues FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 2. STOCKTAKE upload sessions ─────────────────────────────────────────────
ALTER TABLE stocktake_entries ADD COLUMN IF NOT EXISTS session_id     UUID;
ALTER TABLE stocktake_entries ADD COLUMN IF NOT EXISTS session_label  TEXT;
ALTER TABLE stocktake_entries ADD COLUMN IF NOT EXISTS variance_value NUMERIC DEFAULT 0;  -- difference * unit_cost
CREATE INDEX IF NOT EXISTS idx_stocktake_session ON stocktake_entries(session_id);
