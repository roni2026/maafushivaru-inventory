-- ────────────────────────────────────────────────────────────────────────────
-- 015_fuel_and_order_settings.sql
--
-- Adds:
--   1. DIVE CENTRE FUEL log  → daily fuel chits (petrol / diesel) per boat, with
--      a date. Uploading a month's sheet appends every row; entries can be
--      edited and an Excel sheet (matching the original "DIVE CENTRE FUEL"
--      layout) can be exported at any time.
--   2. Order-generation settings (per-category maximum + default order UOM) and
--      a boat-note retention window (auto-delete notes older than N days).
--
-- All statements are idempotent (IF NOT EXISTS) so this is safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

-- ── DIVE CENTRE FUEL ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dive_centre_fuel (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fuel_type   TEXT NOT NULL DEFAULT 'PETROL'
              CHECK (fuel_type IN ('PETROL', 'DIESEL')),
  fuel_date   DATE NOT NULL DEFAULT CURRENT_DATE,   -- the chit's date
  boat_name   TEXT NOT NULL DEFAULT '',
  qty         NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit        TEXT NOT NULL DEFAULT 'Ltrs',
  -- Operational month the chit belongs to, e.g. '2026-06'. Late-month chits
  -- (28.05 → June sheet) keep the month they were filed under.
  month_key   TEXT NOT NULL DEFAULT to_char(CURRENT_DATE, 'YYYY-MM'),
  source_file TEXT,                                 -- upload / scan origin
  note        TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dive_centre_fuel_month ON dive_centre_fuel(month_key);
CREATE INDEX IF NOT EXISTS idx_dive_centre_fuel_date  ON dive_centre_fuel(fuel_date);
CREATE INDEX IF NOT EXISTS idx_dive_centre_fuel_type  ON dive_centre_fuel(fuel_type);

-- keep updated_at fresh
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_dive_centre_fuel_updated_at') THEN
    CREATE TRIGGER trg_dive_centre_fuel_updated_at
      BEFORE UPDATE ON dive_centre_fuel
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

ALTER TABLE dive_centre_fuel ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='dive_centre_fuel' AND policyname='auth_all_dive_centre_fuel') THEN
    CREATE POLICY "auth_all_dive_centre_fuel" ON dive_centre_fuel
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Order-generation + boat-note settings (key/value) ───────────────────────
INSERT INTO settings (key, value) VALUES
  ('order_max_food',          ''),     -- max order qty per Food item (blank = no cap)
  ('order_max_general',       ''),     -- max order qty per General item
  ('order_max_beverage',      ''),     -- max order qty per Beverage item
  ('order_default_uom',       'pcs'),  -- usual order unit of measure
  ('boat_note_retention_days','6')     -- auto-delete boat notes older than N days
ON CONFLICT (key) DO NOTHING;
