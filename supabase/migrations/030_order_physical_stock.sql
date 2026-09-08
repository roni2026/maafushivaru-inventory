-- Physical stock observations table
-- Stores the physical count entered each ordering period (week/cycle).
-- Kept COMPLETELY SEPARATE from items.current_stock (main inventory).

CREATE TABLE IF NOT EXISTS order_physical_stock (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id      uuid        REFERENCES items(id) ON DELETE SET NULL,
  part_number  text,
  item_name    text,
  store_name   text,
  physical_qty numeric     NOT NULL DEFAULT 0 CHECK (physical_qty >= 0),
  week_date    date        NOT NULL DEFAULT CURRENT_DATE,
  order_id     uuid        REFERENCES order_history(id) ON DELETE SET NULL,
  recorded_by  text,
  recorded_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_item_week  ON order_physical_stock (item_id, week_date DESC);
CREATE INDEX IF NOT EXISTS idx_ops_store_week ON order_physical_stock (store_name, week_date DESC);
CREATE INDEX IF NOT EXISTS idx_ops_order      ON order_physical_stock (order_id);
CREATE INDEX IF NOT EXISTS idx_ops_part       ON order_physical_stock (part_number, week_date DESC);

COMMENT ON TABLE order_physical_stock IS
  'Manual physical stock counts entered each ordering period. '
  'NEVER connected to items.current_stock (main inventory). '
  'Historical records must never be overwritten—each week creates a new row.';
