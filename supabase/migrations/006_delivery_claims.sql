-- ============================================================
-- 006_delivery_claims.sql
-- Delivery Claims — track wrong / short / damaged deliveries
-- ============================================================

CREATE TABLE IF NOT EXISTS delivery_claims (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  date           DATE        NOT NULL DEFAULT CURRENT_DATE,
  order_id       UUID        REFERENCES order_history(id) ON DELETE SET NULL,
  item_id        UUID        REFERENCES items(id) ON DELETE SET NULL,
  item_name      TEXT        NOT NULL,
  part_number    TEXT,
  store_name     TEXT,
  supplier_name  TEXT        NOT NULL,
  ordered_qty    NUMERIC     DEFAULT 0,
  received_qty   NUMERIC     DEFAULT 0,
  wrong_qty      NUMERIC     NOT NULL DEFAULT 0,
  unit           TEXT        DEFAULT 'pcs',
  issue_type     TEXT        NOT NULL DEFAULT 'wrong_item',
  notes          TEXT,
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','contacted','resolved','credited')),
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Index for quick lookup by supplier and status
CREATE INDEX IF NOT EXISTS idx_claims_supplier ON delivery_claims(supplier_name);
CREATE INDEX IF NOT EXISTS idx_claims_status   ON delivery_claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_date     ON delivery_claims(date DESC);

-- Enable RLS
ALTER TABLE delivery_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_all_delivery_claims"
  ON delivery_claims FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
