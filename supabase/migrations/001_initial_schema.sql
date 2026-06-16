-- ============================================================
-- 001_initial_schema.sql
-- Outrigger Maafushivaru Resort – Inventory Management System
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- STORES
-- ------------------------------------------------------------
CREATE TABLE stores (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  category   TEXT NOT NULL CHECK (category IN ('Beverage', 'Food', 'General')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- ITEMS
-- ------------------------------------------------------------
CREATE TABLE items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  part_number   TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  store_id      UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  unit          TEXT NOT NULL DEFAULT 'pcs',
  current_stock NUMERIC(10,2) NOT NULL DEFAULT 0,
  min_stock     NUMERIC(10,2) NOT NULL DEFAULT 0,
  expiry_date   DATE,
  supplier      TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_items_store_id     ON items(store_id);
CREATE INDEX idx_items_expiry_date  ON items(expiry_date);
CREATE INDEX idx_items_part_number  ON items(part_number);

-- ------------------------------------------------------------
-- STOCK UPDATES LOG
-- ------------------------------------------------------------
CREATE TABLE stock_updates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  quantity_change NUMERIC(10,2) NOT NULL,
  new_quantity    NUMERIC(10,2) NOT NULL,
  updated_by      TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stock_updates_item_id ON stock_updates(item_id);
CREATE INDEX idx_stock_updates_date    ON stock_updates(date);

-- ------------------------------------------------------------
-- ISSUANCES
-- ------------------------------------------------------------
CREATE TABLE issuances (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id         UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  quantity_issued NUMERIC(10,2) NOT NULL CHECK (quantity_issued > 0),
  store_id        UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  logged_by       TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_issuances_item_id ON issuances(item_id);
CREATE INDEX idx_issuances_date    ON issuances(date);
CREATE INDEX idx_issuances_store_id ON issuances(store_id);

-- ------------------------------------------------------------
-- EMAIL ALERTS SENT  (deduplication)
-- ------------------------------------------------------------
CREATE TABLE email_alerts_sent (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id              UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  alert_threshold_days INT NOT NULL,
  sent_at              TIMESTAMPTZ DEFAULT NOW(),
  recipient_email      TEXT NOT NULL
);

CREATE INDEX idx_email_alerts_item_id ON email_alerts_sent(item_id);
CREATE INDEX idx_email_alerts_sent_at ON email_alerts_sent(sent_at);

-- ------------------------------------------------------------
-- SETTINGS  (key/value store)
-- ------------------------------------------------------------
CREATE TABLE settings (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key        TEXT UNIQUE NOT NULL,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- TRIGGERS: auto-update updated_at
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
