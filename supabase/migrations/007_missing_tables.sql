-- ============================================================
-- 007_missing_tables.sql
-- Creates all supporting tables for full app functionality
-- ============================================================

-- Waste Log
CREATE TABLE IF NOT EXISTS waste_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        UUID        REFERENCES items(id) ON DELETE SET NULL,
  item_name      TEXT        NOT NULL,
  date           DATE        NOT NULL DEFAULT CURRENT_DATE,
  quantity_wasted NUMERIC    NOT NULL DEFAULT 0,
  unit           TEXT        DEFAULT 'pcs',
  reason         TEXT        NOT NULL DEFAULT 'other',
  wasted_by      TEXT,
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE waste_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_waste_log" ON waste_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Stocktake entries
CREATE TABLE IF NOT EXISTS stocktake_entries (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id          UUID    REFERENCES items(id) ON DELETE SET NULL,
  item_name        TEXT,
  date             DATE    NOT NULL DEFAULT CURRENT_DATE,
  counted_quantity NUMERIC NOT NULL DEFAULT 0,
  system_quantity  NUMERIC DEFAULT 0,
  difference       NUMERIC DEFAULT 0,
  unit             TEXT    DEFAULT 'pcs',
  note             TEXT,
  status           TEXT    DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by      TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE stocktake_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_stocktake" ON stocktake_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Transfers
CREATE TABLE IF NOT EXISTS transfers (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID    REFERENCES items(id) ON DELETE SET NULL,
  item_name       TEXT,
  date            DATE    NOT NULL DEFAULT CURRENT_DATE,
  quantity        NUMERIC NOT NULL DEFAULT 0,
  unit            TEXT    DEFAULT 'pcs',
  from_store_id   UUID    REFERENCES stores(id) ON DELETE SET NULL,
  from_store_name TEXT,
  to_store_id     UUID    REFERENCES stores(id) ON DELETE SET NULL,
  to_store_name   TEXT,
  transferred_by  TEXT,
  note            TEXT,
  status          TEXT    DEFAULT 'completed',
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_transfers" ON transfers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT UNIQUE NOT NULL,
  contact_name  TEXT,
  email         TEXT,
  phone         TEXT,
  address       TEXT,
  payment_terms TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_suppliers" ON suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Receiving / GRN
CREATE TABLE IF NOT EXISTS receiving (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id           UUID    REFERENCES items(id) ON DELETE SET NULL,
  item_name         TEXT,
  date              DATE    NOT NULL DEFAULT CURRENT_DATE,
  quantity_received NUMERIC NOT NULL DEFAULT 0,
  unit              TEXT    DEFAULT 'pcs',
  supplier_name     TEXT,
  received_by       TEXT,
  invoice_number    TEXT,
  unit_cost         NUMERIC DEFAULT 0,
  note              TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE receiving ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_receiving" ON receiving FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_waste_date      ON waste_log(date DESC);
CREATE INDEX IF NOT EXISTS idx_stocktake_date  ON stocktake_entries(date DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_date  ON transfers(date DESC);
CREATE INDEX IF NOT EXISTS idx_receiving_date  ON receiving(date DESC);
