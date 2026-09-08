-- Extend order_history_items with approval and receiving columns
ALTER TABLE order_history_items
  ADD COLUMN IF NOT EXISTS approved_qty  numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS issue_type    text    DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS item_status   text    DEFAULT 'pending';

-- Receiving records (one per receiving action)
CREATE TABLE IF NOT EXISTS order_receiving_records (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id       uuid        REFERENCES order_history(id)       ON DELETE CASCADE,
  order_item_id  uuid        REFERENCES order_history_items(id) ON DELETE CASCADE,
  item_id        uuid        REFERENCES items(id)               ON DELETE SET NULL,
  part_number    text,
  item_name      text,
  unit           text,
  store_name     text,
  ordered_qty    numeric     DEFAULT 0,
  approved_qty   numeric     DEFAULT 0,
  received_qty   numeric     NOT NULL CHECK (received_qty >= 0),
  issue_type     text        DEFAULT 'none',
  status         text        DEFAULT 'received',
  received_by    text,
  received_at    timestamptz DEFAULT now(),
  notes          text
);

COMMENT ON COLUMN order_receiving_records.issue_type IS
  'none | wrong_item | duplicate | short_qty';

CREATE INDEX IF NOT EXISTS idx_orr_order       ON order_receiving_records (order_id);
CREATE INDEX IF NOT EXISTS idx_orr_item        ON order_receiving_records (item_id);
CREATE INDEX IF NOT EXISTS idx_orr_received_at ON order_receiving_records (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_orr_status      ON order_receiving_records (status);
