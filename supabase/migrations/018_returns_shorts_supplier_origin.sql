-- ============================================================
-- 018_returns_shorts_supplier_origin.sql
--
-- Adds the tracking features requested for the receiving workflow:
--
--   1. SUPPLIER ORIGIN   — each supplier can be tagged local / foreign so the
--      order sheets show where an item will come from.
--   2. QUANTITIES on delivery problems — a boat-note line can now record HOW MANY
--      units were damaged / short / wrong, not just a yes/no flag.
--   3. SHORT deliveries  — a new `short` outcome (item arrived but fewer units
--      than ordered) so short-coming items can be tracked on their own section.
--   4. ITEM RETURNS      — when a wrong / damaged item is sent back to the
--      supplier we keep a return record, and when the replacement comes back
--      (sometimes a *changed* item) we can update the record intelligently.
--
-- Every statement is idempotent (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS) so
-- this file is safe to run against a live database that already has 001–017.
-- ============================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Supplier origin (local / foreign) — shown when placing orders.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS origin TEXT;   -- 'local' | 'foreign' | NULL
CREATE INDEX IF NOT EXISTS idx_suppliers_origin ON suppliers(origin);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. + 3. Quantities and the new `short` outcome on boat-note lines.
--    damaged_qty / short_qty / wrong_qty are the affected unit counts.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE boat_note_items ADD COLUMN IF NOT EXISTS damaged_qty NUMERIC(12,2);
ALTER TABLE boat_note_items ADD COLUMN IF NOT EXISTS short_qty   NUMERIC(12,2);
ALTER TABLE boat_note_items ADD COLUMN IF NOT EXISTS wrong_qty   NUMERIC(12,2);

ALTER TABLE boat_note_items DROP CONSTRAINT IF EXISTS boat_note_items_status_check;
ALTER TABLE boat_note_items
  ADD CONSTRAINT boat_note_items_status_check
  CHECK (status IN ('pending','received','skipped','not_arrived','wrong_item','damaged','short'));

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Item returns — wrong / damaged items sent back to the supplier, and the
--    (sometimes changed) replacement that comes back.
--
--    status:
--      awaiting_return → logged, item still on-site waiting to go back
--      returned        → sent back to the supplier, awaiting replacement
--      replaced        → correct replacement received (same item)
--      changed         → a DIFFERENT item came back as the replacement
--      closed          → resolved, no replacement expected (credit / refund)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_returns (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boat_note_item_id        UUID REFERENCES boat_note_items(id) ON DELETE SET NULL,
  item_id                  UUID REFERENCES items(id) ON DELETE SET NULL,
  part_number              TEXT,
  product_name             TEXT,
  supplier                 TEXT,
  po_number                TEXT,
  origin                   TEXT,                       -- local / foreign
  unit                     TEXT DEFAULT 'EA',
  qty                      NUMERIC(12,2) NOT NULL DEFAULT 0,
  reason                   TEXT,                        -- wrong_item / damaged / not_needed / other
  status                   TEXT NOT NULL DEFAULT 'awaiting_return'
                           CHECK (status IN ('awaiting_return','returned','replaced','changed','closed')),
  -- Replacement details (filled in when the item comes back; the app pre-fills
  -- these with the original values and only marks `changed` when they differ).
  changed                  BOOLEAN DEFAULT FALSE,
  replacement_part_number  TEXT,
  replacement_product_name TEXT,
  replacement_qty          NUMERIC(12,2),
  note                     TEXT,
  created_by               TEXT,
  created_at               TIMESTAMPTZ DEFAULT now(),
  resolved_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_item_returns_status ON item_returns(status);
CREATE INDEX IF NOT EXISTS idx_item_returns_part   ON item_returns(part_number);
CREATE INDEX IF NOT EXISTS idx_item_returns_created ON item_returns(created_at DESC);

ALTER TABLE item_returns ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='item_returns' AND policyname='auth_all_item_returns') THEN
    CREATE POLICY "auth_all_item_returns" ON item_returns FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
