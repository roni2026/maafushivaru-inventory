-- Add store_name column to order_history so each saved order can record
-- which store it was generated for (Beverage Store, Dry Store 1, etc.).
-- The app and website both write this column when using "By Store" mode.
-- Falls back gracefully if the column already exists.

ALTER TABLE order_history
  ADD COLUMN IF NOT EXISTS store_name text;

-- Index for fast history queries grouped by store
CREATE INDEX IF NOT EXISTS idx_order_history_store_name
  ON order_history (store_name)
  WHERE store_name IS NOT NULL;

COMMENT ON COLUMN order_history.store_name IS
  'Store this order was generated for (e.g. Beverage Store, Dry Store 1). NULL for auto-generated pattern orders.';
