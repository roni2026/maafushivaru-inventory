-- ============================================================
-- 008  ITEM ACTIVE / INACTIVE STATUS
-- ============================================================
-- Adds an `active` flag to items so they can be bulk activated /
-- deactivated. Deactivated items remain in the catalogue (they are
-- still real items) but are excluded from reports, orders and the
-- day-to-day operational flows (issuance, receiving, stocktake,
-- transfers, waste). They stay fully visible and manageable on the
-- Inventory page so they can be re-activated at any time.
-- ============================================================

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

-- All existing items default to active.
UPDATE items SET active = TRUE WHERE active IS NULL;

-- Speeds up the `WHERE active = true` filter used everywhere.
CREATE INDEX IF NOT EXISTS idx_items_active ON items(active);
