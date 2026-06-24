-- ─────────────────────────────────────────────────────────────────────────────
-- 010_boat_notes_and_requisitions.sql
--
-- Adds two major workflows:
--   1. BOAT NOTE receiving  → verify incoming supplies, edit qty + expiry per
--      department, then post to inventory. Full history is kept.
--   2. REQUISITION issuance → smart-OCR a requisition, confirm/edit issued qty,
--      flag non-issued lines with a reason, and keep the full requisition record.
--
-- Also: per-item LOCAL/FOREIGN origin (foreign arrives Monday, local Thursday)
-- so STORE orders can be split by delivery day.
--
-- All statements are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS) so the
-- file is safe to run against a live database that already has prior migrations.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Per-item origin (drives Monday=foreign / Thursday=local delivery split) ────
ALTER TABLE items ADD COLUMN IF NOT EXISTS origin TEXT;   -- 'local' | 'foreign' | NULL
CREATE INDEX IF NOT EXISTS idx_items_origin ON items(origin);

-- ── BOAT NOTES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS boat_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_date    DATE        NOT NULL DEFAULT CURRENT_DATE,  -- delivery date on the note
  label        TEXT,                                       -- e.g. "Boat Note - June 3 2026"
  delivery_day TEXT,                                       -- Monday / Thursday / ...
  status       TEXT        NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','verified','posted')),
  source_file  TEXT,                                       -- original uploaded file name
  departments  TEXT[]      DEFAULT '{}',                   -- depts posted from this note
  total_items  INT         DEFAULT 0,
  posted_items INT         DEFAULT 0,
  total_value  NUMERIC(12,2) DEFAULT 0,
  created_by   TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_boat_notes_date ON boat_notes(note_date);

CREATE TABLE IF NOT EXISTS boat_note_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boat_note_id  UUID NOT NULL REFERENCES boat_notes(id) ON DELETE CASCADE,
  line_no       INT,
  supplier      TEXT,
  po_number     TEXT,
  part_number   TEXT,                                      -- item code / part #
  product_name  TEXT,
  unit          TEXT DEFAULT 'pcs',
  ordered_qty   NUMERIC(12,2) NOT NULL DEFAULT 0,
  received_qty  NUMERIC(12,2),                             -- edited qty actually received
  expiry_date   DATE,
  unit_cost     NUMERIC(12,4) DEFAULT 0,
  department    TEXT,
  item_id       UUID REFERENCES items(id) ON DELETE SET NULL,
  matched       BOOLEAN DEFAULT FALSE,                     -- matched to an inventory item
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','received','skipped')),
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_boat_note_items_note ON boat_note_items(boat_note_id);
CREATE INDEX IF NOT EXISTS idx_boat_note_items_dept ON boat_note_items(department);
CREATE INDEX IF NOT EXISTS idx_boat_note_items_part ON boat_note_items(part_number);

-- ── REQUISITIONS (header info kept per requisition) ────────────────────────────
CREATE TABLE IF NOT EXISTS requisitions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  req_number             TEXT,
  req_date               DATE,
  required_delivery_date DATE,
  req_type               TEXT,        -- Storeroom / ...
  purchase_type          TEXT,        -- Food / Beverage / ...
  requestor              TEXT,
  title                  TEXT,
  department             TEXT,
  source_location        TEXT,
  destination_location   TEXT,
  subject                TEXT,
  date                   DATE NOT NULL DEFAULT CURRENT_DATE,  -- date items were issued
  status                 TEXT NOT NULL DEFAULT 'processed',
  total_lines            INT DEFAULT 0,
  issued_lines           INT DEFAULT 0,
  issued_by              TEXT,
  source_file            TEXT,
  notes                  TEXT,
  created_at             TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_requisitions_date    ON requisitions(date);
CREATE INDEX IF NOT EXISTS idx_requisitions_number  ON requisitions(req_number);

CREATE TABLE IF NOT EXISTS requisition_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id  UUID NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  line_no         INT,
  part_number     TEXT,
  product         TEXT,
  product_desc    TEXT,
  ordered_qty     NUMERIC(12,2) DEFAULT 0,
  issued_qty      NUMERIC(12,2) DEFAULT 0,
  uom             TEXT,
  price           NUMERIC(12,4) DEFAULT 0,
  extension       NUMERIC(12,2) DEFAULT 0,
  item_id         UUID REFERENCES items(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'issued'
                  CHECK (status IN ('issued','wrong_code','not_available','no_longer_needed','returned')),
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_requisition_items_req  ON requisition_items(requisition_id);
CREATE INDEX IF NOT EXISTS idx_requisition_items_part ON requisition_items(part_number);

-- ── Link issuances back to the requisition they came from ──────────────────────
ALTER TABLE issuances ADD COLUMN IF NOT EXISTS issued_by      TEXT;
ALTER TABLE issuances ADD COLUMN IF NOT EXISTS note           TEXT;
ALTER TABLE issuances ADD COLUMN IF NOT EXISTS requisition_id UUID REFERENCES requisitions(id) ON DELETE SET NULL;
ALTER TABLE issuances ADD COLUMN IF NOT EXISTS req_number     TEXT;
-- store_id is optional on the live DB (the app logs issuances without a store)
ALTER TABLE issuances ALTER COLUMN store_id DROP NOT NULL;

-- ── Row-level security: authenticated users get full access (matches app model)─
ALTER TABLE boat_notes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE boat_note_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisitions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisition_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='boat_notes' AND policyname='auth_all_boat_notes') THEN
    CREATE POLICY "auth_all_boat_notes" ON boat_notes FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='boat_note_items' AND policyname='auth_all_boat_note_items') THEN
    CREATE POLICY "auth_all_boat_note_items" ON boat_note_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='requisitions' AND policyname='auth_all_requisitions') THEN
    CREATE POLICY "auth_all_requisitions" ON requisitions FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='requisition_items' AND policyname='auth_all_requisition_items') THEN
    CREATE POLICY "auth_all_requisition_items" ON requisition_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
