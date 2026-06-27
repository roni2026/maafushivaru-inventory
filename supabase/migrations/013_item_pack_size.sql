-- ────────────────────────────────────────────────────────────────────────────
-- 013_item_pack_size.sql
--
-- Adds per-item PACK SIZE so order quantities can be rounded up to whole packs
-- (e.g. items that come 6 / 10 / 12 to a packet). Defaults to 1 (no packing).
-- Safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE items ADD COLUMN IF NOT EXISTS pack_size NUMERIC NOT NULL DEFAULT 1;
