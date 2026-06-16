-- ============================================================
-- 004_additional_features.sql
-- New tables: Suppliers, Waste Log, Stocktakes, Transfers,
--             Order History, Receiving Log (GRN)
-- New columns: items.unit_cost
-- New settings keys
-- ============================================================

-- Add unit_cost to items
ALTER TABLE items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(10,4) DEFAULT 0;

-- ── Suppliers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  lead_time_days INT DEFAULT 7,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Waste Log ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waste_log (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id   UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity  NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  reason    TEXT NOT NULL CHECK (reason IN ('Expired','Damaged','Contamination','Over-Production','Other')),
  date      DATE NOT NULL DEFAULT CURRENT_DATE,
  logged_by TEXT,
  notes     TEXT,
  unit_cost NUMERIC(10,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waste_log_item_id ON waste_log(item_id);
CREATE INDEX IF NOT EXISTS idx_waste_log_date    ON waste_log(date);

-- ── Stocktakes ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stocktakes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id     UUID REFERENCES stores(id) ON DELETE SET NULL,
  status       TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','cancelled')),
  started_by   TEXT,
  notes        TEXT,
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS stocktake_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stocktake_id UUID NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  item_id      UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  expected_qty NUMERIC(10,2) NOT NULL DEFAULT 0,
  actual_qty   NUMERIC(10,2),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stocktake_items_sid ON stocktake_items(stocktake_id);

-- ── Transfers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfers (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_store_id  UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  to_store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  item_id        UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity       NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  date           DATE NOT NULL DEFAULT CURRENT_DATE,
  reason         TEXT,
  transferred_by TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transfers_item_id ON transfers(item_id);
CREATE INDEX IF NOT EXISTS idx_transfers_date    ON transfers(date);

-- ── Order History ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  delivery_date DATE NOT NULL,
  delivery_day  TEXT,
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending','partial','received','cancelled')),
  created_by    TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS order_history_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id     UUID NOT NULL REFERENCES order_history(id) ON DELETE CASCADE,
  item_id      UUID REFERENCES items(id) ON DELETE SET NULL,
  part_number  TEXT,
  item_name    TEXT,
  store_name   TEXT,
  unit         TEXT,
  ordered_qty  NUMERIC(10,2) NOT NULL DEFAULT 0,
  received_qty NUMERIC(10,2) DEFAULT 0,
  unit_cost    NUMERIC(10,4) DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_history_items_oid ON order_history_items(order_id);

-- ── Receiving Log (GRN) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS receiving_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_name  TEXT,
  received_by    TEXT,
  date           DATE NOT NULL DEFAULT CURRENT_DATE,
  invoice_number TEXT,
  notes          TEXT,
  total_value    NUMERIC(10,2) DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS receiving_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  receiving_id UUID NOT NULL REFERENCES receiving_log(id) ON DELETE CASCADE,
  item_id      UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity     NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  unit_cost    NUMERIC(10,4) DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receiving_items_rid ON receiving_items(receiving_id);

-- ── Enable RLS ─────────────────────────────────────────────
ALTER TABLE suppliers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocktakes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocktake_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_history_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE receiving_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE receiving_items     ENABLE ROW LEVEL SECURITY;

-- ── Policies ───────────────────────────────────────────────
CREATE POLICY "auth_all_suppliers"           ON suppliers           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_waste_log"           ON waste_log           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_stocktakes"          ON stocktakes          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_stocktake_items"     ON stocktake_items     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_transfers"           ON transfers           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_order_history"       ON order_history       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_order_history_items" ON order_history_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_receiving_log"       ON receiving_log       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_receiving_items"     ON receiving_items     FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── New settings ───────────────────────────────────────────
INSERT INTO settings (key, value) VALUES
  ('twilio_account_sid',       ''),
  ('twilio_auth_token',        ''),
  ('twilio_whatsapp_from',     'whatsapp:+14155238886'),
  ('whatsapp_recipient',       ''),
  ('whatsapp_alerts_enabled',  'false'),
  ('low_stock_alerts_enabled', 'true'),
  ('admin_emails',             '')
ON CONFLICT (key) DO NOTHING;
